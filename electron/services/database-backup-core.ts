import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { AppError } from "../errors/app-error.ts";
import {
  getSchemaVersion,
  getSupportedSchemaVersion,
} from "../db/migrations.ts";

const require = createRequire(import.meta.url);
type BetterSqlite3Constructor = new (
  filename: string,
  options?: { readonly?: boolean; fileMustExist?: boolean },
) => Database;
const BetterSqlite3 = require("better-sqlite3") as BetterSqlite3Constructor;

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "utf8");

export type ValidatedBackupInfo = {
  schemaVersion: number;
};

function mapIoError(error: unknown, fallback: string): AppError {
  if (error instanceof AppError) {
    return error;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("enospc") || message.includes("no space")) {
    return AppError.internal("Spazio su disco insufficiente.", error);
  }
  if (
    message.includes("eacces") ||
    message.includes("eperm") ||
    message.includes("readonly")
  ) {
    return AppError.internal("Destinazione non scrivibile.", error);
  }
  return AppError.internal(fallback, error);
}

export function assertSqliteFileHeader(filePath: string): void {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, "r");
    const header = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, header, 0, 16, 0);
    if (bytesRead < 16 || !header.equals(SQLITE_HEADER)) {
      throw AppError.validation("Il file selezionato non è un database SQLite valido.");
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw AppError.validation("Impossibile leggere il file selezionato.", error);
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
  }
}

export function validateSqliteBackupFile(filePath: string): ValidatedBackupInfo {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw AppError.validation("File di backup non trovato.");
  }

  assertSqliteFileHeader(filePath);

  let probe: Database | null = null;
  try {
    probe = new BetterSqlite3(filePath, {
      readonly: true,
      fileMustExist: true,
    });

    const check = String(probe.pragma("quick_check", { simple: true }) ?? "");
    if (check.toLowerCase() !== "ok") {
      throw AppError.validation("Il backup non supera il controllo di integrità.");
    }

    const schemaVersion = getSchemaVersion(probe);
    const supported = getSupportedSchemaVersion();
    if (schemaVersion > supported) {
      throw AppError.validation(
        "Il backup richiede una versione dell’applicazione più recente.",
      );
    }
    if (schemaVersion < 1) {
      throw AppError.validation("Il backup non contiene uno schema riconosciuto.");
    }

    const tableExists = (name: string): boolean => {
      const row = probe!
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
        )
        .get(name) as { name?: string } | undefined;
      return row?.name === name;
    };

    if (!tableExists("schema_meta")) {
      throw AppError.validation("Il backup non appartiene a questa applicazione.");
    }
    // Coherent markers for known schema versions (reject spoofed user_version).
    if (schemaVersion >= 2 && !tableExists("app_settings")) {
      throw AppError.validation("Il backup non contiene lo schema impostazioni atteso.");
    }
    if (schemaVersion >= 3 && !tableExists("parties")) {
      throw AppError.validation("Il backup non contiene lo schema anagrafiche atteso.");
    }
    if (schemaVersion >= 4 && !tableExists("quotes")) {
      throw AppError.validation("Il backup non contiene lo schema preventivi atteso.");
    }
    if (schemaVersion >= 4 && !tableExists("quote_items")) {
      throw AppError.validation("Il backup non contiene le righe preventivo attese.");
    }
    if (schemaVersion >= 5 && !tableExists("articles")) {
      throw AppError.validation("Il backup non contiene lo schema articoli atteso.");
    }
    if (schemaVersion >= 6 && !tableExists("stock_movements")) {
      throw AppError.validation(
        "Il backup non contiene lo schema movimenti di magazzino atteso.",
      );
    }
    if (schemaVersion >= 7 && !tableExists("ddt_documents")) {
      throw AppError.validation(
        "Il backup non contiene lo schema DDT atteso.",
      );
    }

    return { schemaVersion };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw AppError.validation("Il file selezionato non è un backup utilizzabile.", error);
  } finally {
    if (probe?.open) {
      probe.close();
    }
  }
}

/**
 * Creates a consistent SQLite backup of an open database into `destinationPath`
 * via better-sqlite3 online backup (temp file + final publish).
 */
export async function backupOpenDatabaseToFile(
  db: Database,
  destinationPath: string,
): Promise<void> {
  const directory = path.dirname(destinationPath);
  fs.mkdirSync(directory, { recursive: true });

  const tempPath = path.join(
    directory,
    `.${path.basename(destinationPath)}.${process.pid}.${Date.now()}.tmp`,
  );

  try {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }

    await db.backup(tempPath);
    validateSqliteBackupFile(tempPath);
    publishFileAtomically(tempPath, destinationPath);
    cleanupFile(tempPath);
  } catch (error) {
    cleanupFile(tempPath);
    throw mapIoError(error, "Impossibile creare il backup.");
  }
}

export function publishFileAtomically(sourcePath: string, destinationPath: string): void {
  const destinationDir = path.dirname(destinationPath);
  fs.mkdirSync(destinationDir, { recursive: true });

  const sameVolumeTemp = path.join(
    destinationDir,
    `.${path.basename(destinationPath)}.publish.${process.pid}.tmp`,
  );

  try {
    fs.copyFileSync(sourcePath, sameVolumeTemp);
    if (fs.existsSync(destinationPath)) {
      fs.unlinkSync(destinationPath);
    }
    fs.renameSync(sameVolumeTemp, destinationPath);
  } catch (error) {
    cleanupFile(sameVolumeTemp);
    throw mapIoError(error, "Impossibile scrivere il file di destinazione.");
  } finally {
    if (sourcePath !== destinationPath) {
      // Caller owns original source unless it was already the publish temp.
    }
  }
}

export function removeSqliteSidecars(dbPath: string): void {
  for (const suffix of ["-wal", "-shm"]) {
    cleanupFile(dbPath + suffix);
  }
}

export function cleanupFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Best-effort cleanup only.
  }
}

export type RestoreReplaceParams = {
  liveDbPath: string;
  sourceBackupPath: string;
  safetyBackupPath: string;
  closeLive: () => void;
  openLive: () => void;
  backupLiveWhileOpen: (destinationPath: string) => Promise<void>;
};

/**
 * Controlled restore: validate → safety backup → close → replace → reopen.
 * On failure, attempts to put the previous live database back.
 */
export async function restoreDatabaseFromValidatedFile(
  params: RestoreReplaceParams,
): Promise<ValidatedBackupInfo> {
  const validated = validateSqliteBackupFile(params.sourceBackupPath);

  fs.mkdirSync(path.dirname(params.safetyBackupPath), { recursive: true });
  await params.backupLiveWhileOpen(params.safetyBackupPath);

  const swapPath = `${params.liveDbPath}.pre-restore-${process.pid}`;
  const incomingPath = `${params.liveDbPath}.incoming-${process.pid}`;

  cleanupFile(swapPath);
  cleanupFile(incomingPath);
  removeSqliteSidecars(swapPath);
  removeSqliteSidecars(incomingPath);

  try {
    fs.copyFileSync(params.sourceBackupPath, incomingPath);
    validateSqliteBackupFile(incomingPath);

    params.closeLive();
    removeSqliteSidecars(params.liveDbPath);

    if (fs.existsSync(params.liveDbPath)) {
      fs.renameSync(params.liveDbPath, swapPath);
    }

    fs.renameSync(incomingPath, params.liveDbPath);

    try {
      params.openLive();
    } catch (openError) {
      // Roll back to the previous live database if reopen fails.
      cleanupFile(params.liveDbPath);
      removeSqliteSidecars(params.liveDbPath);
      if (fs.existsSync(swapPath)) {
        fs.renameSync(swapPath, params.liveDbPath);
      } else if (fs.existsSync(params.safetyBackupPath)) {
        fs.copyFileSync(params.safetyBackupPath, params.liveDbPath);
      }
      try {
        params.openLive();
      } catch (reopenError) {
        throw AppError.internal(
          "Ripristino non riuscito e recupero automatico incompleto.",
          reopenError,
        );
      }
      throw AppError.internal(
        "Ripristino non riuscito. È stato mantenuto il database precedente.",
        openError,
      );
    }

    cleanupFile(swapPath);
    removeSqliteSidecars(swapPath);
    return validated;
  } catch (error) {
    cleanupFile(incomingPath);
    removeSqliteSidecars(incomingPath);
    if (error instanceof AppError) {
      throw error;
    }
    throw mapIoError(error, "Ripristino non riuscito.");
  }
}

export function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
