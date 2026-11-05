import { BrowserWindow, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import { AppError } from "../errors/app-error.ts";
import { getDatabase } from "../db/connection.ts";
import { listPartiesForExport } from "../repositories/parties-repository.ts";
import { APP_TECHNICAL_NAME } from "../../shared/modules.ts";
import { serializePartiesCsv } from "../../shared/parties-csv.ts";
import {
  PARTY_EXPORT_MAX_ROWS,
  parsePartyExportFilter,
  type PartiesCsvExportResult,
} from "../../shared/parties-csv-export.ts";

function getDialogParent(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

function defaultCsvFileName(): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${APP_TECHNICAL_NAME.toLowerCase()}-anagrafiche-${stamp}.csv`;
}

function mapWriteError(error: unknown): AppError {
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
  return AppError.internal("Impossibile scrivere il file CSV.", error);
}

/**
 * Exports filtered parties to a user-chosen CSV path via a native save dialog.
 * Opens the dialog only when there is at least one matching row.
 */
export async function exportPartiesCsv(
  input: unknown,
): Promise<PartiesCsvExportResult> {
  let filter;
  try {
    filter = parsePartyExportFilter(input);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Parametri di esportazione non validi.";
    throw AppError.validation(message, error);
  }

  let queryResult;
  try {
    queryResult = listPartiesForExport(
      getDatabase(),
      filter,
      PARTY_EXPORT_MAX_ROWS,
    );
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw AppError.internal("Impossibile leggere le anagrafiche da esportare.", error);
  }

  if (queryResult.total === 0) {
    return { status: "empty" };
  }

  if (queryResult.total > PARTY_EXPORT_MAX_ROWS) {
    throw AppError.validation(
      `Troppe anagrafiche da esportare (massimo ${PARTY_EXPORT_MAX_ROWS}). Restringi i filtri.`,
    );
  }

  const parent = getDialogParent();
  const saveOptions = {
    title: "Esporta anagrafiche CSV",
    defaultPath: defaultCsvFileName(),
    filters: [{ name: "CSV", extensions: ["csv"] }],
    properties: ["createDirectory", "showOverwriteConfirmation"] as Array<
      "createDirectory" | "showOverwriteConfirmation"
    >,
  };
  const dialogResult = parent
    ? await dialog.showSaveDialog(parent, saveOptions)
    : await dialog.showSaveDialog(saveOptions);

  if (dialogResult.canceled || !dialogResult.filePath) {
    return { status: "cancelled" };
  }

  let targetPath = dialogResult.filePath;
  if (!targetPath.toLowerCase().endsWith(".csv")) {
    targetPath = `${targetPath}.csv`;
  }

  if (targetPath !== dialogResult.filePath && fs.existsSync(targetPath)) {
    throw AppError.conflict(
      "Esiste già un file con questo nome. Scegli un nome diverso.",
    );
  }

  const csv = serializePartiesCsv(queryResult.items);

  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, csv, { encoding: "utf8" });
  } catch (error) {
    throw mapWriteError(error);
  }

  return {
    status: "completed",
    fileName: path.basename(targetPath),
    rowCount: queryResult.items.length,
  };
}
