import { app, BrowserWindow, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import { AppError } from "../errors/app-error.ts";
import {
  closeDatabase,
  getDatabase,
  getDatabaseFilePath,
  openDatabase,
} from "../db/connection.ts";
import type {
  DatabaseBackupResult,
  DatabaseRestoreResult,
} from "../../shared/database-backup.ts";
import { APP_TECHNICAL_NAME } from "../../shared/modules.ts";
import {
  backupOpenDatabaseToFile,
  cleanupFile,
  restoreDatabaseFromValidatedFile,
} from "./database-backup-core.ts";

function getDialogParent(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

function defaultBackupFileName(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${APP_TECHNICAL_NAME.toLowerCase()}-backup-${stamp}.sqlite`;
}

function safetyBackupPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(
    app.getPath("userData"),
    "safety-backups",
    `pre-restore-${stamp}.sqlite`,
  );
}

export async function createDatabaseBackup(): Promise<DatabaseBackupResult> {
  const parent = getDialogParent();
  const saveOptions = {
    title: "Salva backup database",
    defaultPath: defaultBackupFileName(),
    filters: [{ name: "Database SQLite", extensions: ["sqlite"] }],
    properties: ["createDirectory", "showOverwriteConfirmation"] as Array<
      "createDirectory" | "showOverwriteConfirmation"
    >,
  };
  const result = parent
    ? await dialog.showSaveDialog(parent, saveOptions)
    : await dialog.showSaveDialog(saveOptions);

  if (result.canceled || !result.filePath) {
    return { status: "cancelled" };
  }

  let targetPath = result.filePath;
  if (!targetPath.toLowerCase().endsWith(".sqlite")) {
    targetPath = `${targetPath}.sqlite`;
  }

  // If we had to append .sqlite and that target already exists, the save dialog
  // did not confirm overwrite for the final name — refuse silent replacement.
  if (targetPath !== result.filePath && fs.existsSync(targetPath)) {
    throw AppError.conflict(
      "Esiste già un file con questo nome. Scegli un nome diverso.",
    );
  }

  const db = getDatabase();
  await backupOpenDatabaseToFile(db, targetPath);

  return {
    status: "completed",
    fileName: path.basename(targetPath),
  };
}

export async function restoreDatabaseBackup(): Promise<DatabaseRestoreResult> {
  const parent = getDialogParent();
  const openOptions = {
    title: "Seleziona backup da ripristinare",
    filters: [{ name: "Database SQLite", extensions: ["sqlite"] }],
    properties: ["openFile"] as Array<"openFile">,
  };
  const result = parent
    ? await dialog.showOpenDialog(parent, openOptions)
    : await dialog.showOpenDialog(openOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return { status: "cancelled" };
  }

  const sourcePath = result.filePaths[0];
  if (!sourcePath) {
    return { status: "cancelled" };
  }

  const liveDbPath = getDatabaseFilePath();
  const safetyPath = safetyBackupPath();

  const restored = await restoreDatabaseFromValidatedFile({
    liveDbPath,
    sourceBackupPath: sourcePath,
    safetyBackupPath: safetyPath,
    closeLive: () => {
      closeDatabase();
    },
    openLive: () => {
      openDatabase();
    },
    backupLiveWhileOpen: async (destinationPath) => {
      await backupOpenDatabaseToFile(getDatabase(), destinationPath);
    },
  });

  return {
    status: "completed",
    schemaVersion: restored.schemaVersion,
  };
}

/** Test helper: remove a leftover temp publish artifact if present. */
export function discardTempArtifact(filePath: string): void {
  cleanupFile(filePath);
}
