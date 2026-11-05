import { BrowserWindow } from "electron";
import { AppError } from "../errors/app-error.ts";
import { getDatabase } from "../db/connection.ts";
import { findQuoteById } from "../repositories/quotes-repository.ts";
import { readCompanyProfile } from "../repositories/company-profile-repository.ts";
import type { QuotePrintResult } from "../../shared/quote-print.ts";
import { parseQuoteIdInput } from "../../shared/quotes.ts";
import { buildQuoteDocumentHtml } from "./quote-document-html.ts";

export type { QuotePrintResult };

/**
 * Opens a sandboxed print preview window and invokes the OS print dialog.
 * Uses the same document HTML as PDF export.
 */
export async function printQuoteDocument(
  input: unknown,
): Promise<QuotePrintResult> {
  let id: string;
  try {
    id = parseQuoteIdInput(input);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Identificativo preventivo non valido.";
    throw AppError.validation(message, error);
  }

  const db = getDatabase();
  const quote = findQuoteById(db, id);
  if (!quote) {
    throw AppError.notFound("Preventivo non trovato.");
  }

  let profile;
  try {
    profile = readCompanyProfile(db);
  } catch (error) {
    throw AppError.internal("Impossibile leggere il profilo aziendale.", error);
  }

  const html = buildQuoteDocumentHtml(quote, profile);
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

  const printWindow = new BrowserWindow({
    width: 900,
    height: 1100,
    show: true,
    autoHideMenuBar: true,
    title: `Stampa ${quote.number}`,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    printWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    printWindow.webContents.on("will-navigate", (event) => {
      event.preventDefault();
    });

    await printWindow.loadURL(dataUrl);
    const printed = await new Promise<boolean>((resolve) => {
      printWindow.webContents.print(
        {
          silent: false,
          printBackground: true,
        },
        (success, failureReason) => {
          if (!success && failureReason) {
            resolve(false);
            return;
          }
          resolve(success);
        },
      );
    });

    if (!printWindow.isDestroyed()) {
      printWindow.close();
    }
    return printed ? { status: "completed" } : { status: "cancelled" };
  } catch (error) {
    if (!printWindow.isDestroyed()) {
      printWindow.close();
    }
    if (error instanceof AppError) {
      throw error;
    }
    throw AppError.internal("Impossibile avviare la stampa del preventivo.", error);
  }
}
