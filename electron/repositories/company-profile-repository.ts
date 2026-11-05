import type Database from "better-sqlite3";
import {
  COMPANY_LOGO_SETTING_KEY,
  COMPANY_PROFILE_SETTING_KEY,
  DEFAULT_COMPANY_PROFILE_FIELDS,
  parseCompanyLogoRecord,
  parseCompanyProfileFields,
  toPublicCompanyProfile,
  type CompanyLogoRecord,
  type CompanyProfile,
  type CompanyProfileFields,
} from "../../shared/company-profile.ts";

type SettingRow = { key: string; value: string };

function readSetting(db: Database, key: string): string | null {
  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(key) as SettingRow | undefined;
  return row?.value ?? null;
}

function writeSetting(db: Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (@key, @value, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
  ).run({ key, value });
}

function deleteSetting(db: Database, key: string): void {
  db.prepare(`DELETE FROM app_settings WHERE key = ?`).run(key);
}

export function readCompanyProfileFields(db: Database): CompanyProfileFields {
  const raw = readSetting(db, COMPANY_PROFILE_SETTING_KEY);
  if (raw === null) {
    return { ...DEFAULT_COMPANY_PROFILE_FIELDS };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Profilo aziendale memorizzato non valido.");
  }
  return parseCompanyProfileFields(parsed);
}

export function readCompanyLogoRecord(db: Database): CompanyLogoRecord | null {
  const raw = readSetting(db, COMPANY_LOGO_SETTING_KEY);
  if (raw === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Logo aziendale memorizzato non valido.");
  }
  return parseCompanyLogoRecord(parsed);
}

export function readCompanyProfile(db: Database): CompanyProfile {
  const fields = readCompanyProfileFields(db);
  const logo = readCompanyLogoRecord(db);
  return toPublicCompanyProfile(fields, logo);
}

export function writeCompanyProfileFields(
  db: Database,
  fields: CompanyProfileFields,
): void {
  writeSetting(
    db,
    COMPANY_PROFILE_SETTING_KEY,
    JSON.stringify(fields),
  );
}

export function writeCompanyLogoRecord(
  db: Database,
  logo: CompanyLogoRecord,
): void {
  writeSetting(db, COMPANY_LOGO_SETTING_KEY, JSON.stringify(logo));
}

export function clearCompanyLogoRecord(db: Database): void {
  deleteSetting(db, COMPANY_LOGO_SETTING_KEY);
}
