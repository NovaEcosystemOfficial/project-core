import type Database from "better-sqlite3";
import {
  DEFAULT_SETUP_WIZARD_STATE,
  SETUP_WIZARD_SETTING_KEY,
  parseSetupWizardState,
  type SetupWizardState,
  type SetupWizardStep,
  type SetupWizardStatus,
} from "../../shared/setup-wizard.ts";
import { readBusinessSectorConfig } from "./business-sector-repository.ts";
import { readCompanyProfileFields } from "./company-profile-repository.ts";

type SettingRow = { value: string };

function readRaw(db: Database): string | null {
  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(SETUP_WIZARD_SETTING_KEY) as SettingRow | undefined;
  return row?.value ?? null;
}

export function writeSetupWizardState(
  db: Database,
  state: SetupWizardState,
): void {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (@key, @value, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
  ).run({
    key: SETUP_WIZARD_SETTING_KEY,
    value: JSON.stringify(state),
  });
}

function nowStamp(): string {
  return new Date().toISOString();
}

function countRows(db: Database, table: string): number {
  const exists = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    )
    .get(table) as { name?: string } | undefined;
  if (!exists?.name) {
    return 0;
  }
  // Table name is an allow-listed literal from callers, never user input.
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as {
    c: number;
  };
  return Number(row.c) || 0;
}

/**
 * True when the installation already looks configured or has operational data.
 * Used only when the wizard key is missing (pre-wizard builds / old backups).
 */
export function detectLegacyConfiguredInstallation(db: Database): boolean {
  const sector = readBusinessSectorConfig(db);
  if (sector.configured && sector.sectorId) {
    return true;
  }

  const company = readCompanyProfileFields(db);
  if (company.legalName.trim().length > 0) {
    return true;
  }

  if (countRows(db, "parties") > 0) {
    return true;
  }
  if (countRows(db, "quotes") > 0) {
    return true;
  }
  if (countRows(db, "articles") > 0) {
    return true;
  }
  return false;
}

function parseStored(raw: string): SetupWizardState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Stato wizard memorizzato non valido (JSON).");
  }
  return parseSetupWizardState(parsed);
}

/** Existing row only — null if the key was never written. Throws on corrupt data. */
export function readSetupWizardStateRaw(
  db: Database,
): SetupWizardState | null {
  const raw = readRaw(db);
  if (raw === null) {
    return null;
  }
  return parseStored(raw);
}

/**
 * Loads wizard state. Missing key on a legacy installation → persist completed.
 * Missing key on a fresh install → in-memory defaults (not written yet).
 * Corrupt payloads throw (never overwrite blindly).
 */
export function readSetupWizardState(db: Database): SetupWizardState {
  const existing = readSetupWizardStateRaw(db);
  if (existing) {
    return existing;
  }
  if (detectLegacyConfiguredInstallation(db)) {
    const bootstrapped = buildCompletedState("legacy_bootstrap");
    writeSetupWizardState(db, bootstrapped);
    return bootstrapped;
  }
  return { ...DEFAULT_SETUP_WIZARD_STATE };
}

export function buildProgressState(
  status: Extract<SetupWizardStatus, "not_started" | "in_progress">,
  currentStep: SetupWizardStep,
): SetupWizardState {
  return {
    status,
    currentStep,
    completionSource: null,
    updatedAt: nowStamp(),
  };
}

export function buildCompletedState(
  source: "user" | "legacy_bootstrap",
): SetupWizardState {
  return {
    status: "completed",
    currentStep: 5,
    completionSource: source,
    updatedAt: nowStamp(),
  };
}
