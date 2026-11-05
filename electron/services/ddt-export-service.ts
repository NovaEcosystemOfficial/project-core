import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, dialog, shell } from "electron";
import { AppError } from "../errors/app-error.ts";
import { getDatabase } from "../db/connection.ts";
import {
  findDdtById,
  listDdtDocumentsForExport,
  listDdtLines,
} from "../repositories/ddt-repository.ts";
import { APP_TECHNICAL_NAME } from "../../shared/modules.ts";
import {
  parseDdtId,
  parseDdtListQuery,
  type DdtListQuery,
} from "../../shared/ddt.ts";
import {
  serializeDdtDocumentsCsv,
  serializeDdtLinesCsv,
  type DdtCsvExportResult,
  type DdtOpenOriginalResult,
} from "../../shared/ddt-csv.ts";
import { resolveDdtAbsolutePath } from "./ddt-file-store.ts";

const DDT_EXPORT_MAX_ROWS = 5000;

function getDialogParent(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
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

async function saveCsvDialog(
  title: string,
  defaultName: string,
  content: string,
  rowCount: number,
): Promise<DdtCsvExportResult> {
  const parent = getDialogParent();
  const saveOptions = {
    title,
    defaultPath: defaultName,
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

  try {
    fs.writeFileSync(dialogResult.filePath, content, "utf8");
  } catch (error) {
    throw mapWriteError(error);
  }

  return {
    status: "completed",
    fileName: path.basename(dialogResult.filePath),
    rowCount,
  };
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function exportDdtArchiveCsv(
  input: unknown,
): Promise<DdtCsvExportResult> {
  let query: DdtListQuery;
  try {
    query = parseDdtListQuery(
      typeof input === "object" && input !== null ? input : {},
    );
  } catch (error) {
    throw AppError.validation(
      error instanceof Error
        ? error.message
        : "Parametri di esportazione non validi.",
      error,
    );
  }

  const listed = listDdtDocumentsForExport(
    getDatabase(),
    query,
    DDT_EXPORT_MAX_ROWS,
  );
  if (listed.total === 0) {
    return { status: "empty" };
  }
  if (listed.total > DDT_EXPORT_MAX_ROWS) {
    throw AppError.validation(
      `Troppi documenti da esportare (massimo ${DDT_EXPORT_MAX_ROWS}). Restringi i filtri.`,
    );
  }

  const content = serializeDdtDocumentsCsv(listed.items);
  return saveCsvDialog(
    "Esporta archivio DDT CSV",
    `${APP_TECHNICAL_NAME.toLowerCase()}-ddt-archivio-${stamp()}.csv`,
    content,
    listed.items.length,
  );
}

export async function exportDdtLinesCsv(
  input: unknown,
): Promise<DdtCsvExportResult> {
  let query: DdtListQuery;
  try {
    query = parseDdtListQuery(
      typeof input === "object" && input !== null ? input : {},
    );
  } catch (error) {
    throw AppError.validation(
      error instanceof Error
        ? error.message
        : "Parametri di esportazione non validi.",
      error,
    );
  }

  const db = getDatabase();
  const listed = listDdtDocumentsForExport(db, query, DDT_EXPORT_MAX_ROWS);
  if (listed.total === 0) {
    return { status: "empty" };
  }
  if (listed.total > DDT_EXPORT_MAX_ROWS) {
    throw AppError.validation(
      `Troppi documenti da esportare (massimo ${DDT_EXPORT_MAX_ROWS}). Restringi i filtri.`,
    );
  }

  const entries: Array<{
    document: (typeof listed.items)[number];
    line: ReturnType<typeof listDdtLines>[number];
  }> = [];
  for (const document of listed.items) {
    for (const line of listDdtLines(db, document.id)) {
      entries.push({ document, line });
    }
  }
  if (entries.length === 0) {
    return { status: "empty" };
  }

  const content = serializeDdtLinesCsv(entries);
  return saveCsvDialog(
    "Esporta righe DDT CSV",
    `${APP_TECHNICAL_NAME.toLowerCase()}-ddt-righe-${stamp()}.csv`,
    content,
    entries.length,
  );
}

export async function openDdtOriginal(
  input: unknown,
): Promise<DdtOpenOriginalResult> {
  let id: string;
  try {
    id = parseDdtId(input);
  } catch (error) {
    throw AppError.validation(
      error instanceof Error ? error.message : "ID non valido.",
      error,
    );
  }

  const doc = findDdtById(getDatabase(), id);
  if (!doc) {
    throw AppError.notFound("Documento DDT non trovato.");
  }

  let absolute: string;
  try {
    absolute = resolveDdtAbsolutePath(doc.originalRelativePath);
  } catch {
    return {
      status: "missing",
      message: "Percorso file originale non valido.",
    };
  }

  if (!fs.existsSync(absolute)) {
    return {
      status: "missing",
      message:
        "Il file originale non è presente nell'archivio locale (potrebbe mancare dopo un ripristino backup solo SQLite).",
    };
  }

  const openError = await shell.openPath(absolute);
  if (openError) {
    return {
      status: "error",
      message: "Impossibile aprire il file con l'applicazione predefinita.",
    };
  }
  return { status: "opened" };
}
