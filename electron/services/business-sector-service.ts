import { AppError } from "../errors/app-error.ts";
import { getDatabase, withAppTransaction } from "../db/connection.ts";
import {
  readBusinessSectorConfig,
  saveSelectedBusinessSector,
} from "../repositories/business-sector-repository.ts";
import {
  parseBusinessSectorSelection,
  type BusinessSectorConfig,
  type BusinessSectorId,
} from "../../shared/business-sector.ts";
import {
  listEnabledModules,
  listPlannedModulesForSector,
  type PublicModuleInfo,
  type PublicPlannedModuleInfo,
} from "../../shared/modules.ts";

function wrap(fallback: string, error: unknown): never {
  if (error instanceof AppError) {
    throw error;
  }
  throw AppError.internal(fallback, error);
}

export function getBusinessSectorConfig(): BusinessSectorConfig {
  try {
    return readBusinessSectorConfig(getDatabase());
  } catch (error) {
    wrap("Impossibile leggere la configurazione del settore.", error);
  }
}

export function saveBusinessSector(input: unknown): BusinessSectorConfig {
  let sectorId: BusinessSectorId;
  try {
    sectorId = parseBusinessSectorSelection(input);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Selezione settore non valida.";
    throw AppError.validation(message, error);
  }

  try {
    return withAppTransaction((db) => saveSelectedBusinessSector(db, sectorId));
  } catch (error) {
    wrap("Impossibile salvare la configurazione del settore.", error);
  }
}

export function getModulesForCurrentSector(): {
  enabled: PublicModuleInfo[];
  planned: PublicPlannedModuleInfo[];
  sector: BusinessSectorConfig;
} {
  try {
    const sector = readBusinessSectorConfig(getDatabase());
    return {
      sector,
      enabled: listEnabledModules(sector),
      planned: listPlannedModulesForSector(sector),
    };
  } catch (error) {
    wrap("Impossibile risolvere i moduli per il settore.", error);
  }
}
