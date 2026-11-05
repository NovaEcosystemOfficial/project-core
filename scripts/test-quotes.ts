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
import { insertParty } from "../electron/repositories/parties-repository.ts";
import {
  allocateQuoteNumber,
  findQuoteById,
  insertQuote,
  listQuotes,
  replaceQuoteDraft,
  setQuoteArchived,
  setQuoteLifecycleStatus,
} from "../electron/repositories/quotes-repository.ts";
import {
  backupOpenDatabaseToFile,
  cleanupFile,
  restoreDatabaseFromValidatedFile,
  validateSqliteBackupFile,
} from "../electron/services/database-backup-core.ts";
import {
  calculateLineMoney,
  parseQuantityToMilli,
  roundHalfUp,
} from "../shared/quotes-money.ts";
import {
  computeQuoteDocument,
  parseQuoteUpdateInput,
  parseQuoteWriteInput,
  type QuoteItemInput,
} from "../shared/quotes.ts";
import { tryParseDesktopErrorPayload } from "../shared/errors.ts";
import { withTransaction } from "../electron/db/transactions.ts";

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

function seedCustomer(
  db: Database,
  id = "cust-1",
  overrides: Partial<{
    displayName: string;
    isCustomer: boolean;
    isSupplier: boolean;
    status: "active" | "archived";
    address: string | null;
  }> = {},
) {
  insertParty(db, id, {
    displayName: overrides.displayName ?? "Cliente Demo",
    isCustomer: overrides.isCustomer ?? true,
    isSupplier: overrides.isSupplier ?? false,
    email: "cliente@example.com",
    phone: "021234",
    address: overrides.address ?? "Via Roma 1",
    taxCode: "CLDCLD00A00A000A",
    vatNumber: "IT12345678901",
    notes: null,
  });
  if (overrides.status === "archived") {
    db.prepare(`UPDATE parties SET status = 'archived' WHERE id = ?`).run(id);
  }
  return id;
}

function sampleItems(
  overrides: Partial<QuoteItemInput> = {},
): QuoteItemInput[] {
  return [
    {
      description: "Servizio consulenza",
      quantity: "2",
      unit: "h",
      unitPrice: "100.00",
      discountPercent: "10",
      vatRatePercent: "22",
      ...overrides,
    },
  ];
}

function testFreshAndMigrateV3ToCurrent(): void {
  const fresh = openDb();
  assert(
    getSchemaVersion(fresh) === getSupportedSchemaVersion(),
    "fresh reaches current schema",
  );
  assert(getSupportedSchemaVersion() >= 5, "supported includes articles");
  const tables = fresh
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('quotes','quote_items','quote_number_sequences')`,
    )
    .all() as { name: string }[];
  assert(tables.length === 3, "quote tables exist");
  fresh.close();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-q-mig-"));
  const file = path.join(dir, "v3.sqlite");
  const db = new BetterSqlite3(file);
  db.pragma("foreign_keys = ON");
  // Seed v3 manually:
  db.exec(`
    CREATE TABLE schema_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE parties (
      id TEXT PRIMARY KEY NOT NULL,
      display_name TEXT NOT NULL,
      is_customer INTEGER NOT NULL DEFAULT 0,
      is_supplier INTEGER NOT NULL DEFAULT 0,
      email TEXT, phone TEXT, address TEXT, tax_code TEXT, vat_number TEXT, notes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare(`INSERT INTO schema_meta VALUES ('initialized','1')`).run();
  db.pragma("user_version = 3");
  assert(getSchemaVersion(db) === 3, "precondition v3");
  const version = runMigrations(db);
  assert(
    version === getSupportedSchemaVersion(),
    "v3 migrates to current schema",
  );
  const quotes = db
    .prepare(`SELECT name FROM sqlite_master WHERE name='quotes'`)
    .get() as { name?: string };
  assert(quotes?.name === "quotes", "quotes after migrate");
  const articles = db
    .prepare(`SELECT name FROM sqlite_master WHERE name='articles'`)
    .get() as { name?: string };
  assert(articles?.name === "articles", "articles after migrate from v3");
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("OK  fresh current + migrate v3->current");
}

function testMoneyCalculations(): void {
  // 2 * 100.00 = 20000 cents; 10% discount = 2000; taxable 18000; 22% VAT = 3960; total 21960
  const line = calculateLineMoney({
    quantityMilli: 2000,
    unitPriceCents: 10_000,
    discountBps: 1000,
    vatRateBps: 2200,
  });
  assert(line.taxableCents === 18_000, "taxable after discount");
  assert(line.vatCents === 3960, "vat half-up");
  assert(line.totalCents === 21_960, "line total");

  // decimal qty 1.5 * 10.00 = 15.00
  const q = parseQuantityToMilli("1.5");
  assert(q === 1500, "milli quantity");
  const line2 = calculateLineMoney({
    quantityMilli: q,
    unitPriceCents: 1000,
    discountBps: 0,
    vatRateBps: 2200,
  });
  assert(line2.taxableCents === 1500, "1.5*10");
  assert(line2.vatCents === 330, "22% of 15.00");
  assert(roundHalfUp(2.5) === 3, "half-up");

  const doc = computeQuoteDocument([
    {
      description: "A",
      quantity: "1",
      unit: null,
      unitPrice: "10.00",
      discountPercent: "0",
      vatRatePercent: "22",
    },
    {
      description: "B",
      quantity: "1",
      unit: null,
      unitPrice: "10.00",
      discountPercent: "0",
      vatRatePercent: "10",
    },
  ]);
  assert(doc.taxableCents === 2000, "sum taxable");
  assert(doc.vatCents === 220 + 100, "sum vat per line");
  assert(doc.totalCents === 2320, "sum totals");
  console.log("OK  money calculations + rounding");
}

function testCreateReadUpdateArchive(): void {
  const db = openDb();
  seedCustomer(db);
  const computed = computeQuoteDocument(sampleItems());
  const itemIds = ["item-1"];
  const number = withTransaction(db, (tx) => allocateQuoteNumber(tx, 2026));
  assert(number === "PREV-2026-0001", "first number");

  const created = insertQuote(db, {
    id: "quote-1",
    number,
    partyId: "cust-1",
    customer: {
      name: "Cliente Demo",
      address: "Via Roma 1",
      taxCode: "CLDCLD00A00A000A",
      vatNumber: "IT12345678901",
      email: "cliente@example.com",
      phone: "021234",
    },
    issueDate: "2026-10-27",
    dueDate: "2026-11-27",
    notes: "Condizioni 30gg",
    computed: {
      ...computed,
      items: computed.items.map((item, i) => ({ ...item, id: itemIds[i]! })),
    },
    itemIds,
  });
  assert(created.number === "PREV-2026-0001", "created number");
  assert(created.totalCents === 21_960, "created total");
  assert(created.items.length === 1, "one item");

  const read = findQuoteById(db, "quote-1");
  assert(read?.customer.name === "Cliente Demo", "snapshot name");

  // mutate party — snapshot must remain
  db.prepare(`UPDATE parties SET display_name = 'Nuovo Nome' WHERE id = 'cust-1'`).run();
  const afterPartyChange = findQuoteById(db, "quote-1");
  assert(
    afterPartyChange?.customer.name === "Cliente Demo",
    "snapshot preserved",
  );

  const updatedComputed = computeQuoteDocument(
    sampleItems({ quantity: "1", discountPercent: "0" }),
  );
  const updated = replaceQuoteDraft(db, {
    id: "quote-1",
    partyId: "cust-1",
    customer: afterPartyChange!.customer,
    issueDate: "2026-10-27",
    dueDate: null,
    notes: null,
    computed: {
      ...updatedComputed,
      items: updatedComputed.items.map((item) => ({ ...item, id: "item-2" })),
    },
    itemIds: ["item-2"],
  });
  assert(updated?.items.length === 1, "replaced items");
  assert(updated?.items[0]?.id === "item-2", "new item id");

  setQuoteLifecycleStatus(db, "quote-1", "sent");
  const blocked = replaceQuoteDraft(db, {
    id: "quote-1",
    partyId: "cust-1",
    customer: afterPartyChange!.customer,
    issueDate: "2026-10-27",
    dueDate: null,
    notes: null,
    computed: {
      ...updatedComputed,
      items: updatedComputed.items.map((item) => ({ ...item, id: "item-3" })),
    },
    itemIds: ["item-3"],
  });
  assert(blocked === null, "non-draft cannot update amounts");

  setQuoteArchived(db, "quote-1", true);
  const archivedList = listQuotes(db, {
    search: "",
    archive: "archived",
    lifecycleStatus: "all",
    page: 1,
    pageSize: 25,
  });
  assert(archivedList.total === 1, "archived listed");

  db.close();
  console.log("OK  create/read/update/archive + snapshot");
}

function testCustomerValidationCases(): void {
  const db = openDb();
  seedCustomer(db, "ok");
  seedCustomer(db, "supplier-only", {
    displayName: "Solo fornitore",
    isCustomer: false,
    isSupplier: true,
  });
  seedCustomer(db, "archived-cust", {
    displayName: "Archiviato",
    status: "archived",
  });

  // FK: missing party should fail insert
  let fkFailed = false;
  try {
    const computed = computeQuoteDocument(sampleItems());
    insertQuote(db, {
      id: "q-missing",
      number: "PREV-2026-0099",
      partyId: "missing",
      customer: {
        name: "X",
        address: null,
        taxCode: null,
        vatNumber: null,
        email: null,
        phone: null,
      },
      issueDate: "2026-01-01",
      dueDate: null,
      notes: null,
      computed: {
        ...computed,
        items: computed.items.map((item) => ({ ...item, id: "i1" })),
      },
      itemIds: ["i1"],
    });
  } catch {
    fkFailed = true;
  }
  assert(fkFailed, "FK rejects missing party");

  const fkOn = db.pragma("foreign_keys", { simple: true });
  assert(Number(fkOn) === 1, "foreign_keys enabled");

  db.close();
  console.log("OK  FK + foreign_keys pragma");
}

function testNumberUniquenessAndConcurrency(): void {
  const db = openDb();
  seedCustomer(db);
  const numbers = new Set<string>();
  withTransaction(db, (tx) => {
    for (let i = 0; i < 20; i += 1) {
      numbers.add(allocateQuoteNumber(tx, 2026));
    }
  });
  assert(numbers.size === 20, "20 unique numbers in one transaction");
  assert(numbers.has("PREV-2026-0001"), "starts at 0001");
  assert(numbers.has("PREV-2026-0020"), "ends at 0020");

  const nextYear = withTransaction(db, (tx) => allocateQuoteNumber(tx, 2027));
  assert(nextYear === "PREV-2027-0001", "year rollover resets sequence");
  db.close();
  console.log("OK  number uniqueness + year rollover");
}

function testPayloadValidation(): void {
  let rejected = false;
  try {
    parseQuoteWriteInput({
      partyId: "a",
      issueDate: "2026-01-01",
      dueDate: null,
      notes: null,
      items: sampleItems(),
      unexpected: true,
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "unknown props rejected");

  rejected = false;
  try {
    parseQuoteWriteInput({
      partyId: "a",
      issueDate: "2026-01-01",
      dueDate: null,
      notes: null,
      items: sampleItems({ quantity: "0" }),
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "zero quantity rejected");

  rejected = false;
  try {
    parseQuoteWriteInput({
      partyId: "a",
      issueDate: "2026-01-01",
      dueDate: null,
      notes: null,
      items: sampleItems({ discountPercent: "150" }),
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "invalid discount rejected");

  rejected = false;
  try {
    parseQuoteUpdateInput({
      id: "q1",
      partyId: "a",
      issueDate: "2026-01-01",
      dueDate: null,
      notes: null,
      items: sampleItems({ vatRatePercent: "21" }),
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "unsupported VAT rejected");

  console.log("OK  payload validation");
}

function testParameterizedSearch(): void {
  const db = openDb();
  seedCustomer(db);
  const computed = computeQuoteDocument(sampleItems());
  const number = withTransaction(db, (tx) => allocateQuoteNumber(tx, 2026));
  insertQuote(db, {
    id: "q-safe",
    number,
    partyId: "cust-1",
    customer: {
      name: "Cliente Demo",
      address: null,
      taxCode: null,
      vatNumber: null,
      email: null,
      phone: null,
    },
    issueDate: "2026-01-01",
    dueDate: null,
    notes: null,
    computed: {
      ...computed,
      items: computed.items.map((item) => ({ ...item, id: "is" })),
    },
    itemIds: ["is"],
  });
  const injected = listQuotes(db, {
    search: "'; DROP TABLE quotes; --",
    archive: "all",
    lifecycleStatus: "all",
    page: 1,
    pageSize: 25,
  });
  assert(injected.total === 0, "injection is literal");
  assert(findQuoteById(db, "q-safe"), "table intact");
  db.close();
  console.log("OK  parameterized search");
}

async function testBackupRestoreQuotes(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-q-bak-"));
  const live = path.join(dir, "live.sqlite");
  const backup = path.join(dir, "backup.sqlite");
  const safety = path.join(dir, "safety.sqlite");

  let db = openDb(live);
  seedCustomer(db);
  const computed = computeQuoteDocument(sampleItems());
  const number = withTransaction(db, (tx) => allocateQuoteNumber(tx, 2026));
  insertQuote(db, {
    id: "q-bak",
    number,
    partyId: "cust-1",
    customer: {
      name: "Cliente Demo",
      address: "Via Roma 1",
      taxCode: null,
      vatNumber: null,
      email: null,
      phone: null,
    },
    issueDate: "2026-05-01",
    dueDate: null,
    notes: null,
    computed: {
      ...computed,
      items: computed.items.map((item) => ({ ...item, id: "ib" })),
    },
    itemIds: ["ib"],
  });
  await backupOpenDatabaseToFile(db, backup);
  const info = validateSqliteBackupFile(backup);
  assert(
    info.schemaVersion === getSupportedSchemaVersion(),
    "backup schema current",
  );

  // mutate then restore
  db.prepare(`DELETE FROM quote_items`).run();
  db.prepare(`DELETE FROM quotes`).run();

  await restoreDatabaseFromValidatedFile({
    liveDbPath: live,
    sourceBackupPath: backup,
    safetyBackupPath: safety,
    closeLive: () => db.close(),
    openLive: () => {
      db = openDb(live);
    },
    backupLiveWhileOpen: async (destinationPath) => {
      await backupOpenDatabaseToFile(db, destinationPath);
    },
  });

  const restored = findQuoteById(db, "q-bak");
  assert(restored?.number === "PREV-2026-0001", "quote restored");
  assert(restored?.items.length === 1, "items restored");
  const next = withTransaction(db, (tx) => allocateQuoteNumber(tx, 2026));
  assert(next === "PREV-2026-0002", "sequence survives restore");
  db.close();
  cleanupFile(backup);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("OK  backup/restore quotes + sequence");
}

function testPublicErrors(): void {
  const encoded = toIpcThrownError(
    AppError.conflict("Solo i preventivi in bozza possono essere modificati."),
  );
  const payload = tryParseDesktopErrorPayload(encoded.message);
  assert(payload?.code === "CONFLICT", "conflict code");
  assert(
    !encoded.message.includes("SELECT") && !encoded.message.includes("C:\\"),
    "sanitized",
  );
  console.log("OK  public quote errors sanitized");
}

async function main(): Promise<void> {
  testFreshAndMigrateV3ToCurrent();
  testMoneyCalculations();
  testCreateReadUpdateArchive();
  testCustomerValidationCases();
  testNumberUniquenessAndConcurrency();
  testPayloadValidation();
  testParameterizedSearch();
  testPublicErrors();
  await testBackupRestoreQuotes();
  console.log("All quotes tests passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
