import { app } from "electron";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type Database from "better-sqlite3";
import { AppError } from "../errors/app-error.ts";
import {
  getSchemaVersion,
  getSupportedSchemaVersion,
  runMigrations,
} from "./migrations.ts";
import { withTransaction } from "./transactions.ts";

const require = createRequire(import.meta.url);
type BetterSqlite3Constructor = new (filename: string) => Database;
const BetterSqlite3 = require("better-sqlite3") as BetterSqlite3Constructor;

const DB_FILE_NAME = "projectcore.sqlite";

let database: Database | null = null;

/** Absolute DB path under Electron userData — main process only, never send to renderer. */
export function getDatabaseFilePath(): string {
  return path.join(app.getPath("userData"), DB_FILE_NAME);
}

export function isDatabaseOpen(): boolean {
  return Boolean(database?.open);
}

/** Returns the open database or throws a public AppError (no path details). */
export function getDatabase(): Database {
  if (!database?.open) {
    throw AppError.internal("Database non disponibile.");
  }
  return database;
}

/**
 * Runs atomic work on the app database connection.
 * See `withTransaction` for sync/rollback semantics.
 */
export function withAppTransaction<T>(work: (db: Database) => T): T {
  return withTransaction(getDatabase(), work);
}

export function openDatabase(): Database {
  if (database?.open) {
    return database;
  }

  const filePath = getDatabaseFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const next = new BetterSqlite3(filePath);
  next.pragma("journal_mode = WAL");
  next.pragma("foreign_keys = ON");
  runMigrations(next);
  database = next;

  return next;
}

export function closeDatabase(): void {
  if (database?.open) {
    database.close();
  }
  database = null;
}

export type InternalDatabaseStatus = {
  initialized: boolean;
  schemaVersion: number;
  healthy: boolean;
  open: boolean;
  /** Main-only diagnostics — never include in IPC payloads. */
  filePath: string;
};

export function getInternalDatabaseStatus(): InternalDatabaseStatus {
  const filePath = getDatabaseFilePath();

  if (!database?.open) {
    return {
      initialized: false,
      schemaVersion: 0,
      healthy: false,
      open: false,
      filePath,
    };
  }

  try {
    const schemaVersion = getSchemaVersion(database);
    const initializedRow = database
      .prepare(`SELECT value FROM schema_meta WHERE key = ?`)
      .get("initialized") as { value?: string } | undefined;

    const initialized =
      initializedRow?.value === "1" &&
      schemaVersion >= getSupportedSchemaVersion();
    const probe = database.prepare("SELECT 1 AS ok").get() as { ok?: number };

    return {
      initialized,
      schemaVersion,
      healthy: initialized && probe?.ok === 1,
      open: true,
      filePath,
    };
  } catch {
    return {
      initialized: false,
      schemaVersion: 0,
      healthy: false,
      open: true,
      filePath,
    };
  }
}
