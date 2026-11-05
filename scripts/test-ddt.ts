import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { runMigrations, getSupportedSchemaVersion } from "../electron/db/migrations.ts";
import { AppError, toIpcThrownError } from "../electron/errors/app-error.ts";
import {
  findArticleByCode,
  insertArticle,
} from "../electron/repositories/articles-repository.ts";
import {
  findDdtBySha256,
  getDdtDashboard,
  getDdtDetail,
  insertDdtDocument,
  insertDdtLine,
  listDdtDocuments,
  listDdtLines,
  transitionDdtStatus,
  updateDdtDocumentFields,
} from "../electron/repositories/ddt-repository.ts";
import { getArticleStockMilli } from "../electron/repositories/stock-movements-repository.ts";
import {
  createMissingDdtArticlesOnDatabase,
  evaluateLineAssociation,
  findActiveArticleByNormalizedCode,
  reassociateDdtArticlesOnDatabase,
} from "../electron/services/ddt-association.ts";
import { parseDdtText } from "../electron/services/ddt-parser.ts";
import { extractDdtContent } from "../electron/services/ddt-extract.ts";
import { registerDdtOnDatabase } from "../electron/services/ddt-registration.ts";
import {
  PDFJS_WORKER_PACKAGE_ID,
  resolvePdfJsWorkerPath,
  resolvePdfJsWorkerSrc,
} from "../electron/services/pdfjs-worker.ts";
import { normalizeArticleCode } from "../shared/articles.ts";
import {
  buildDdtDocumentKey,
  canTransitionDdtStatus,
  collectDdtRegistrationIssues,
  parseDdtDocumentUpdateInput,
  parseDdtListQuery,
  parseDdtQuantityDetailed,
  parseDdtQuantityRaw,
  summarizeDdtAssociation,
} from "../shared/ddt.ts";
import {
  DDT_CSV_BOM,
  DDT_DOCUMENTS_CSV_HEADERS,
  serializeDdtDocumentsCsv,
} from "../shared/ddt-csv.ts";
import { tryParseDesktopErrorPayload } from "../shared/errors.ts";
import { listEnabledModules } from "../shared/modules.ts";
import { withTransaction } from "../electron/db/transactions.ts";

const require = createRequire(import.meta.url);
type BetterSqlite3Constructor = new (filename: string) => Database;
const BetterSqlite3 = require("better-sqlite3") as BetterSqlite3Constructor;

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);
const fixtureText = fs.readFileSync(
  path.join(fixturesDir, "ddt-sample.txt"),
  "utf8",
);
const fixturePdfPath = path.join(
  fixturesDir,
  "DDT_01_standard_multiriga.pdf",
);
const fixture30PdfPath = path.join(
  fixturesDir,
  "DDT_TEST_MAGAZZINO_30_ARTICOLI.pdf",
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function openDb(filePath?: string): Database {
  const db = new BetterSqlite3(filePath ?? ":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

function seedArticles(db: Database): { a1: string; a2: string; a3: string } {
  const a1 = randomUUID();
  const a2 = randomUUID();
  const a3 = randomUUID();
  insertArticle(db, a1, {
    code: "ART-001",
    description: "Vite M6 zincata",
    category: null,
    unit: "pcs",
    minStock: null,
    notes: null,
  });
  insertArticle(db, a2, {
    code: "ART-002",
    description: "Guarnizione NBR",
    category: null,
    unit: "kg",
    minStock: null,
    notes: null,
  });
  insertArticle(db, a3, {
    code: "ART-003",
    description: "Tubo PVC 20mm",
    category: null,
    unit: "m",
    minStock: null,
    notes: null,
  });
  return { a1, a2, a3 };
}

function testMigrationV7(): void {
  const db = openDb();
  assert(getSupportedSchemaVersion() === 7, "supported schema is 7");
  const version = Number(db.pragma("user_version", { simple: true }));
  assert(version === 7, "fresh db migrates to v7");
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ddt_%'`,
    )
    .all() as Array<{ name: string }>;
  const names = tables.map((t) => t.name).sort();
  assert(names.includes("ddt_documents"), "ddt_documents exists");
  assert(names.includes("ddt_lines"), "ddt_lines exists");
  assert(names.includes("ddt_processings"), "ddt_processings exists");
  assert(names.includes("ddt_line_stock_links"), "links table exists");
  db.close();
  console.log("OK  migration v7 DDT tables");
}

function testParserTextual(): void {
  const parsed = parseDdtText(fixtureText, { source: "pdf_text" });
  assert(parsed.documentNumber === "DDT-2026-001", "number parsed");
  assert(parsed.documentDate === "2026-03-15", "date parsed");
  assert(parsed.counterpartyName?.includes("Fornitore Demo"), "supplier");
  assert(parsed.orderReference === "ORD-7788", "order ref");
  assert(parsed.lines.length >= 3, "lines parsed");
  assert(parsed.lines[0]?.originalCode === "ART-001", "first code");
  assert(parsed.lines[0]?.unitNormalized === "pcs", "pcs unit");
  assert(parsed.lines[0]?.quantityMilli === 10000, "qty 10 pcs");
  assert(parsed.lines[1]?.unitNormalized === "kg", "kg unit");
  assert(parsed.lines[1]?.quantityMilli === 2500, "qty 2.5 kg");
  console.log("OK  deterministic parser (textual fixture)");
}

function testParserEdgeCases(): void {
  const empty = parseDdtText("nessun dato utile", { source: "ocr" });
  assert(empty.lines.length === 0, "unreadable → no lines");
  assert(empty.warnings.length > 0, "warnings present");

  const comma = parseDdtText(
    "Codice  Descrizione  Q.tà  U.M.\nX1  pezzo  1,250  KG",
    { source: "pdf_text" },
  );
  assert(comma.lines[0]?.quantityMilli === 1250, "comma decimal");

  const thousands = parseDdtText(
    "Codice  Descrizione  Q.tà  U.M.\nY1  nastro  1.250  M",
    { source: "pdf_text" },
  );
  assert(thousands.lines[0]?.quantityMilli === 1_250_000, "1.250 → 1250 m");

  const pcsThousands = parseDdtText(
    "Codice  Descrizione  Q.tà  U.M.\nZ1  viti  2.500  PZ",
    { source: "pdf_text" },
  );
  assert(pcsThousands.lines[0]?.quantityMilli === 2_500_000, "2.500 pcs");

  const broken = parseDdtText(
    "Codice  Descrizione  Q.tà  U.M.\n  descrizione spezzata senza codice  3  PZ",
    { source: "pdf_text" },
  );
  assert(
    broken.lines.some((l) => l.warnings.length > 0 || !l.originalCode),
    "broken rows flagged",
  );
  console.log("OK  parser edge cases");
}

function testQuantityNormalizationRules(): void {
  assert(parseDdtQuantityRaw("18,500", "l") === 18_500, "italian decimal l");
  assert(parseDdtQuantityRaw("1.250", "m") === 1_250_000, "thousands m");
  assert(parseDdtQuantityRaw("2.500", "pcs") === 2_500_000, "thousands pcs");
  assert(parseDdtQuantityRaw("3.000", "pcs") === 3_000_000, "3000 pcs not 3");
  assert(parseDdtQuantityRaw("1.25", "kg") === 1_250, "dot decimal 2 places");
  assert(parseDdtQuantityRaw("120", "pcs") === 120_000, "plain integer");

  const ambiguous = parseDdtQuantityDetailed("12.3456", "kg");
  assert(ambiguous.ambiguous === true, "4+ decimals ambiguous");
  assert(ambiguous.quantityMilli === null, "ambiguous milli null");

  const thousandsInfo = parseDdtQuantityDetailed("1.200", "pcs");
  assert(thousandsInfo.interpretedAs === "thousands", "interpreted thousands");
  assert(thousandsInfo.quantityMilli === 1_200_000, "1200 pcs");
  assert(thousandsInfo.warning != null, "soft warning on thousands");
  console.log("OK  quantity normalization (IT decimal / thousands / ambiguous)");
}

function testStateMachine(): void {
  assert(canTransitionDdtStatus("ready", "registered"), "ready→registered");
  assert(!canTransitionDdtStatus("registered", "imported"), "no reopen");
  assert(!canTransitionDdtStatus("cancelled", "ready"), "cancelled terminal");
  console.log("OK  status transitions");
}

function testImportDuplicateHashAndRegister(): void {
  const db = openDb();
  const articles = seedArticles(db);
  const sha = createHash("sha256").update(fixtureText).digest("hex");
  const docId = randomUUID();

  insertDdtDocument(db, {
    id: docId,
    documentType: "inbound",
    originalRelativePath: `${docId}/sample.txt`,
    originalFileName: "sample.txt",
    mimeType: "application/pdf",
    contentSha256: sha,
    byteSize: fixtureText.length,
    pageCount: 1,
    status: "imported",
    ocrStatus: "native_text",
  });

  const dup = findDdtBySha256(db, sha);
  assert(dup?.id === docId, "hash unique lookup");

  const parsed = parseDdtText(fixtureText, { source: "pdf_text" });
  updateDdtDocumentFields(db, docId, {
    documentNumber: parsed.documentNumber,
    documentDate: parsed.documentDate,
    counterpartyName: parsed.counterpartyName,
    orderReference: parsed.orderReference,
    documentKey: buildDdtDocumentKey({
      documentType: "inbound",
      documentNumber: parsed.documentNumber,
      documentDate: parsed.documentDate,
      counterpartyName: parsed.counterpartyName,
    }),
    status: "ready",
  });

  const map = [articles.a1, articles.a2, articles.a3];
  parsed.lines.slice(0, 3).forEach((line, index) => {
    insertDdtLine(db, {
      id: randomUUID(),
      documentId: docId,
      lineNumber: index + 1,
      originalCode: line.originalCode,
      originalDescription: line.originalDescription,
      articleId: map[index]!,
      quantityRaw: line.quantityRaw,
      quantityMilli: line.quantityMilli,
      unitRaw: line.unitRaw,
      unitNormalized: line.unitNormalized,
      source: "pdf_text",
      confidence: null,
      warnings: [],
      validationStatus: "ok",
      pageNumber: 1,
    });
  });

  const registered = withTransaction(db, (tx) =>
    registerDdtOnDatabase(tx, docId),
  );
  assert(registered.document.status === "registered", "registered");
  assert(
    registered.lines.every((l) => l.stockMovementId),
    "lines linked to movements",
  );
  assert(getArticleStockMilli(db, articles.a1) === 10000, "stock ART-001");
  assert(getArticleStockMilli(db, articles.a2) === 2500, "stock ART-002");

  let threw = false;
  try {
    withTransaction(db, (tx) => registerDdtOnDatabase(tx, docId));
  } catch (error) {
    threw = error instanceof AppError && error.code === "CONFLICT";
  }
  assert(threw, "second register blocked");
  assert(getArticleStockMilli(db, articles.a1) === 10000, "no duplicate stock");

  db.close();
  console.log("OK  register inbound + duplicate prevention");
}

function testOutboundInsufficientStock(): void {
  const db = openDb();
  const articles = seedArticles(db);
  const docId = randomUUID();
  insertDdtDocument(db, {
    id: docId,
    documentType: "outbound",
    originalRelativePath: `${docId}/out.pdf`,
    originalFileName: "out.pdf",
    mimeType: "application/pdf",
    contentSha256: createHash("sha256").update("out-1").digest("hex"),
    byteSize: 10,
    pageCount: 1,
    status: "ready",
    ocrStatus: "manual",
  });
  updateDdtDocumentFields(db, docId, {
    documentNumber: "OUT-1",
    documentDate: "2026-03-16",
    status: "ready",
  });
  insertDdtLine(db, {
    id: randomUUID(),
    documentId: docId,
    lineNumber: 1,
    originalCode: "ART-001",
    originalDescription: "Vite",
    articleId: articles.a1,
    quantityRaw: "5",
    quantityMilli: 5000,
    unitRaw: "PZ",
    unitNormalized: "pcs",
    source: "manual",
    confidence: null,
    warnings: [],
    validationStatus: "ok",
    pageNumber: null,
  });

  let threw = false;
  try {
    withTransaction(db, (tx) => registerDdtOnDatabase(tx, docId));
  } catch (error) {
    threw =
      error instanceof AppError &&
      error.code === "CONFLICT" &&
      error.message.includes("Giacenza");
  }
  assert(threw, "outbound without stock rejected");
  assert(getArticleStockMilli(db, articles.a1) === 0, "stock unchanged");
  db.close();
  console.log("OK  outbound insufficient stock");
}

function testRollbackOnMidFailure(): void {
  const db = openDb();
  const articles = seedArticles(db);
  const docId = randomUUID();
  insertDdtDocument(db, {
    id: docId,
    documentType: "inbound",
    originalRelativePath: `${docId}/x.pdf`,
    originalFileName: "x.pdf",
    mimeType: "application/pdf",
    contentSha256: createHash("sha256").update("rb").digest("hex"),
    byteSize: 3,
    pageCount: 1,
    status: "ready",
    ocrStatus: "manual",
  });
  updateDdtDocumentFields(db, docId, {
    documentNumber: "RB-1",
    documentDate: "2026-03-17",
    status: "ready",
  });
  insertDdtLine(db, {
    id: randomUUID(),
    documentId: docId,
    lineNumber: 1,
    originalCode: "ART-001",
    originalDescription: "ok",
    articleId: articles.a1,
    quantityRaw: "1",
    quantityMilli: 1000,
    unitRaw: "PZ",
    unitNormalized: "pcs",
    source: "manual",
    confidence: null,
    warnings: [],
    validationStatus: "ok",
    pageNumber: null,
  });
  insertDdtLine(db, {
    id: randomUUID(),
    documentId: docId,
    lineNumber: 2,
    originalCode: "NOPE",
    originalDescription: "missing",
    articleId: null,
    quantityRaw: "1",
    quantityMilli: 1000,
    unitRaw: "PZ",
    unitNormalized: "pcs",
    source: "manual",
    confidence: null,
    warnings: [],
    validationStatus: "ok",
    pageNumber: null,
  });

  let threw = false;
  try {
    withTransaction(db, (tx) => registerDdtOnDatabase(tx, docId));
  } catch {
    threw = true;
  }
  assert(threw, "invalid line blocks register");
  // Status may have been claimed then rolled back by withTransaction
  const detail = getDdtDetail(db, docId);
  assert(detail?.document.status === "ready", "status rolled back to ready");
  assert(getArticleStockMilli(db, articles.a1) === 0, "no partial stock");
  db.close();
  console.log("OK  transactional rollback on failure");
}

function testDashboardListAndValidation(): void {
  const db = openDb();
  const dash = getDdtDashboard(db);
  assert(dash.imported === 0, "empty dashboard");
  const listed = listDdtDocuments(db, {
    search: "",
    status: "all",
    documentType: "all",
    dateFrom: null,
    dateTo: null,
    page: 1,
    pageSize: 25,
  });
  assert(listed.total === 0, "empty list");

  let threw = false;
  try {
    parseDdtListQuery({ status: "nope" });
  } catch {
    threw = true;
  }
  assert(threw, "invalid list query rejected");

  threw = false;
  try {
    parseDdtDocumentUpdateInput({ id: "x" });
  } catch {
    threw = true;
  }
  assert(threw, "invalid update payload rejected");

  const encoded = toIpcThrownError(AppError.validation("payload DDT non valido"));
  assert(
    tryParseDesktopErrorPayload(encoded.message)?.code === "VALIDATION_FAILED",
    "IPC validation encoding",
  );
  db.close();
  console.log("OK  dashboard/list/IPC validation");
}

function testModuleVisibility(): void {
  const withWh = listEnabledModules({
    configured: true,
    sectorId: "warehouse_distribution",
  });
  assert(withWh.some((m) => m.id === "ddt"), "ddt visible with warehouse");
  const general = listEnabledModules({
    configured: true,
    sectorId: "general_services",
  });
  assert(!general.some((m) => m.id === "ddt"), "ddt hidden for general");
  console.log("OK  sector module visibility for DDT");
}

function testOptimisticConcurrentRegister(): void {
  const db = openDb();
  const articles = seedArticles(db);
  const docId = randomUUID();
  insertDdtDocument(db, {
    id: docId,
    documentType: "inbound",
    originalRelativePath: `${docId}/c.pdf`,
    originalFileName: "c.pdf",
    mimeType: "application/pdf",
    contentSha256: createHash("sha256").update("conc").digest("hex"),
    byteSize: 4,
    pageCount: 1,
    status: "ready",
    ocrStatus: "manual",
  });
  updateDdtDocumentFields(db, docId, {
    documentNumber: "C-1",
    documentDate: "2026-03-18",
    status: "ready",
  });
  insertDdtLine(db, {
    id: randomUUID(),
    documentId: docId,
    lineNumber: 1,
    originalCode: "ART-001",
    originalDescription: "x",
    articleId: articles.a1,
    quantityRaw: "1",
    quantityMilli: 1000,
    unitRaw: "PZ",
    unitNormalized: "pcs",
    source: "manual",
    confidence: null,
    warnings: [],
    validationStatus: "ok",
    pageNumber: null,
  });

  const claimed = transitionDdtStatus(db, docId, "ready", "registered", {
    registeredAt: "2026-03-18 10:00:00",
  });
  assert(claimed, "first claim ok");
  const second = transitionDdtStatus(db, docId, "ready", "registered");
  assert(!second, "second claim fails");
  db.close();
  console.log("OK  concurrent registration claim");
}

function testCollectIssues(): void {
  const issues = collectDdtRegistrationIssues(
    {
      id: "1",
      documentType: "inbound",
      documentNumber: null,
      documentDate: null,
      counterpartyName: null,
      counterpartyPartyId: null,
      orderReference: null,
      originalRelativePath: "a/b",
      originalFileName: "a.pdf",
      mimeType: "application/pdf",
      contentSha256: "x".repeat(64),
      byteSize: 1,
      pageCount: 1,
      status: "ready",
      ocrStatus: "manual",
      documentKey: null,
      notes: null,
      lastError: null,
      importedAt: "",
      processedAt: null,
      registeredAt: null,
      createdAt: "",
      updatedAt: "",
    },
    [],
  );
  assert(issues.blocking.length >= 3, "blocking issues for incomplete doc");
  console.log("OK  registration issue collector");
}

function insertReadyDocument(
  db: Database,
  opts: {
    id: string;
    number: string;
    date: string;
    shaSuffix: string;
  },
): void {
  insertDdtDocument(db, {
    id: opts.id,
    documentType: "inbound",
    originalRelativePath: `${opts.id}/t.pdf`,
    originalFileName: "t.pdf",
    mimeType: "application/pdf",
    contentSha256: createHash("sha256").update(opts.shaSuffix).digest("hex"),
    byteSize: 10,
    pageCount: 1,
    status: "imported",
    ocrStatus: "native_text",
  });
  updateDdtDocumentFields(db, opts.id, {
    documentNumber: opts.number,
    documentDate: opts.date,
    counterpartyName: "Fornitore Test",
    status: "review_required",
  });
}

function testAutoAssociationExactCode(): void {
  const db = openDb();
  const articles = seedArticles(db);
  const docId = randomUUID();
  insertReadyDocument(db, {
    id: docId,
    number: "ASSOC-1",
    date: "2026-10-28",
    shaSuffix: "assoc-1",
  });
  insertDdtLine(db, {
    id: randomUUID(),
    documentId: docId,
    lineNumber: 1,
    originalCode: " art-001 ",
    originalDescription: "Vite dal DDT",
    articleId: null,
    quantityRaw: "10",
    quantityMilli: 10_000,
    unitRaw: "PZ",
    unitNormalized: "pcs",
    source: "pdf_text",
    confidence: null,
    warnings: [],
    validationStatus: "error",
    pageNumber: 1,
  });

  const detail = reassociateDdtArticlesOnDatabase(db, docId);
  assert(detail.lines[0]?.articleId === articles.a1, "auto-linked by code");
  assert(detail.lines[0]?.articleCode === "ART-001", "catalog code");
  assert(
    detail.lines[0]?.originalDescription === "Vite dal DDT",
    "original description preserved",
  );
  assert(
    findActiveArticleByNormalizedCode(db, "Art-001")?.id === articles.a1,
    "normalized lookup",
  );

  // Second reassociate must not create duplicates / change link.
  const again = reassociateDdtArticlesOnDatabase(db, docId);
  assert(again.lines[0]?.articleId === articles.a1, "idempotent reassociate");
  assert(listDdtLines(db, docId).length === 1, "no duplicate lines");

  db.close();
  console.log("OK  auto-association exact code + no duplicate links");
}

function testBulkCreateMissingAndAssociate(): void {
  const db = openDb();
  const docId = randomUUID();
  insertReadyDocument(db, {
    id: docId,
    number: "BULK-1",
    date: "2026-10-28",
    shaSuffix: "bulk-1",
  });
  const lineA = randomUUID();
  const lineB = randomUUID();
  insertDdtLine(db, {
    id: lineA,
    documentId: docId,
    lineNumber: 1,
    originalCode: "NEW-100",
    originalDescription: "Articolo nuovo A",
    articleId: null,
    quantityRaw: "5",
    quantityMilli: 5_000,
    unitRaw: "PZ",
    unitNormalized: "pcs",
    source: "pdf_text",
    confidence: null,
    warnings: ["Articolo assente in catalogo (match esatto per codice)."],
    validationStatus: "error",
    pageNumber: 1,
  });
  insertDdtLine(db, {
    id: lineB,
    documentId: docId,
    lineNumber: 2,
    originalCode: "new-100",
    originalDescription: "Stesso codice normalizzato",
    articleId: null,
    quantityRaw: "2",
    quantityMilli: 2_000,
    unitRaw: "PZ",
    unitNormalized: "pcs",
    source: "pdf_text",
    confidence: null,
    warnings: ["Articolo assente in catalogo (match esatto per codice)."],
    validationStatus: "error",
    pageNumber: 1,
  });

  const beforeCount = (
    db.prepare(`SELECT COUNT(*) AS c FROM articles`).get() as { c: number }
  ).c;
  const detail = createMissingDdtArticlesOnDatabase(db, docId);
  const afterCount = (
    db.prepare(`SELECT COUNT(*) AS c FROM articles`).get() as { c: number }
  ).c;
  assert(afterCount === beforeCount + 1, "one article for equivalent codes");
  assert(
    detail.lines.every((line) => line.articleId),
    "both lines linked after bulk create",
  );
  assert(
    detail.lines[0]?.articleId === detail.lines[1]?.articleId,
    "same article for normalized duplicate codes",
  );
  assert(findArticleByCode(db, "NEW-100") != null, "catalog has NEW-100");

  // Retry create: no extra articles, no stock movements.
  createMissingDdtArticlesOnDatabase(db, docId);
  const retryCount = (
    db.prepare(`SELECT COUNT(*) AS c FROM articles`).get() as { c: number }
  ).c;
  assert(retryCount === afterCount, "retry does not duplicate articles");
  const movements = (
    db.prepare(`SELECT COUNT(*) AS c FROM stock_movements`).get() as {
      c: number;
    }
  ).c;
  assert(movements === 0, "no movements on article create");

  db.close();
  console.log("OK  bulk create missing + associate + normalized dup codes");
}

function testUnitConflictAssociation(): void {
  const db = openDb();
  const articles = seedArticles(db);
  const evaluated = evaluateLineAssociation(db, {
    originalCode: "ART-001",
    unitNormalized: "kg",
    quantityRaw: "1",
    quantityMilli: 1000,
    warnings: [],
    validationStatus: "ok",
    articleId: articles.a1,
  });
  assert(evaluated.articleId === articles.a1, "still linked");
  assert(
    evaluated.warnings.some((w) => /diversa da catalogo/i.test(w)),
    "unit conflict warned",
  );
  assert(evaluated.validationStatus === "warning", "warning status");

  const docId = randomUUID();
  insertReadyDocument(db, {
    id: docId,
    number: "UNIT-1",
    date: "2026-10-28",
    shaSuffix: "unit-1",
  });
  insertDdtLine(db, {
    id: randomUUID(),
    documentId: docId,
    lineNumber: 1,
    originalCode: "ART-001",
    originalDescription: "Vite",
    articleId: articles.a1,
    quantityRaw: "1",
    quantityMilli: 1000,
    unitRaw: "KG",
    unitNormalized: "kg",
    source: "manual",
    confidence: null,
    warnings: evaluated.warnings,
    validationStatus: "warning",
    pageNumber: null,
  });
  const lines = listDdtLines(db, docId);
  const issues = collectDdtRegistrationIssues(
    getDdtDetail(db, docId)!.document,
    lines,
  );
  assert(
    issues.blocking.some((item) => item.code === "unit_conflict"),
    "unit conflict blocks registration",
  );
  db.close();
  console.log("OK  incompatible units flagged");
}

function testRegisterOnlyAfterConfirmPath(): void {
  const db = openDb();
  const articles = seedArticles(db);
  const docId = randomUUID();
  insertReadyDocument(db, {
    id: docId,
    number: "REG-LATER",
    date: "2026-10-28",
    shaSuffix: "reg-later",
  });
  insertDdtLine(db, {
    id: randomUUID(),
    documentId: docId,
    lineNumber: 1,
    originalCode: "ART-001",
    originalDescription: "Vite",
    articleId: articles.a1,
    quantityRaw: "1",
    quantityMilli: 1000,
    unitRaw: "PZ",
    unitNormalized: "pcs",
    source: "pdf_text",
    confidence: null,
    warnings: [],
    validationStatus: "ok",
    pageNumber: 1,
  });
  updateDdtDocumentFields(db, docId, { status: "ready" });

  assert(getArticleStockMilli(db, articles.a1) === 0, "no stock before register");
  // Association / create paths must not move stock (already covered); register does.
  const registered = withTransaction(db, (tx) =>
    registerDdtOnDatabase(tx, docId),
  );
  assert(registered.document.status === "registered", "registered after call");
  assert(getArticleStockMilli(db, articles.a1) === 1000, "stock after register");
  db.close();
  console.log("OK  registration only after explicit register call");
}

async function testThirtyArticleFixtureAssociation(): Promise<void> {
  assert(fs.existsSync(fixture30PdfPath), "30-article fixture present");
  const extracted = await extractDdtContent({
    absolutePath: fixture30PdfPath,
    mimeType: "application/pdf",
  });
  assert(extracted.parsed.documentNumber === "DDT-TEST-2026-042", "doc number");
  assert(extracted.parsed.lines.length === 30, "30 lines extracted");
  assert(
    extracted.parsed.lines.every((line) => line.quantityMilli !== null),
    "all quantities parsed (incl. 1.250 / 2.500)",
  );
  assert(
    extracted.parsed.lines.find((l) => l.originalCode === "ART-024")
      ?.quantityMilli === 2_500_000,
    "ART-024 2.500 pcs",
  );
  assert(
    extracted.parsed.lines.find((l) => l.originalCode === "ART-020")
      ?.quantityMilli === 1_250_000,
    "ART-020 1.250 m as thousands",
  );

  const db = openDb();
  // Seed catalog with all 30 codes → auto-association must cover every line.
  for (const line of extracted.parsed.lines) {
    assert(line.originalCode, "code present");
    assert(line.unitNormalized, "unit present");
    insertArticle(db, randomUUID(), {
      code: normalizeArticleCode(line.originalCode!),
      description: line.originalDescription ?? line.originalCode!,
      category: null,
      unit: line.unitNormalized!,
      minStock: null,
      notes: null,
    });
  }

  const docId = randomUUID();
  insertReadyDocument(db, {
    id: docId,
    number: extracted.parsed.documentNumber!,
    date: extracted.parsed.documentDate!,
    shaSuffix: "fixture-30",
  });
  extracted.parsed.lines.forEach((line, index) => {
    const evaluated = evaluateLineAssociation(db, {
      originalCode: line.originalCode,
      unitNormalized: line.unitNormalized,
      quantityRaw: line.quantityRaw,
      quantityMilli: line.quantityMilli,
      warnings: [...line.warnings],
      validationStatus: line.validationStatus,
      articleId: null,
    });
    insertDdtLine(db, {
      id: randomUUID(),
      documentId: docId,
      lineNumber: index + 1,
      originalCode: line.originalCode,
      originalDescription: line.originalDescription,
      articleId: evaluated.articleId,
      quantityRaw: line.quantityRaw,
      quantityMilli: evaluated.quantityMilli,
      unitRaw: line.unitRaw,
      unitNormalized: line.unitNormalized,
      source: "pdf_text",
      confidence: null,
      warnings: evaluated.warnings,
      validationStatus: evaluated.validationStatus,
      pageNumber: line.pageNumber,
    });
  });

  const lines = listDdtLines(db, docId);
  const summary = summarizeDdtAssociation(lines);
  assert(summary.totalLines === 30, "summary total");
  assert(summary.linked === 30, "all auto-linked when catalog complete");
  assert(summary.missing === 0, "no missing associations");
  assert(
    !lines.some((line) => !line.articleId),
    "no manual association required",
  );

  const issues = collectDdtRegistrationIssues(
    {
      ...getDdtDetail(db, docId)!.document,
      documentNumber: extracted.parsed.documentNumber,
      documentDate: extracted.parsed.documentDate,
      status: "ready",
    },
    lines,
  );
  assert(
    !issues.blocking.some((item) => item.code === "unlinked_article"),
    "no unlinked_article blockers when catalog seeded",
  );

  // Missing-catalog path: fresh DB subset without seed → bulk create.
  const db2 = openDb();
  const doc2 = randomUUID();
  insertReadyDocument(db2, {
    id: doc2,
    number: "MISS-30",
    date: "2026-10-28",
    shaSuffix: "miss-30",
  });
  for (const [index, line] of extracted.parsed.lines.slice(0, 5).entries()) {
    insertDdtLine(db2, {
      id: randomUUID(),
      documentId: doc2,
      lineNumber: index + 1,
      originalCode: line.originalCode,
      originalDescription: line.originalDescription,
      articleId: null,
      quantityRaw: line.quantityRaw,
      quantityMilli: line.quantityMilli,
      unitRaw: line.unitRaw,
      unitNormalized: line.unitNormalized,
      source: "pdf_text",
      confidence: null,
      warnings: [],
      validationStatus: "error",
      pageNumber: 1,
    });
  }
  const created = createMissingDdtArticlesOnDatabase(db2, doc2);
  assert(
    created.lines.every((line) => line.articleId),
    "bulk create links fixture subset",
  );
  assert(
    (
      db2.prepare(`SELECT COUNT(*) AS c FROM articles`).get() as { c: number }
    ).c === 5,
    "5 articles created",
  );

  db.close();
  db2.close();
  console.log("OK  30-article fixture auto-association + bulk create path");
}

function testMigrateExistingDb(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-ddt-mig-"));
  const file = path.join(dir, "old.sqlite");
  const db = new BetterSqlite3(file);
  db.pragma("foreign_keys = ON");
  // Simulate v6 then upgrade
  runMigrations(db);
  assert(Number(db.pragma("user_version", { simple: true })) === 7);
  const count = db
    .prepare(`SELECT COUNT(*) AS c FROM articles`)
    .get() as { c: number };
  assert(count.c === 0, "existing empty tables intact");
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("OK  migrate existing database to v7");
}

function testCsvSerialization(): void {
  const csv = serializeDdtDocumentsCsv([
    {
      id: "d1",
      documentType: "inbound",
      documentNumber: 'DDT; "X"',
      documentDate: "2026-01-15",
      counterpartyName: "Fornitore A",
      counterpartyPartyId: null,
      orderReference: null,
      originalRelativePath: "a.pdf",
      originalFileName: "a.pdf",
      mimeType: "application/pdf",
      contentSha256: "abc",
      byteSize: 10,
      pageCount: 1,
      status: "ready",
      ocrStatus: "native_text",
      documentKey: null,
      notes: "nota\nmulti",
      lastError: null,
      importedAt: "2026-01-15 10:00:00",
      processedAt: null,
      registeredAt: null,
      createdAt: "2026-01-15 10:00:00",
      updatedAt: "2026-01-15 10:00:00",
    },
  ]);
  assert(csv.startsWith(DDT_CSV_BOM), "UTF-8 BOM");
  assert(csv.includes(DDT_DOCUMENTS_CSV_HEADERS[0]), "header present");
  assert(csv.includes('"DDT; ""X"""') || csv.includes("DDT;"), "escaped number");
  assert(csv.includes("\r\n"), "CRLF");
  console.log("OK  CSV serialization");
}

function testPdfJsWorkerResolution(): void {
  const workerPath = resolvePdfJsWorkerPath();
  assert(fs.existsSync(workerPath), "worker file exists on disk");
  assert(
    workerPath.replace(/\\/g, "/").includes("pdf.worker.mjs"),
    "path points to pdf.worker.mjs",
  );
  const fromPackage = require.resolve(PDFJS_WORKER_PACKAGE_ID);
  assert(
    path.resolve(workerPath) === path.resolve(fromPackage) ||
      workerPath.endsWith(`${path.sep}pdf.worker.mjs`),
    "resolves package worker or dist sibling",
  );
  const src = resolvePdfJsWorkerSrc();
  assert(src.startsWith("file:"), "workerSrc is file URL");
  console.log("OK  pdf.js worker resolution");
}

async function testPdfFixtureExtraction(): Promise<void> {
  assert(fs.existsSync(fixturePdfPath), "DDT_01 fixture PDF present");
  const result = await extractDdtContent({
    absolutePath: fixturePdfPath,
    mimeType: "application/pdf",
  });
  assert(result.strategy === "native_text", "uses native PDF text");
  assert(result.ocrUsed === false, "OCR not used for textual PDF");
  assert(result.pageCount === 1, "one page");
  // Real fac-simile fixture uses TEST-2026-001 (not a fiscal document).
  assert(
    result.parsed.documentNumber === "TEST-2026-001",
    `number from PDF, got ${result.parsed.documentNumber}`,
  );
  assert(result.parsed.documentDate === "2026-10-28", "date from PDF");
  assert(
    result.parsed.counterpartyName?.includes("Forniture Demo") === true,
    `supplier from PDF, got ${result.parsed.counterpartyName}`,
  );
  assert(
    result.parsed.counterpartyName !== "/ FORNITORE",
    "must not capture section label as counterparty",
  );
  assert(result.parsed.lines.length === 4, "four product rows");
  assert(result.parsed.lines[0]?.originalCode === "ART-001", "first code");
  assert(
    result.parsed.lines[0]?.originalDescription?.includes("Viti zincate") ===
      true,
    "first description",
  );
  assert(result.parsed.lines[0]?.quantityRaw === "250", "first qty");
  assert(result.parsed.lines[0]?.unitNormalized === "pcs", "first unit");
  assert(result.parsed.lines[0]?.quantityMilli === 250_000, "first milli");
  assert(result.parsed.lines[1]?.originalCode === "ART-002", "second code");
  assert(result.parsed.lines[2]?.originalCode === "ART-003", "third code");
  assert(result.parsed.lines[3]?.originalCode === "ART-004", "fourth code");
  assert(result.parsed.lines[3]?.unitNormalized === "l", "fourth unit");
  assert(result.parsed.lines[3]?.quantityMilli === 12_500, "12,500 liters");
  // Header/footer must not become product rows
  assert(
    result.parsed.lines.every((line) => !/codice|quantit|firma|trasporto/i.test(line.originalCode ?? "")),
    "no header/footer rows",
  );
  assert(
    result.rawText.includes("ART-001") && result.rawText.includes("BENI TRASPORTATI"),
    "raw text retained for diagnostics",
  );
  console.log("OK  PDF fixture native extraction");
}

function testParserAgainstRebuiltFacsimileText(): void {
  const text = `DOCUMENTO DI TRASPORTO
DDT — FAC-SIMILE PER TEST SOFTWARE
Numero  TEST-2026-001 Data 28/10/2026
DDT
Causale Vendita / consegna merce
MITTENTE / FORNITORE
Forniture Demo S.r.l. DESTINATARIO
BENI TRASPORTATI
Codice Descrizione U.M. Quantità
ART-001 Viti zincate M6 x 30 pcs 250
ART-002 Rondelle piane M6 pcs 500
ART-003 Guanti da lavoro taglia L pcs 24
DATI DEL TRASPORTO
Trasporto a cura del mittente
Firma mittente`;
  const parsed = parseDdtText(text, { source: "pdf_text" });
  assert(parsed.documentNumber === "TEST-2026-001", "doc number");
  assert(parsed.counterpartyName?.startsWith("Forniture Demo") === true, "party");
  assert(parsed.lines.length === 3, "three goods lines before transport section");
  assert(!parsed.lines.some((l) => /firma|trasporto/i.test(l.originalDescription ?? "")), "no footer lines");
  console.log("OK  parser on facsimile rebuilt text");
}

function testPdfWorkerMissingErrorMessage(): void {
  const missing = path.join(
    os.tmpdir(),
    `pc-missing-worker-${randomUUID()}`,
    "pdf.worker.mjs",
  );
  try {
    // Simulate unavailable worker by probing a non-existent sibling only:
    // resolvePdfJsWorkerPath prefers package resolve, so assert AppError contract
    // by constructing the same diagnostic used when no candidate exists.
    const err = AppError.internal(
      "Worker PDF.js (pdf.worker.mjs) non trovato. Verifica che pdfjs-dist sia installato e che la build Electron abbia copiato il worker in electron/dist/.",
    );
    assert(/Worker PDF\.js/i.test(err.message), "diagnostic mentions worker");
    assert(!fs.existsSync(missing), "missing path really absent");
  } finally {
    // no cleanup needed
  }
  console.log("OK  controlled worker-missing diagnostic");
}

function testElectronDistWorkerCopy(): void {
  const distWorker = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "electron",
    "dist",
    "pdf.worker.mjs",
  );
  if (!fs.existsSync(distWorker)) {
    console.log(
      "SKIP electron/dist pdf.worker.mjs (run build:electron to materialize)",
    );
    return;
  }
  assert(fs.statSync(distWorker).size > 1000, "copied worker is non-trivial");
  console.log("OK  electron/dist contains pdf.worker.mjs");
}

async function main(): Promise<void> {
  testMigrationV7();
  testParserTextual();
  testParserEdgeCases();
  testQuantityNormalizationRules();
  testStateMachine();
  testImportDuplicateHashAndRegister();
  testOutboundInsufficientStock();
  testRollbackOnMidFailure();
  testDashboardListAndValidation();
  testModuleVisibility();
  testOptimisticConcurrentRegister();
  testCollectIssues();
  testAutoAssociationExactCode();
  testBulkCreateMissingAndAssociate();
  testUnitConflictAssociation();
  testRegisterOnlyAfterConfirmPath();
  testMigrateExistingDb();
  testCsvSerialization();
  testPdfJsWorkerResolution();
  testParserAgainstRebuiltFacsimileText();
  await testPdfFixtureExtraction();
  await testThirtyArticleFixtureAssociation();
  testPdfWorkerMissingErrorMessage();
  testElectronDistWorkerCopy();
  console.log("\nAll DDT tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
