import { getDatabase } from "../db/connection.ts";
import { readBusinessSectorConfig } from "../repositories/business-sector-repository.ts";
import {
  listEnabledModules,
  listPlannedModulesForSector,
  type PublicModuleInfo,
  type PublicPlannedModuleInfo,
} from "../../shared/modules.ts";
/**
 * Main-process module resolution from persisted sector config.
 * Falls back to unconfigured (temporary general) if DB is unavailable.
 */
export function getEnabledModulesForRenderer(): PublicModuleInfo[] {
  try {
    const config = readBusinessSectorConfig(getDatabase());
    return listEnabledModules(config);
  } catch {
    return listEnabledModules({ sectorId: null, configured: false });
  }
}

export function getPlannedModulesForRenderer(): PublicPlannedModuleInfo[] {
  try {
    const config = readBusinessSectorConfig(getDatabase());
    return listPlannedModulesForSector(config);
  } catch {
    return listPlannedModulesForSector({ sectorId: null, configured: false });
  }
}
