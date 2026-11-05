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
  findPartyById,
  insertParty,
  listParties,
  setPartyStatus,
  updatePartyFields,
} from "../electron/repositories/parties-repository.ts";
import {
  backupOpenDatabaseToFile,
  cleanupFile,
  restoreDatabaseFromValidatedFile,
  validateSqliteBackupFile,
} from "../electron/services/database-backup-core.ts";
import {
  parsePartyCreateInput,
  parsePartyListQuery,
  parsePartyUpdateInput,
  type PartyWriteFields,
} from "../shared/parties.ts";
import { tryParseDesktopErrorPayload } from "../shared/errors.ts";

const require = createRequire(import.meta.url);
type BetterSqlite3Constructor = new (
  filename: string,
  options?: { readonly?: boolean; fileMustExist?: boolean },
) => Database;
const BetterSqlite3 = require("better-sqlite3") as BetterSqlite3Constructor;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function sampleFields(
  overrides: Partial<PartyWriteFields> = {},
): PartyWriteFields {
  return {
    displayName: "Acme Srl",
    isCustomer: true,
    isSupplier: false,
    email: "info@example.com",
    phone: "+39 02 1234567",
    address: "Via Roma 1",
    taxCode: "ACMACM00A00A000A",
    vatNumber: "IT12345678901",
    notes: null,
    ...overrides,
  };
}

function seedSchemaV2(db: Database): void {
  db.exec(`
    CREATE TABLE schema_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL CHECK (length(value) > 0),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare(
    `INSERT INTO schema_meta (key, value) VALUES ('initialized', '1')`,
  ).run();
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('appearance', '"dark"')`,
  ).run();
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('accentColor', '"teal"')`,
  ).run();
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('compactMode', 'false')`,
  ).run();
  db.pragma("user_version = 2");
}

function testFreshDatabaseReachesV3(): void {
  const db = new BetterSqlite3(":memory:");
  const version = runMigrations(db);
  assert(
    version === getSupportedSchemaVersion(),
    "fresh database should reach current schema",
  );
  assert(version >= 3, "parties schema must be present");
  const table = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'parties'`,
    )
    .get() as { name?: string } | undefined;
  assert(table?.name === "parties", "parties table must exist");
  db.close();
  console.log("OK  fresh database -> v3 with parties");
}

function testMigrateV2ToV3(): void {
  const db = new BetterSqlite3(":memory:");
  seedSchemaV2(db);
  assert(getSchemaVersion(db) === 2, "precondition: schema v2");
  const version = runMigrations(db);
  assert(
    version === getSupportedSchemaVersion(),
    "v2 database should migrate to current schema",
  );
  const settings = db
    .prepare(`SELECT value FROM app_settings WHERE key = 'appearance'`)
    .get() as { value?: string };
  assert(settings.value === '"dark"', "existing settings must remain");
  const parties = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'parties'`,
    )
    .get() as { name?: string } | undefined;
  assert(parties?.name === "parties", "parties table after v3");
  db.close();
  console.log("OK  migrate v2 -> v3");
}

function testCreateReadUpdate(): void {
  const db = new BetterSqlite3(":memory:");
  runMigrations(db);

  const created = insertParty(db, "party-1", sampleFields());
  assert(created.id === "party-1", "id must be stable");
  assert(created.displayName === "Acme Srl", "display name stored");
  assert(created.isCustomer === true, "customer role");
  assert(created.isSupplier === false, "supplier role");
  assert(created.status === "active", "default status active");
  assert(typeof created.createdAt === "string", "createdAt present");
  assert(typeof created.updatedAt === "string", "updatedAt present");

  const read = findPartyById(db, "party-1");
  assert(read?.email === "info@example.com", "email round-trip");

  const updated = updatePartyFields(
    db,
    "party-1",
    sampleFields({
      displayName: "Acme Spa",
      isSupplier: true,
      phone: null,
    }),
  );
  assert(updated?.displayName === "Acme Spa", "name updated");
  assert(updated?.isSupplier === true, "both roles allowed");
  assert(updated?.phone === null, "optional phone cleared");

  db.close();
  console.log("OK  create/read/update");
}

function testSearchAndPagination(): void {
  const db = new BetterSqlite3(":memory:");
  runMigrations(db);

  insertParty(db, "a", sampleFields({ displayName: "Alpha Client", email: "a@ex.com" }));
  insertParty(db, "b", sampleFields({
    displayName: "Beta Supplier",
    isCustomer: false,
    isSupplier: true,
    email: "b@ex.com",
  }));
  insertParty(db, "c", sampleFields({ displayName: "Gamma Both", isSupplier: true }));
  insertParty(db, "d", sampleFields({ displayName: "Delta Hidden", email: "delta@ex.com" }));

  const page1 = listParties(db, {
    search: "",
    status: "active",
    page: 1,
    pageSize: 2,
  });
  assert(page1.total === 4, "total active count");
  assert(page1.items.length === 2, "page size respected");
  assert(
    page1.items[0]?.displayName === "Alpha Client",
    "deterministic sort by name",
  );
  assert(page1.items[1]?.displayName === "Beta Supplier", "second sorted row");

  const page2 = listParties(db, {
    search: "",
    status: "active",
    page: 2,
    pageSize: 2,
  });
  assert(page2.items[0]?.displayName === "Delta Hidden", "page 2 offset");

  const search = listParties(db, {
    search: "beta",
    status: "all",
    page: 1,
    pageSize: 25,
  });
  assert(search.total === 1, "search filters in database");
  assert(search.items[0]?.id === "b", "search hit");

  const likeEscape = listParties(db, {
    search: "%",
    status: "all",
    page: 1,
    pageSize: 25,
  });
  assert(likeEscape.total === 0, "LIKE metacharacters must be escaped");

  db.close();
  console.log("OK  search + pagination");
}

function testArchiveAndReactivate(): void {
  const db = new BetterSqlite3(":memory:");
  runMigrations(db);
  insertParty(db, "p1", sampleFields());

  const archived = setPartyStatus(db, "p1", "archived");
  assert(archived?.status === "archived", "archived");

  const activeOnly = listParties(db, {
    search: "",
    status: "active",
    page: 1,
    pageSize: 25,
  });
  assert(activeOnly.total === 0, "archived excluded from active list");

  const reactivated = setPartyStatus(db, "p1", "active");
  assert(reactivated?.status === "active", "reactivated");

  db.close();
  console.log("OK  archive + reactivate");
}

function testPayloadValidation(): void {
  let rejected = false;
  try {
    parsePartyCreateInput({
      ...sampleFields(),
      unexpected: true,
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "unknown properties must be rejected");

  rejected = false;
  try {
    parsePartyCreateInput({
      ...sampleFields({ displayName: "   " }),
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "blank displayName rejected");

  rejected = false;
  try {
    parsePartyCreateInput({
      ...sampleFields({ isCustomer: false, isSupplier: false }),
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "at least one role required");

  rejected = false;
  try {
    parsePartyListQuery({ pageSize: 500 });
  } catch {
    rejected = true;
  }
  assert(rejected, "oversized pageSize rejected");

  rejected = false;
  try {
    parsePartyUpdateInput({
      id: "ok-id",
      ...sampleFields(),
      extra: 1,
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "update rejects extra keys");

  const query = parsePartyListQuery({
    search: "  acme ",
    status: "archived",
    page: 2,
    pageSize: 10,
  });
  assert(query.search === "acme", "search trimmed");
  assert(query.status === "archived", "status parsed");
  assert(query.page === 2 && query.pageSize === 10, "pagination parsed");

  console.log("OK  payload validation");
}

function testConflictsAndNotFound(): void {
  const db = new BetterSqlite3(":memory:");
  runMigrations(db);
  insertParty(db, "p1", sampleFields());

  const missing = findPartyById(db, "missing");
  assert(missing === null, "missing id returns null");

  const noUpdate = updatePartyFields(db, "missing", sampleFields());
  assert(noUpdate === null, "update missing returns null");

  // Service-level conflict semantics covered via status checks.
  const first = setPartyStatus(db, "p1", "archived");
  assert(first?.status === "archived", "first archive ok");
  const still = findPartyById(db, "p1");
  assert(still?.status === "archived", "status persists");

  db.close();
  console.log("OK  conflicts/not-found repository semantics");
}

function testParameterizedQueriesDoNotInject(): void {
  const db = new BetterSqlite3(":memory:");
  runMigrations(db);
  insertParty(db, "safe", sampleFields({ displayName: "Safe Party" }));

  const injected = listParties(db, {
    search: "'; DROP TABLE parties; --",
    status: "all",
    page: 1,
    pageSize: 25,
  });
  assert(injected.total === 0, "injection string is literal search");
  const stillThere = findPartyById(db, "safe");
  assert(stillThere?.displayName === "Safe Party", "table intact");
  db.close();
  console.log("OK  parameterized search resists injection");
}

function testPublicErrorsSanitized(): void {
  const encoded = toIpcThrownError(
    AppError.validation("Dati anagrafica non validi."),
  );
  const payload = tryParseDesktopErrorPayload(encoded.message);
  assert(payload?.code === "VALIDATION_FAILED", "validation code");
  assert(
    !encoded.message.includes("INSERT") &&
      !encoded.message.includes("parties") &&
      !encoded.message.includes("C:\\"),
    "public error must not expose SQL/paths",
  );
  console.log("OK  public party errors sanitized");
}

async function testBackupRestoreWithParties(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-parties-bak-"));
  const live = path.join(dir, "live.sqlite");
  const backup = path.join(dir, "backup.sqlite");
  const safety = path.join(dir, "safety.sqlite");

  let db = new BetterSqlite3(live);
  db.pragma("journal_mode = WAL");
  runMigrations(db);
  insertParty(db, "keep-me", sampleFields({ displayName: "Keep Me" }));
  await backupOpenDatabaseToFile(db, backup);

  const info = validateSqliteBackupFile(backup);
  assert(
    info.schemaVersion === getSupportedSchemaVersion(),
    "backup schema matches supported",
  );

  insertParty(db, "later", sampleFields({ displayName: "Later" }));

  await restoreDatabaseFromValidatedFile({
    liveDbPath: live,
    sourceBackupPath: backup,
    safetyBackupPath: safety,
    closeLive: () => {
      db.close();
    },
    openLive: () => {
      db = new BetterSqlite3(live);
      db.pragma("journal_mode = WAL");
      runMigrations(db);
    },
    backupLiveWhileOpen: async (destinationPath) => {
      await backupOpenDatabaseToFile(db, destinationPath);
    },
  });

  assert(fs.existsSync(safety), "safety backup created");
  assert(findPartyById(db, "keep-me")?.displayName === "Keep Me", "restored party");
  assert(findPartyById(db, "later") === null, "post-backup inserts discarded");
  assert(
    getSchemaVersion(db) === getSupportedSchemaVersion(),
    "schema current after restore",
  );
  assert(db.open, "connection reopened");

  db.close();
  cleanupFile(backup);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("OK  backup/restore preserves parties data");
}

async function main(): Promise<void> {
  testFreshDatabaseReachesV3();
  testMigrateV2ToV3();
  testCreateReadUpdate();
  testSearchAndPagination();
  testArchiveAndReactivate();
  testPayloadValidation();
  testConflictsAndNotFound();
  testParameterizedQueriesDoNotInject();
  testPublicErrorsSanitized();
  await testBackupRestoreWithParties();
  console.log("All parties tests passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
