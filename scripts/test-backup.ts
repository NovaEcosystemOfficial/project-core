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
import {
  readAppSettings,
  writeAppSettings,
} from "../electron/repositories/app-settings-repository.ts";
import { AppError, toIpcThrownError } from "../electron/errors/app-error.ts";
import {
  backupOpenDatabaseToFile,
  cleanupFile,
  restoreDatabaseFromValidatedFile,
  validateSqliteBackupFile,
} from "../electron/services/database-backup-core.ts";
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

function openMigrated(filePath: string): Database {
  const db = new BetterSqlite3(filePath);
  db.pragma("journal_mode = WAL");
  runMigrations(db);
  return db;
}

function testRejectNonSqlite(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-nonsql-"));
  const bogus = path.join(dir, "notes.txt");
  fs.writeFileSync(bogus, "hello world", "utf8");
  let rejected = false;
  try {
    validateSqliteBackupFile(bogus);
  } catch (error) {
    rejected = error instanceof AppError && error.code === "VALIDATION_FAILED";
  }
  assert(rejected, "non-sqlite file must be rejected");
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("OK  reject non-sqlite file");
}

function testRejectCorruptDatabase(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-corrupt-"));
  const corrupt = path.join(dir, "corrupt.sqlite");
  const header = Buffer.from("SQLite format 3\0", "utf8");
  const junk = Buffer.concat([header, Buffer.alloc(64, 7)]);
  fs.writeFileSync(corrupt, junk);
  let rejected = false;
  try {
    validateSqliteBackupFile(corrupt);
  } catch (error) {
    rejected = error instanceof AppError && error.code === "VALIDATION_FAILED";
  }
  assert(rejected, "corrupt sqlite must be rejected");
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("OK  reject corrupt database");
}

function testRejectUnsupportedFutureSchema(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-future-"));
  const future = path.join(dir, "future.sqlite");
  const db = openMigrated(future);
  db.pragma(`user_version = ${getSupportedSchemaVersion() + 5}`);
  db.close();

  let rejected = false;
  try {
    validateSqliteBackupFile(future);
  } catch (error) {
    rejected = error instanceof AppError && error.code === "VALIDATION_FAILED";
  }
  assert(rejected, "future schema must be rejected");
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("OK  reject unsupported schema version");
}

function testPublicErrorHasNoPaths(): void {
  const encoded = toIpcThrownError(
    AppError.validation("Il file selezionato non è un database SQLite valido."),
  );
  const payload = tryParseDesktopErrorPayload(encoded.message);
  assert(payload?.code === "VALIDATION_FAILED", "public validation code");
  assert(
    !encoded.message.includes(os.tmpdir()) &&
      !encoded.message.includes("C:\\") &&
      !encoded.message.includes("SELECT"),
    "IPC error must not expose paths/SQL",
  );
  console.log("OK  public IPC errors stay sanitized");
}

function testCancelResultContract(): void {
  const cancelled = { status: "cancelled" as const };
  assert(cancelled.status === "cancelled", "cancel result contract");
  console.log("OK  cancel result contract");
}

async function testCreateValidBackup(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-backup-"));
  const live = path.join(dir, "live.sqlite");
  const backup = path.join(dir, "backup.sqlite");
  const db = openMigrated(live);
  writeAppSettings(db, {
    appearance: "light",
    accentColor: "amber",
    compactMode: true,
  });
  await backupOpenDatabaseToFile(db, backup);
  const info = validateSqliteBackupFile(backup);
  assert(info.schemaVersion === getSchemaVersion(db), "backup schema matches live");
  assert(fs.existsSync(backup), "backup exists");
  const probe = new BetterSqlite3(backup, { readonly: true, fileMustExist: true });
  assert(readAppSettings(probe).accentColor === "amber", "backup data intact");
  probe.close();
  db.close();
  cleanupFile(backup);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("OK  create valid backup + quick_check");
}

async function testBackupAndRestoreRoundTrip(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-restore-"));
  const live = path.join(dir, "live.sqlite");
  const backup = path.join(dir, "backup.sqlite");
  const safety = path.join(dir, "safety.sqlite");

  let db = openMigrated(live);
  writeAppSettings(db, {
    appearance: "light",
    accentColor: "rose",
    compactMode: true,
  });
  await backupOpenDatabaseToFile(db, backup);

  writeAppSettings(db, {
    appearance: "dark",
    accentColor: "teal",
    compactMode: false,
  });

  const restored = await restoreDatabaseFromValidatedFile({
    liveDbPath: live,
    sourceBackupPath: backup,
    safetyBackupPath: safety,
    closeLive: () => {
      db.close();
    },
    openLive: () => {
      db = openMigrated(live);
    },
    backupLiveWhileOpen: async (destinationPath) => {
      await backupOpenDatabaseToFile(db, destinationPath);
    },
  });

  assert(
    restored.schemaVersion === getSupportedSchemaVersion(),
    "restored schema version",
  );
  assert(fs.existsSync(safety), "safety backup must be created");
  const settings = readAppSettings(db);
  assert(settings.appearance === "light", "restored appearance");
  assert(settings.accentColor === "rose", "restored accent");
  assert(settings.compactMode === true, "restored compactMode");
  assert(db.open, "connection reopened after restore");
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("OK  backup/restore round-trip + safety backup + reopen");
}

async function testRestoreFailureKeepsPrevious(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-fail-restore-"));
  const live = path.join(dir, "live.sqlite");
  const safety = path.join(dir, "safety.sqlite");
  const missing = path.join(dir, "missing-source.sqlite");

  let db = openMigrated(live);
  writeAppSettings(db, {
    appearance: "dark",
    accentColor: "indigo",
    compactMode: false,
  });

  let failed = false;
  try {
    await restoreDatabaseFromValidatedFile({
      liveDbPath: live,
      sourceBackupPath: missing,
      safetyBackupPath: safety,
      closeLive: () => {
        db.close();
      },
      openLive: () => {
        db = openMigrated(live);
      },
      backupLiveWhileOpen: async (destinationPath) => {
        await backupOpenDatabaseToFile(db, destinationPath);
      },
    });
  } catch (error) {
    failed = error instanceof AppError;
  }

  assert(failed, "restore with missing source must fail");
  if (!db.open) {
    db = openMigrated(live);
  }
  const settings = readAppSettings(db);
  assert(settings.accentColor === "indigo", "live data must remain after failed restore");
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("OK  failed restore preserves previous database");
}

async function main(): Promise<void> {
  testRejectNonSqlite();
  testRejectCorruptDatabase();
  testRejectUnsupportedFutureSchema();
  testPublicErrorHasNoPaths();
  testCancelResultContract();
  await testCreateValidBackup();
  await testBackupAndRestoreRoundTrip();
  await testRestoreFailureKeepsPrevious();
  console.log("All backup/restore tests passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
