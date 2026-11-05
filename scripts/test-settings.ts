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
import {
  readAppSettings,
  writeAppSettings,
} from "../electron/repositories/app-settings-repository.ts";
import {
  DEFAULT_APP_SETTINGS,
  parseAppSettings,
} from "../shared/app-settings.ts";
import { tryParseDesktopErrorPayload } from "../shared/errors.ts";

const require = createRequire(import.meta.url);
type BetterSqlite3Constructor = new (filename: string) => Database;
const BetterSqlite3 = require("better-sqlite3") as BetterSqlite3Constructor;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function seedSchemaV1(db: Database): void {
  db.exec(`
    CREATE TABLE schema_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);
  db.prepare(
    `INSERT INTO schema_meta (key, value) VALUES ('initialized', '1')`,
  ).run();
  db.pragma("user_version = 1");
}

function testFreshDatabaseReachesCurrent(): void {
  const db = new BetterSqlite3(":memory:");
  const version = runMigrations(db);
  assert(
    version === getSupportedSchemaVersion(),
    "fresh database should reach current schema",
  );
  assert(version >= 2, "settings schema must be present");
  const settings = readAppSettings(db);
  assert(
    settings.appearance === DEFAULT_APP_SETTINGS.appearance &&
      settings.accentColor === DEFAULT_APP_SETTINGS.accentColor &&
      settings.compactMode === DEFAULT_APP_SETTINGS.compactMode,
    "defaults must be seeded",
  );
  db.close();
  console.log("OK  fresh database -> current schema with defaults");
}

function testMigrateV1ToCurrent(): void {
  const db = new BetterSqlite3(":memory:");
  seedSchemaV1(db);
  assert(getSchemaVersion(db) === 1, "precondition: schema v1");
  const version = runMigrations(db);
  assert(
    version === getSupportedSchemaVersion(),
    "v1 database should migrate to current schema",
  );
  const table = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_settings'`,
    )
    .get() as { name?: string } | undefined;
  assert(table?.name === "app_settings", "app_settings table must exist after migrate");
  const meta = db
    .prepare(`SELECT value FROM schema_meta WHERE key = 'initialized'`)
    .get() as { value?: string };
  assert(meta.value === "1", "existing schema_meta data must remain");
  db.close();
  console.log("OK  migrate v1 -> current");
}

function testReadWriteAndValidation(): void {
  const db = new BetterSqlite3(":memory:");
  runMigrations(db);

  writeAppSettings(db, {
    appearance: "light",
    accentColor: "indigo",
    compactMode: true,
  });
  const saved = readAppSettings(db);
  assert(saved.appearance === "light", "appearance should persist");
  assert(saved.accentColor === "indigo", "accentColor should persist");
  assert(saved.compactMode === true, "compactMode should persist");

  let rejected = false;
  try {
    parseAppSettings({
      appearance: "dark",
      accentColor: "teal",
      compactMode: false,
      unexpected: true,
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "unknown properties must be rejected");

  rejected = false;
  try {
    parseAppSettings({
      appearance: "neon",
      accentColor: "teal",
      compactMode: false,
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "invalid appearance must be rejected");

  db.close();
  console.log("OK  read/write + validation");
}

function testPersistAcrossReopen(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "projectcore-settings-"));
  const filePath = path.join(dir, "test.sqlite");

  {
    const db = new BetterSqlite3(filePath);
    runMigrations(db);
    writeAppSettings(db, {
      appearance: "light",
      accentColor: "rose",
      compactMode: true,
    });
    db.close();
  }

  {
    const db = new BetterSqlite3(filePath);
    runMigrations(db);
    const settings = readAppSettings(db);
    assert(settings.appearance === "light", "appearance survives reopen");
    assert(settings.accentColor === "rose", "accent survives reopen");
    assert(settings.compactMode === true, "compactMode survives reopen");
    assert(
      getSchemaVersion(db) === getSupportedSchemaVersion(),
      "schema remains at current version",
    );
    db.close();
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log("OK  persistence across reopen");
}

function testWriteRollback(): void {
  const db = new BetterSqlite3(":memory:");
  runMigrations(db);
  writeAppSettings(db, DEFAULT_APP_SETTINGS);

  let threw = false;
  try {
    withTransaction(db, (tx) => {
      writeAppSettings(tx, {
        appearance: "light",
        accentColor: "amber",
        compactMode: true,
      });
      throw new Error("forced-settings-failure");
    });
  } catch (error) {
    threw = true;
    assert(
      error instanceof Error && error.message === "forced-settings-failure",
      "original error must surface",
    );
  }

  assert(threw, "transaction must fail");
  const settings = readAppSettings(db);
  assert(
    settings.appearance === "dark" &&
      settings.accentColor === "teal" &&
      settings.compactMode === false,
    "failed write must roll back to previous settings",
  );
  db.close();
  console.log("OK  settings write rollback");
}

function testIpcErrorSanitization(): void {
  const encoded = toIpcThrownError(
    AppError.validation('Valore non valido per "appearance".'),
  );
  const payload = tryParseDesktopErrorPayload(encoded.message);
  assert(payload?.code === "VALIDATION_FAILED", "validation maps to public code");
  assert(
    !encoded.message.includes("SELECT") && !encoded.message.includes("C:\\"),
    "validation IPC error must stay free of SQL/paths",
  );

  const originalError = console.error;
  console.error = () => undefined;
  const internal = toIpcThrownError(
    new Error("SQLITE_ERROR near app_settings at C:\\secret\\projectcore.sqlite"),
  );
  console.error = originalError;
  const internalPayload = tryParseDesktopErrorPayload(internal.message);
  assert(internalPayload?.code === "INTERNAL_ERROR", "unexpected becomes INTERNAL_ERROR");
  assert(
    !internal.message.includes("SQLITE_ERROR") &&
      !internal.message.includes("secret"),
    "internal IPC payload must not leak DB details",
  );
  console.log("OK  IPC error sanitization");
}

testFreshDatabaseReachesCurrent();
testMigrateV1ToCurrent();
testReadWriteAndValidation();
testPersistAcrossReopen();
testWriteRollback();
testIpcErrorSanitization();
console.log("All settings tests passed.");
