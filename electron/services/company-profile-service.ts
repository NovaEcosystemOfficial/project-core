import { BrowserWindow, dialog } from "electron";
import fs from "node:fs";
import { AppError } from "../errors/app-error.ts";
import { getDatabase, withAppTransaction } from "../db/connection.ts";
import {
  clearCompanyLogoRecord,
  readCompanyProfile,
  writeCompanyLogoRecord,
  writeCompanyProfileFields,
} from "../repositories/company-profile-repository.ts";
import {
  parseCompanyProfileFields,
  type CompanyLogoSelectResult,
  type CompanyProfile,
} from "../../shared/company-profile.ts";
import { validateCompanyLogoBuffer } from "./company-logo-validation.ts";

function getDialogParent(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

function wrap(fallback: string, error: unknown): never {
  if (error instanceof AppError) {
    throw error;
  }
  throw AppError.internal(fallback, error);
}

/**
 * Typed reader for main-process document composition (quotes PDF later).
 * Safe for renderer via IPC — no filesystem paths.
 */
export function getCompanyProfile(): CompanyProfile {
  try {
    return readCompanyProfile(getDatabase());
  } catch (error) {
    wrap("Impossibile leggere il profilo aziendale.", error);
  }
}

export function saveCompanyProfile(input: unknown): CompanyProfile {
  let fields;
  try {
    fields = parseCompanyProfileFields(input);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Profilo aziendale non valido.";
    throw AppError.validation(message, error);
  }

  try {
    withAppTransaction((db) => {
      writeCompanyProfileFields(db, fields);
    });
    return readCompanyProfile(getDatabase());
  } catch (error) {
    wrap("Impossibile salvare il profilo aziendale.", error);
  }
}

export async function selectCompanyLogo(): Promise<CompanyLogoSelectResult> {
  const parent = getDialogParent();
  const openOptions = {
    title: "Seleziona logo aziendale",
    filters: [
      {
        name: "Immagini",
        extensions: ["png", "jpg", "jpeg", "webp", "gif"],
      },
    ],
    properties: ["openFile"] as Array<"openFile">,
  };
  const result = parent
    ? await dialog.showOpenDialog(parent, openOptions)
    : await dialog.showOpenDialog(openOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return { status: "cancelled" };
  }
  const filePath = result.filePaths[0];
  if (!filePath) {
    return { status: "cancelled" };
  }

  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (error) {
    throw AppError.validation("Impossibile leggere il file selezionato.", error);
  }

  const logo = validateCompanyLogoBuffer(buffer);

  try {
    withAppTransaction((db) => {
      writeCompanyLogoRecord(db, logo);
    });
    return {
      status: "completed",
      profile: readCompanyProfile(getDatabase()),
    };
  } catch (error) {
    wrap("Impossibile salvare il logo aziendale.", error);
  }
}

export function removeCompanyLogo(): CompanyProfile {
  try {
    withAppTransaction((db) => {
      clearCompanyLogoRecord(db);
    });
    return readCompanyProfile(getDatabase());
  } catch (error) {
    wrap("Impossibile rimuovere il logo aziendale.", error);
  }
}
