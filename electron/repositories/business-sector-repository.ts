import type Database from "better-sqlite3";
import {
  BUSINESS_SECTOR_SETTING_KEY,
  DEFAULT_BUSINESS_SECTOR_CONFIG,
  parseBusinessSectorConfig,
  type BusinessSectorConfig,
  type BusinessSectorId,
} from "../../shared/business-sector.ts";

export function readBusinessSectorConfig(db: Database): BusinessSectorConfig {
  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(BUSINESS_SECTOR_SETTING_KEY) as { value?: string } | undefined;
  if (!row?.value) {
    return { ...DEFAULT_BUSINESS_SECTOR_CONFIG };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    throw new Error("Configurazione settore memorizzata non valida.");
  }
  return parseBusinessSectorConfig(parsed);
}

export function writeBusinessSectorConfig(
  db: Database,
  config: BusinessSectorConfig,
): void {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (@key, @value, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
  ).run({
    key: BUSINESS_SECTOR_SETTING_KEY,
    value: JSON.stringify(config),
  });
}

export function saveSelectedBusinessSector(
  db: Database,
  sectorId: BusinessSectorId,
): BusinessSectorConfig {
  const config: BusinessSectorConfig = {
    sectorId,
    configured: true,
  };
  writeBusinessSectorConfig(db, config);
  return config;
}
