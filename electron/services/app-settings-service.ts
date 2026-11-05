import { AppError } from "../errors/app-error.ts";
import { getDatabase, withAppTransaction } from "../db/connection.ts";
import {
  readAppSettings,
  writeAppSettings,
} from "../repositories/app-settings-repository.ts";
import { parseAppSettings, type AppSettings } from "../../shared/app-settings.ts";

export function getAppSettings(): AppSettings {
  try {
    return readAppSettings(getDatabase());
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw AppError.internal("Impossibile leggere le impostazioni.", error);
  }
}

export function saveAppSettings(input: unknown): AppSettings {
  let settings: AppSettings;
  try {
    settings = parseAppSettings(input);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Impostazioni non valide.";
    throw AppError.validation(message, error);
  }

  try {
    withAppTransaction((db) => {
      writeAppSettings(db, settings);
    });
    return readAppSettings(getDatabase());
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw AppError.internal("Impossibile salvare le impostazioni.", error);
  }
}
