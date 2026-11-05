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
import { AppError, toIpcThrownError } from "../electron/errors/app-error.ts";
import {
  findArticleByCode,
  findArticleById,
  insertArticle,
  listArticles,
  setArticleStatus,
  updateArticleFields,
} from "../electron/repositories/articles-repository.ts";
import {
  backupOpenDatabaseToFile,
  cleanupFile,
  restoreDatabaseFromValidatedFile,
  validateSqliteBackupFile,
} from "../electron/services/database-backup-core.ts";
import {
  normalizeArticleCode,
  parseArticleCreateInput,
  parseArticleListQuery,
  parseArticleUpdateInput,
  type ArticleWriteFields,
} from "../shared/articles.ts";
import { tryParseDesktopErrorPayload } from "../shared/errors.ts";

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

function sampleFields(
  overrides: Partial<ArticleWriteFields> = {},
): ArticleWriteFields {
  return {
    code: "SKU-100",
    description: "Articolo di prova",
    category: "Generale",
    unit: "pcs",
    minStock: 5,
    notes: null,
    ...overrides,
  };
}

function testFreshAndMigrateToV5(): void {
  const fresh = openDb();
  assert(
    getSchemaVersion(fresh) === getSupportedSchemaVersion(),
    "fresh reaches current schema",
  );
  assert(getSupportedSchemaVersion() >= 6, "supported includes stock movements");
  const table = fresh
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='articles'`,
    )
    .get() as { name?: string };
  assert(table?.name === "articles", "articles table present");
  fresh.close();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-art-mig-"));
  const file = path.join(dir, "v4.sqlite");
  const db = new BetterSqlite3(file);
  db.pragma("foreign_keys = ON");
  // Run only through v4 by inserting migrations manually via full run then...
  // Simpler: run migrations then pretend - actually seed v4 by running and
  // checking we can migrate from a DB created at previous version.
  // Create v4-shaped DB: run migrations, then if already 5, create from scratch
  // by applying migrations 1-4 only via pragma trick.
  db.close();

  const v4 = new BetterSqlite3(file);
  v4.pragma("foreign_keys = ON");
  // Apply foundation through quotes by calling migrations that stop at 4:
  // Insert schema as current project would after v4 by using runMigrations
  // then deleting articles if present — cleaner: use older approach from quotes tests.
  v4.exec(`
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
    CREATE TABLE quote_number_sequences (
      year INTEGER PRIMARY KEY NOT NULL,
      last_value INTEGER NOT NULL
    );
    CREATE TABLE quotes (
      id TEXT PRIMARY KEY NOT NULL,
      number TEXT NOT NULL UNIQUE,
      party_id TEXT NOT NULL REFERENCES parties(id),
      customer_name TEXT NOT NULL,
      customer_address TEXT, customer_tax_code TEXT, customer_vat_number TEXT,
      customer_email TEXT, customer_phone TEXT,
      issue_date TEXT NOT NULL,
      due_date TEXT,
      lifecycle_status TEXT NOT NULL DEFAULT 'draft',
      archived INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      currency TEXT NOT NULL DEFAULT 'EUR',
      taxable_cents INTEGER NOT NULL DEFAULT 0,
      vat_cents INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE quote_items (
      id TEXT PRIMARY KEY NOT NULL,
      quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      description TEXT NOT NULL,
      quantity_milli INTEGER NOT NULL,
      unit TEXT,
      unit_price_cents INTEGER NOT NULL,
      discount_bps INTEGER NOT NULL DEFAULT 0,
      vat_rate_bps INTEGER NOT NULL,
      taxable_cents INTEGER NOT NULL,
      vat_cents INTEGER NOT NULL,
      total_cents INTEGER NOT NULL
    );
  `);
  v4.pragma("user_version = 4");
  assert(getSchemaVersion(v4) === 4, "precondition v4");
  const version = runMigrations(v4);
  assert(
    version === getSupportedSchemaVersion(),
    "v4 migrates to current schema",
  );
  const articles = v4
    .prepare(`SELECT name FROM sqlite_master WHERE name='articles'`)
    .get() as { name?: string };
  assert(articles?.name === "articles", "articles after migrate");
  const movements = v4
    .prepare(`SELECT name FROM sqlite_master WHERE name='stock_movements'`)
    .get() as { name?: string };
  assert(movements?.name === "stock_movements", "stock_movements after migrate");
  const appearance = v4
    .prepare(`SELECT value FROM app_settings WHERE key='appearance'`)
    .get() as { value?: string };
  assert(appearance.value === '"dark"', "settings preserved");
  v4.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("OK  fresh current + migrate v4->current");
}

function testCreateUpdate(): void {
  const db = openDb();
  const created = insertArticle(db, "art-1", sampleFields());
  assert(created.code === "SKU-100", "code stored");
  assert(created.unit === "pcs", "unit stored");
  assert(created.minStock === 5, "min stock");
  assert(created.status === "active", "active default");

  const updated = updateArticleFields(
    db,
    "art-1",
    sampleFields({
      description: "Aggiornato",
      unit: "kg",
      minStock: null,
      category: null,
    }),
  );
  assert(updated?.description === "Aggiornato", "description updated");
  assert(updated?.unit === "kg", "unit updated");
  assert(updated?.minStock === null, "min stock cleared");
  assert(findArticleById(db, "art-1")?.category === null, "category cleared");
  db.close();
  console.log("OK  create/update articles");
}

function testCodeUniquenessAndNormalization(): void {
  assert(normalizeArticleCode("  ab-1  ") === "AB-1", "normalize trim+upper");
  assert(normalizeArticleCode("a  b") === "A B", "collapse spaces");

  const db = openDb();
  insertArticle(db, "a1", sampleFields({ code: normalizeArticleCode("sku-9") }));
  let threw = false;
  try {
    insertArticle(db, "a2", sampleFields({ code: normalizeArticleCode("Sku-9") }));
  } catch {
    threw = true;
  }
  assert(threw, "duplicate case-insensitive code rejected by unique index");
  assert(findArticleByCode(db, "SKU-9")?.id === "a1", "lookup by normalized");

  // Parsed create input normalizes before insert path.
  const parsed = parseArticleCreateInput({
    code: "  mixEd ",
    description: "X",
    category: null,
    unit: "m",
    minStock: null,
    notes: null,
  });
  assert(parsed.code === "MIXED", "parser normalizes code");
  db.close();
  console.log("OK  code uniqueness + normalization");
}

function testSearchPagination(): void {
  const db = openDb();
  for (let i = 1; i <= 30; i += 1) {
    insertArticle(
      db,
      `id-${i}`,
      sampleFields({
        code: `C${String(i).padStart(3, "0")}`,
        description: i % 2 === 0 ? `Filtro Alfa ${i}` : `Beta ${i}`,
        category: i <= 5 ? "Tessuti" : null,
      }),
    );
  }
  const page1 = listArticles(db, {
    search: "",
    status: "active",
    page: 1,
    pageSize: 10,
  });
  assert(page1.total === 30, "total 30");
  assert(page1.items.length === 10, "page size 10");
  assert(page1.items[0]?.code === "C001", "sorted by code");

  const page2 = listArticles(db, {
    search: "",
    status: "active",
    page: 2,
    pageSize: 10,
  });
  assert(page2.items[0]?.code === "C011", "page 2 offset");

  const search = listArticles(db, {
    search: "Alfa",
    status: "active",
    page: 1,
    pageSize: 50,
  });
  assert(search.total === 15, "search description");
  assert(search.items.every((a) => a.description.includes("Alfa")), "all match");

  const byCode = listArticles(db, {
    search: "C005",
    status: "active",
    page: 1,
    pageSize: 10,
  });
  assert(byCode.total === 1 && byCode.items[0]?.code === "C005", "search code");

  const byCat = listArticles(db, {
    search: "Tessuti",
    status: "active",
    page: 1,
    pageSize: 20,
  });
  assert(byCat.total === 5, "search category");
  db.close();
  console.log("OK  search + pagination");
}

function testUnitsAndMinStock(): void {
  const db = openDb();
  for (const unit of ["pcs", "kg", "g", "l", "m", "m2"] as const) {
    insertArticle(
      db,
      `u-${unit}`,
      sampleFields({ code: `U-${unit}`, unit, minStock: 0 }),
    );
  }
  assert(findArticleById(db, "u-m2")?.unit === "m2", "m2 unit");

  let threw = false;
  try {
    parseArticleCreateInput({
      code: "X",
      description: "Y",
      category: null,
      unit: "tons",
      minStock: null,
      notes: null,
    });
  } catch {
    threw = true;
  }
  assert(threw, "unknown unit rejected");

  threw = false;
  try {
    parseArticleCreateInput({
      code: "X",
      description: "Y",
      category: null,
      unit: "pcs",
      minStock: -1,
      notes: null,
    });
  } catch {
    threw = true;
  }
  assert(threw, "negative minStock rejected");

  threw = false;
  try {
    db.prepare(
      `INSERT INTO articles (id, code, description, unit, min_stock, status)
       VALUES ('bad', 'BAD', 'Bad', 'pcs', -3, 'active')`,
    ).run();
  } catch {
    threw = true;
  }
  assert(threw, "DB check rejects negative min_stock");
  db.close();
  console.log("OK  units + min stock validation");
}

function testArchiveReactivate(): void {
  const db = openDb();
  insertArticle(db, "arc-1", sampleFields({ code: "ARC-1" }));
  setArticleStatus(db, "arc-1", "archived");
  assert(findArticleById(db, "arc-1")?.status === "archived", "archived");
  const activeOnly = listArticles(db, {
    search: "",
    status: "active",
    page: 1,
    pageSize: 10,
  });
  assert(activeOnly.total === 0, "hidden when active filter");
  const archived = listArticles(db, {
    search: "",
    status: "archived",
    page: 1,
    pageSize: 10,
  });
  assert(archived.total === 1, "visible when archived filter");
  setArticleStatus(db, "arc-1", "active");
  assert(findArticleById(db, "arc-1")?.status === "active", "reactivated");
  // Soft archive only — row still present
  const count = db.prepare(`SELECT COUNT(*) AS c FROM articles`).get() as {
    c: number;
  };
  assert(count.c === 1, "no physical delete");
  db.close();
  console.log("OK  archive/reactivate (no hard delete)");
}

function testInvalidPayloads(): void {
  let threw = false;
  try {
    parseArticleCreateInput({ code: "", description: "X", unit: "pcs", minStock: null, category: null, notes: null, extra: 1 });
  } catch {
    threw = true;
  }
  assert(threw, "extra props / empty code");

  threw = false;
  try {
    parseArticleUpdateInput({
      id: "x",
      code: "A",
      description: "B",
      category: null,
      unit: "pcs",
      minStock: null,
      notes: null,
      hack: true,
    });
  } catch {
    threw = true;
  }
  assert(threw, "unknown update prop");

  threw = false;
  try {
    parseArticleListQuery({ page: 0 });
  } catch {
    threw = true;
  }
  assert(threw, "invalid page");

  const encoded = toIpcThrownError(
    AppError.validation("Dati articolo non validi."),
  );
  const payload = tryParseDesktopErrorPayload(encoded.message);
  assert(payload?.code === "VALIDATION_FAILED", "ipc validation code");
  assert(
    !encoded.message.includes("C:\\") && !encoded.message.includes("SELECT"),
    "sanitized",
  );
  console.log("OK  invalid IPC payloads");
}

function testParameterizedSearch(): void {
  const db = openDb();
  insertArticle(
    db,
    "inj",
    sampleFields({
      code: "SAFE",
      description: "Normale",
    }),
  );
  const result = listArticles(db, {
    search: "'; DROP TABLE articles;--",
    status: "all",
    page: 1,
    pageSize: 10,
  });
  assert(result.total === 0, "injection yields empty");
  assert(findArticleById(db, "inj") !== null, "table intact");
  db.close();
  console.log("OK  parameterized search resists injection");
}

async function testBackupRestoreArticles(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-art-bak-"));
  const live = path.join(dir, "live.sqlite");
  const backup = path.join(dir, "backup.sqlite");
  const safety = path.join(dir, "safety.sqlite");

  let db = openDb(live);
  insertArticle(
    db,
    "bak-1",
    sampleFields({ code: "BAK-1", description: "Nel backup" }),
  );
  await backupOpenDatabaseToFile(db, backup);
  validateSqliteBackupFile(backup);

  updateArticleFields(db, "bak-1", sampleFields({ code: "BAK-1", description: "Changed" }));

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

  assert(
    findArticleById(db, "bak-1")?.description === "Nel backup",
    "article restored",
  );
  assert(
    getSchemaVersion(db) === getSupportedSchemaVersion(),
    "schema still current",
  );
  db.close();
  cleanupFile(backup);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("OK  backup/restore articles");
}

async function main(): Promise<void> {
  testFreshAndMigrateToV5();
  testCreateUpdate();
  testCodeUniquenessAndNormalization();
  testSearchPagination();
  testUnitsAndMinStock();
  testArchiveReactivate();
  testInvalidPayloads();
  testParameterizedSearch();
  await testBackupRestoreArticles();
  console.log("\nAll articles/magazzino tests passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
