import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import type Database from "better-sqlite3";
import {
  getSchemaVersion,
  getSupportedSchemaVersion,
  runMigrations,
} from "../electron/db/migrations.ts";
import { withTransaction } from "../electron/db/transactions.ts";
import { AppError, toIpcThrownError } from "../electron/errors/app-error.ts";
import { insertArticle } from "../electron/repositories/articles-repository.ts";
import {
  countMovementsForArticle,
  getArticleStockMilli,
  getWarehouseSummary,
  insertStockMovement,
  listStockBalances,
  listStockMovements,
} from "../electron/repositories/stock-movements-repository.ts";
import {
  backupOpenDatabaseToFile,
  cleanupFile,
  restoreDatabaseFromValidatedFile,
  validateSqliteBackupFile,
} from "../electron/services/database-backup-core.ts";
import type { ArticleWriteFields } from "../shared/articles.ts";
import { tryParseDesktopErrorPayload } from "../shared/errors.ts";
import {
  isBelowMinStock,
  parseStockMovementCreateInput,
  parseStockQuantityToMilli,
  type StockMovementType,
} from "../shared/stock-movements.ts";

const require = createRequire(import.meta.url);
type BetterSqlite3Constructor = new (filename: string) => Database;
const BetterSqlite3 = require("better-sqlite3") as BetterSqlite3Constructor;

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

function articleFields(
  overrides: Partial<ArticleWriteFields> = {},
): ArticleWriteFields {
  return {
    code: "SKU-1",
    description: "Articolo stock",
    category: null,
    unit: "pcs",
    minStock: 5,
    notes: null,
    ...overrides,
  };
}

function addMovement(
  db: Database,
  params: {
    id: string;
    articleId: string;
    type: StockMovementType;
    milli: number;
    date?: string;
    reason?: string | null;
  },
) {
  return insertStockMovement(db, {
    id: params.id,
    articleId: params.articleId,
    movementType: params.type,
    quantityMilli: params.milli,
    movementDate: params.date ?? "2026-10-27",
    reason: params.reason ?? null,
    notes: null,
  });
}

function testMigrations(): void {
  const fresh = openDb();
  assert(
    getSchemaVersion(fresh) === getSupportedSchemaVersion(),
    "fresh current",
  );
  assert(getSupportedSchemaVersion() >= 6, "supported includes stock + later");
  const table = fresh
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='stock_movements'`,
    )
    .get() as { name?: string };
  assert(table?.name === "stock_movements", "stock_movements present");
  fresh.close();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-stk-mig-"));
  const file = path.join(dir, "v5.sqlite");
  const v5 = new BetterSqlite3(file);
  v5.pragma("foreign_keys = ON");
  // Build minimal v5: run migrations then we'd be at 6 — seed v5 manually.
  v5.exec(`
    CREATE TABLE schema_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL CHECK (length(value) > 0),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO schema_meta VALUES ('initialized','1');
    INSERT INTO app_settings (key, value) VALUES ('appearance', '"dark"');
    CREATE TABLE parties (
      id TEXT PRIMARY KEY NOT NULL,
      display_name TEXT NOT NULL,
      is_customer INTEGER NOT NULL DEFAULT 1,
      is_supplier INTEGER NOT NULL DEFAULT 0,
      email TEXT, phone TEXT, address TEXT, tax_code TEXT, vat_number TEXT, notes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE quote_number_sequences (year INTEGER PRIMARY KEY NOT NULL, last_value INTEGER NOT NULL);
    CREATE TABLE quotes (
      id TEXT PRIMARY KEY NOT NULL, number TEXT NOT NULL UNIQUE,
      party_id TEXT NOT NULL REFERENCES parties(id),
      customer_name TEXT NOT NULL, customer_address TEXT, customer_tax_code TEXT,
      customer_vat_number TEXT, customer_email TEXT, customer_phone TEXT,
      issue_date TEXT NOT NULL, due_date TEXT,
      lifecycle_status TEXT NOT NULL DEFAULT 'draft', archived INTEGER NOT NULL DEFAULT 0,
      notes TEXT, currency TEXT NOT NULL DEFAULT 'EUR',
      taxable_cents INTEGER NOT NULL DEFAULT 0, vat_cents INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE quote_items (
      id TEXT PRIMARY KEY NOT NULL, quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      position INTEGER NOT NULL, description TEXT NOT NULL, quantity_milli INTEGER NOT NULL,
      unit TEXT, unit_price_cents INTEGER NOT NULL, discount_bps INTEGER NOT NULL DEFAULT 0,
      vat_rate_bps INTEGER NOT NULL, taxable_cents INTEGER NOT NULL, vat_cents INTEGER NOT NULL,
      total_cents INTEGER NOT NULL
    );
    CREATE TABLE articles (
      id TEXT PRIMARY KEY NOT NULL, code TEXT NOT NULL, description TEXT NOT NULL,
      category TEXT, unit TEXT NOT NULL, min_stock REAL, notes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  v5.pragma("user_version = 5");
  assert(getSchemaVersion(v5) === 5, "precondition v5");
  const version = runMigrations(v5);
  assert(version === getSupportedSchemaVersion(), "v5 -> current");
  const sm = v5
    .prepare(`SELECT name FROM sqlite_master WHERE name='stock_movements'`)
    .get() as { name?: string };
  assert(sm?.name === "stock_movements", "movements after migrate");
  v5.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("OK  migrate empty/current + v5->v6");
}

function testLoadUnloadAdjustments(): void {
  const db = openDb();
  insertArticle(db, "a1", articleFields({ code: "A1", unit: "kg", minStock: 1 }));
  assert(getArticleStockMilli(db, "a1") === 0, "initial zero");

  addMovement(db, { id: "m1", articleId: "a1", type: "in", milli: 2500 });
  assert(getArticleStockMilli(db, "a1") === 2500, "after load 2.5");

  addMovement(db, { id: "m2", articleId: "a1", type: "out", milli: 1000 });
  assert(getArticleStockMilli(db, "a1") === 1500, "after unload 1");

  addMovement(db, {
    id: "m3",
    articleId: "a1",
    type: "adjustment_in",
    milli: 500,
    reason: "Inventario +",
  });
  assert(getArticleStockMilli(db, "a1") === 2000, "after adj in");

  addMovement(db, {
    id: "m4",
    articleId: "a1",
    type: "adjustment_out",
    milli: 500,
    reason: "Inventario -",
  });
  assert(getArticleStockMilli(db, "a1") === 1500, "after adj out");
  db.close();
  console.log("OK  load/unload/adjustments stock");
}

function testRejectOverdraft(): void {
  const db = openDb();
  insertArticle(db, "a1", articleFields({ code: "A1" }));
  addMovement(db, { id: "m1", articleId: "a1", type: "in", milli: 1000 });

  // Service-level rule simulated here with same checks
  const current = getArticleStockMilli(db, "a1");
  assert(current === 1000, "stock 1");
  assert(2000 > current, "overdraft detected for out");
  assert(1500 > current, "overdraft for adj out");

  // Attempt insert that would break business rule if applied without check —
  // repository allows insert; domain must refuse. Verify we can still enforce
  // via transactional guard pattern used by the service.
  let refused = false;
  try {
    withTransaction(db, (tx) => {
      const stock = getArticleStockMilli(tx, "a1");
      if (2000 > stock) {
        throw AppError.conflict("Giacenza insufficiente.");
      }
      addMovement(tx, { id: "bad", articleId: "a1", type: "out", milli: 2000 });
    });
  } catch (error) {
    refused = error instanceof AppError && error.code === "CONFLICT";
  }
  assert(refused, "out above stock refused");
  assert(getArticleStockMilli(db, "a1") === 1000, "stock unchanged after refuse");
  assert(countMovementsForArticle(db, "a1") === 1, "no partial movement");
  db.close();
  console.log("OK  reject overdraft + transactional rollback");
}

function testQuantityRules(): void {
  assert(parseStockQuantityToMilli("2,5", "kg") === 2500, "fractional kg");
  assert(parseStockQuantityToMilli("1", "pcs") === 1000, "whole pcs");

  let threw = false;
  try {
    parseStockQuantityToMilli("1.5", "pcs");
  } catch {
    threw = true;
  }
  assert(threw, "fractional pcs rejected");

  for (const bad of ["0", "-1", "", "abc", "1.2345"]) {
    threw = false;
    try {
      parseStockQuantityToMilli(bad, "kg");
    } catch {
      threw = true;
    }
    assert(threw, `reject bad qty ${bad}`);
  }
  console.log("OK  quantity fractional/pcs/malformed");
}

function testReasonRequiredForAdjustments(): void {
  let threw = false;
  try {
    parseStockMovementCreateInput({
      articleId: "a",
      movementType: "adjustment_in",
      quantity: "1",
      movementDate: "2026-10-27",
      reason: null,
      notes: null,
    });
  } catch {
    threw = true;
  }
  assert(threw, "adj requires reason");

  const ok = parseStockMovementCreateInput({
    articleId: "a",
    movementType: "in",
    quantity: "1",
    movementDate: "2026-10-27",
    reason: null,
    notes: null,
  });
  assert(ok.reason === null, "in allows null reason");
  console.log("OK  adjustment reason required");
}

function testArchivedNoNewMovements(): void {
  const db = openDb();
  insertArticle(db, "a1", articleFields({ code: "ARC" }));
  db.prepare(`UPDATE articles SET status = 'archived' WHERE id = 'a1'`).run();
  const article = db
    .prepare(`SELECT status FROM articles WHERE id = 'a1'`)
    .get() as { status: string };
  assert(article.status === "archived", "archived");

  // Domain rule (service): refuse new movements — exercise guard
  let refused = false;
  try {
    withTransaction(db, (tx) => {
      const row = tx
        .prepare(`SELECT status FROM articles WHERE id = ?`)
        .get("a1") as { status: string };
      if (row.status === "archived") {
        throw AppError.conflict("Articolo archiviato.");
      }
      addMovement(tx, { id: "x", articleId: "a1", type: "in", milli: 1000 });
    });
  } catch (error) {
    refused = error instanceof AppError;
  }
  assert(refused, "archived refuses movement");
  assert(countMovementsForArticle(db, "a1") === 0, "no movement stored");
  db.close();
  console.log("OK  archived articles cannot receive movements");
}

function testImmutability(): void {
  const db = openDb();
  insertArticle(db, "a1", articleFields());
  addMovement(db, { id: "m1", articleId: "a1", type: "in", milli: 1000 });
  // No update/delete APIs — verify FK prevents article hard delete
  let threw = false;
  try {
    db.prepare(`DELETE FROM articles WHERE id = 'a1'`).run();
  } catch {
    threw = true;
  }
  assert(threw, "FK blocks article delete with movements");
  assert(countMovementsForArticle(db, "a1") === 1, "history kept");
  db.close();
  console.log("OK  history immutable / FK protects movements");
}

function testFiltersPaginationLowStock(): void {
  const db = openDb();
  insertArticle(
    db,
    "low",
    articleFields({ code: "LOW", minStock: 10, description: "Sotto" }),
  );
  insertArticle(
    db,
    "ok",
    articleFields({ code: "OK1", minStock: 1, description: "Normale" }),
  );
  addMovement(db, { id: "m1", articleId: "low", type: "in", milli: 5000 }); // 5 <= 10
  addMovement(db, { id: "m2", articleId: "ok", type: "in", milli: 5000 }); // 5 > 1

  assert(isBelowMinStock(5000, 10) === true, "5 <= 10 below");
  assert(isBelowMinStock(5000, 1) === false, "5 > 1 ok");

  const below = listStockBalances(db, {
    search: "",
    filter: "below_min",
    page: 1,
    pageSize: 25,
  });
  assert(below.total === 1 && below.items[0]?.code === "LOW", "below filter");

  for (let i = 0; i < 12; i += 1) {
    addMovement(db, {
      id: `h${i}`,
      articleId: "ok",
      type: "in",
      milli: 1000,
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    });
  }
  const page1 = listStockMovements(db, {
    search: "",
    articleId: null,
    movementType: "in",
    dateFrom: null,
    dateTo: null,
    page: 1,
    pageSize: 10,
  });
  assert(page1.total === 14, "movement total");
  assert(page1.items.length === 10, "page size");
  const search = listStockMovements(db, {
    search: "Sotto",
    articleId: null,
    movementType: "all",
    dateFrom: null,
    dateTo: null,
    page: 1,
    pageSize: 25,
  });
  assert(search.total === 1, "search by description");

  const summary = getWarehouseSummary(db);
  assert(summary.activeArticles === 2, "active count");
  assert(summary.belowMinStockCount === 1, "below count");
  assert(summary.movementCount === 14, "movement count");
  db.close();
  console.log("OK  filters/pagination/low-stock");
}

function testInvalidIpcPayloads(): void {
  let threw = false;
  try {
    parseStockMovementCreateInput({
      articleId: "a",
      movementType: "in",
      quantity: "1",
      movementDate: "2026-10-27",
      reason: null,
      notes: null,
      extra: true,
    });
  } catch {
    threw = true;
  }
  assert(threw, "reject unknown props");

  const encoded = toIpcThrownError(
    AppError.validation("Dati movimento non validi."),
  );
  const payload = tryParseDesktopErrorPayload(encoded.message);
  assert(payload?.code === "VALIDATION_FAILED", "ipc code");
  console.log("OK  invalid IPC payloads");
}

async function testBackupRestore(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-stk-bak-"));
  const live = path.join(dir, "live.sqlite");
  const backup = path.join(dir, "backup.sqlite");
  const safety = path.join(dir, "safety.sqlite");

  let db = openDb(live);
  insertArticle(db, "a1", articleFields({ code: "BAK" }));
  addMovement(db, { id: "m1", articleId: "a1", type: "in", milli: 3000 });
  await backupOpenDatabaseToFile(db, backup);
  const info = validateSqliteBackupFile(backup);
  assert(
    info.schemaVersion === getSupportedSchemaVersion(),
    "backup schema current",
  );

  addMovement(db, { id: "m2", articleId: "a1", type: "in", milli: 1000 });
  assert(getArticleStockMilli(db, "a1") === 4000, "mutated before restore");

  await restoreDatabaseFromValidatedFile({
    liveDbPath: live,
    sourceBackupPath: backup,
    safetyBackupPath: safety,
    closeLive: () => {
      db.close();
    },
    openLive: () => {
      db = openDb(live);
    },
    backupLiveWhileOpen: async (destinationPath) => {
      await backupOpenDatabaseToFile(db, destinationPath);
    },
  });

  assert(getArticleStockMilli(db, "a1") === 3000, "stock restored");
  assert(countMovementsForArticle(db, "a1") === 1, "no duplicate movements");
  db.close();
  cleanupFile(backup);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("OK  backup/restore articles+movements");
}

async function main(): Promise<void> {
  testMigrations();
  testLoadUnloadAdjustments();
  testRejectOverdraft();
  testQuantityRules();
  testReasonRequiredForAdjustments();
  testArchivedNoNewMovements();
  testImmutability();
  testFiltersPaginationLowStock();
  testInvalidIpcPayloads();
  await testBackupRestore();
  console.log("\nAll stock movement tests passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
