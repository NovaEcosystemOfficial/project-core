import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import type Database from "better-sqlite3";
import { runMigrations } from "../electron/db/migrations.ts";
import { AppError, toIpcThrownError } from "../electron/errors/app-error.ts";
import {
  readAppSettings,
  writeAppSettings,
} from "../electron/repositories/app-settings-repository.ts";
import {
  readBusinessSectorConfig,
  saveSelectedBusinessSector,
} from "../electron/repositories/business-sector-repository.ts";
import {
  readCompanyProfile,
  writeCompanyProfileFields,
} from "../electron/repositories/company-profile-repository.ts";
import { insertParty } from "../electron/repositories/parties-repository.ts";
import {
  backupOpenDatabaseToFile,
  cleanupFile,
  validateSqliteBackupFile,
} from "../electron/services/database-backup-core.ts";
import {
  buildCompletedState,
  buildProgressState,
  detectLegacyConfiguredInstallation,
  readSetupWizardState,
  readSetupWizardStateRaw,
  writeSetupWizardState,
} from "../electron/repositories/setup-wizard-repository.ts";
import { DEFAULT_APP_SETTINGS } from "../shared/app-settings.ts";
import { DEFAULT_COMPANY_PROFILE_FIELDS } from "../shared/company-profile.ts";
import { tryParseDesktopErrorPayload } from "../shared/errors.ts";
import {
  DEFAULT_SETUP_WIZARD_STATE,
  SETUP_WIZARD_PREVIEW_INITIAL_STATE,
  SETUP_WIZARD_SETTING_KEY,
  isSetupWizardCompleted,
  moveSetupWizardStep,
  parseSetupWizardProgressInput,
  parseSetupWizardState,
  shouldPersistSetupWizardWrites,
  shouldShowSetupOnboardingCues,
  shouldShowSetupWizard,
  type SetupWizardStep,
} from "../shared/setup-wizard.ts";
import { listEnabledModules } from "../shared/modules.ts";

const require = createRequire(import.meta.url);
type BetterSqlite3Constructor = new (filename: string) => Database;
const BetterSqlite3 = require("better-sqlite3") as BetterSqlite3Constructor;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function openDb(filePath?: string): Database {
  const db = new BetterSqlite3(filePath ?? ":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

function testFreshInstallShowsWizard(): void {
  const db = openDb();
  const state = readSetupWizardState(db);
  assert(state.status === "not_started", "fresh install not_started");
  assert(state.currentStep === 1, "fresh start at step 1");
  assert(shouldShowSetupWizard(state), "wizard should show");
  assert(readSetupWizardStateRaw(db) === null, "defaults not written yet");
  assert(!detectLegacyConfiguredInstallation(db), "empty is not legacy");
  db.close();
  console.log("OK  fresh install / auto wizard");
}

function testResumeInterruptedWizard(): void {
  const db = openDb();
  const progress = buildProgressState("in_progress", 3);
  writeSetupWizardState(db, progress);
  const loaded = readSetupWizardState(db);
  assert(loaded.status === "in_progress", "in_progress persisted");
  assert(loaded.currentStep === 3, "step 3 restored");
  assert(shouldShowSetupWizard(loaded), "resume shows wizard");
  db.close();
  console.log("OK  resume interrupted wizard / current step");
}

function testPartialCompanyAndSectorPersistence(): void {
  const db = openDb();
  writeCompanyProfileFields(db, {
    ...DEFAULT_COMPANY_PROFILE_FIELDS,
    legalName: "Acme Parziale",
    vatNumber: null,
  });
  writeSetupWizardState(db, buildProgressState("in_progress", 2));
  saveSelectedBusinessSector(db, "retail_commerce");
  writeSetupWizardState(db, buildProgressState("in_progress", 4));
  writeAppSettings(db, {
    ...DEFAULT_APP_SETTINGS,
    appearance: "light",
    accentColor: "amber",
  });

  const wizard = readSetupWizardState(db);
  assert(wizard.currentStep === 4, "preferences step saved");
  const reopenPath = path.join(
    os.tmpdir(),
    `pc-wizard-${process.pid}-${Date.now()}.sqlite`,
  );
  // File-backed reopen check
  const fileDb = openDb(reopenPath);
  writeCompanyProfileFields(fileDb, {
    ...DEFAULT_COMPANY_PROFILE_FIELDS,
    legalName: "Acme Parziale",
  });
  saveSelectedBusinessSector(fileDb, "retail_commerce");
  writeAppSettings(fileDb, {
    ...DEFAULT_APP_SETTINGS,
    appearance: "light",
    accentColor: "amber",
  });
  writeSetupWizardState(fileDb, buildProgressState("in_progress", 4));
  fileDb.close();

  const reopened = openDb(reopenPath);
  const state = readSetupWizardState(reopened);
  assert(state.status === "in_progress", "progress survives reopen");
  assert(state.currentStep === 4, "step survives reopen");
  reopened.close();
  cleanupFile(reopenPath);
  db.close();
  console.log("OK  partial company + sector + preferences persistence");
}

function testSuccessfulCompletionAndDashboardGate(): void {
  const db = openDb();
  writeSetupWizardState(db, buildProgressState("in_progress", 5));
  writeSetupWizardState(db, buildCompletedState("user"));
  const state = readSetupWizardState(db);
  assert(state.status === "completed", "completed");
  assert(state.completionSource === "user", "user completion");
  assert(!shouldShowSetupWizard(state), "no wizard after complete");
  // Second read must not reopen wizard
  assert(readSetupWizardState(db).status === "completed", "stable completed");
  db.close();
  console.log("OK  completion + dashboard gate");
}

function testCompletionDoesNotClobberExistingData(): void {
  const db = openDb();
  writeCompanyProfileFields(db, {
    ...DEFAULT_COMPANY_PROFILE_FIELDS,
    legalName: "Dati Esistenti SRL",
    city: "Milano",
  });
  saveSelectedBusinessSector(db, "workshop_service");
  insertParty(db, "party-wiz-1", {
    displayName: "Cliente Wizard",
    isCustomer: true,
    isSupplier: false,
    email: null,
    phone: null,
    address: null,
    taxCode: null,
    vatNumber: null,
    notes: null,
  });
  writeSetupWizardState(db, buildCompletedState("user"));

  const company = db
    .prepare(`SELECT value FROM app_settings WHERE key = 'companyProfile'`)
    .get() as { value: string };
  assert(company.value.includes("Dati Esistenti SRL"), "company intact");
  const party = db
    .prepare(`SELECT display_name FROM parties WHERE id = ?`)
    .get("party-wiz-1") as { display_name: string };
  assert(party.display_name === "Cliente Wizard", "party intact");
  db.close();
  console.log("OK  completion preserves existing data");
}

function testLegacyWithCompanyAndSector(): void {
  const companyDb = openDb();
  writeCompanyProfileFields(companyDb, {
    ...DEFAULT_COMPANY_PROFILE_FIELDS,
    legalName: "Legacy Co",
  });
  assert(
    detectLegacyConfiguredInstallation(companyDb),
    "company counts as legacy",
  );
  const bootCompany = readSetupWizardState(companyDb);
  assert(bootCompany.status === "completed", "legacy company → completed");
  assert(
    bootCompany.completionSource === "legacy_bootstrap",
    "legacy_bootstrap source",
  );
  assert(!shouldShowSetupWizard(bootCompany), "no wizard for legacy company");
  companyDb.close();

  const sectorDb = openDb();
  saveSelectedBusinessSector(sectorDb, "textile_raw_materials");
  const bootSector = readSetupWizardState(sectorDb);
  assert(bootSector.status === "completed", "legacy sector → completed");
  assert(
    bootSector.completionSource === "legacy_bootstrap",
    "legacy sector source",
  );
  sectorDb.close();
  console.log("OK  legacy company/sector bootstrap");
}

function testLegacyOperationalDataContinuity(): void {
  const db = openDb();
  insertParty(db, "party-legacy-1", {
    displayName: "Legacy Party",
    isCustomer: false,
    isSupplier: true,
    email: null,
    phone: null,
    address: null,
    taxCode: null,
    vatNumber: null,
    notes: null,
  });
  const state = readSetupWizardState(db);
  assert(state.status === "completed", "parties imply legacy complete");
  const count = db
    .prepare(`SELECT COUNT(*) AS c FROM parties`)
    .get() as { c: number };
  assert(count.c === 1, "party retained after bootstrap");
  db.close();
  console.log("OK  legacy operational data continuity");
}

function testCorruptStateNotOverwritten(): void {
  const db = openDb();
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))`,
  ).run(SETUP_WIZARD_SETTING_KEY, "{not-json");

  let threw = false;
  try {
    readSetupWizardState(db);
  } catch (error) {
    threw =
      error instanceof Error && error.message.includes("non valido");
  }
  assert(threw, "corrupt JSON rejected");

  const still = db
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(SETUP_WIZARD_SETTING_KEY) as { value: string };
  assert(still.value === "{not-json", "corrupt payload untouched");
  db.close();
  console.log("OK  corrupt state rejected without overwrite");
}

function testCompletionPersistenceFailureSemantics(): void {
  const db = openDb();
  writeSetupWizardState(db, buildProgressState("in_progress", 5));
  // Simulate failure: leave corrupt after progress — complete path via raw write
  // must not “pretend” success when parse fails on next read.
  db.prepare(
    `UPDATE app_settings SET value = ? WHERE key = ?`,
  ).run('{"status":"completed"}', SETUP_WIZARD_SETTING_KEY);

  let threw = false;
  try {
    readSetupWizardState(db);
  } catch {
    threw = true;
  }
  assert(threw, "invalid completed payload rejected");
  // Valid complete after repair
  writeSetupWizardState(db, buildCompletedState("user"));
  assert(readSetupWizardState(db).status === "completed", "valid complete ok");
  db.close();
  console.log("OK  completion persistence failure semantics");
}

async function testBackupRestoreWizardState(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-wizard-bak-"));
  const livePath = path.join(dir, "live.sqlite");
  const backupPath = path.join(dir, "backup.sqlite");
  const restorePath = path.join(dir, "restored.sqlite");

  const live = openDb(livePath);
  writeCompanyProfileFields(live, {
    ...DEFAULT_COMPANY_PROFILE_FIELDS,
    legalName: "Backup Wizard SpA",
  });
  saveSelectedBusinessSector(live, "warehouse_distribution");
  writeSetupWizardState(live, buildCompletedState("user"));
  await backupOpenDatabaseToFile(live, backupPath);
  live.close();

  validateSqliteBackupFile(backupPath);
  fs.copyFileSync(backupPath, restorePath);
  // restore helper expects closed destination; open after restore validation path
  const probe = openDb(restorePath);
  const state = readSetupWizardState(probe);
  assert(state.status === "completed", "wizard status in backup");
  assert(state.completionSource === "user", "completion source restored");
  probe.close();

  // Old backup without wizard key + company → legacy bootstrap on open
  const oldPath = path.join(dir, "old.sqlite");
  const oldDb = openDb(oldPath);
  writeCompanyProfileFields(oldDb, {
    ...DEFAULT_COMPANY_PROFILE_FIELDS,
    legalName: "Vecchio Backup",
  });
  oldDb
    .prepare(`DELETE FROM app_settings WHERE key = ?`)
    .run(SETUP_WIZARD_SETTING_KEY);
  oldDb.close();

  const oldReopen = openDb(oldPath);
  const boot = readSetupWizardState(oldReopen);
  assert(boot.status === "completed", "old backup bootstraps completed");
  assert(boot.completionSource === "legacy_bootstrap", "legacy from backup");
  oldReopen.close();

  // Empty backup without wizard → not_started (no auto-complete)
  const emptyPath = path.join(dir, "empty.sqlite");
  const empty = openDb(emptyPath);
  empty
    .prepare(`DELETE FROM app_settings WHERE key = ?`)
    .run(SETUP_WIZARD_SETTING_KEY);
  const emptyState = readSetupWizardState(empty);
  assert(emptyState.status === "not_started", "empty backup stays not_started");
  empty.close();

  fs.rmSync(dir, { recursive: true, force: true });
  console.log("OK  backup/restore wizard + legacy backups");
}

function testIpcPayloadValidation(): void {
  let threw = false;
  try {
    parseSetupWizardState({ status: "completed", currentStep: 5 });
  } catch {
    threw = true;
  }
  assert(threw, "completed without completionSource rejected");

  threw = false;
  try {
    parseSetupWizardProgressInput({ status: "completed", currentStep: 1 });
  } catch {
    threw = true;
  }
  assert(threw, "progress cannot set completed");

  threw = false;
  try {
    parseSetupWizardProgressInput({ status: "in_progress", currentStep: 9 });
  } catch {
    threw = true;
  }
  assert(threw, "invalid step rejected");

  const ok = parseSetupWizardProgressInput({
    status: "in_progress",
    currentStep: 2,
  });
  assert(ok.currentStep === 2, "valid progress");

  const encoded = toIpcThrownError(
    AppError.validation("Progresso wizard non valido."),
  );
  const payload = tryParseDesktopErrorPayload(encoded.message);
  assert(payload?.code === "VALIDATION_FAILED", "IPC validation encoding");

  const defaults = parseSetupWizardState({
    ...DEFAULT_SETUP_WIZARD_STATE,
  });
  assert(defaults.status === "not_started", "default parse");
  console.log("OK  IPC / payload validation");
}

function snapshotPersistence(db: Database): string {
  const keys = [
    SETUP_WIZARD_SETTING_KEY,
    "companyProfile",
    "companyLogo",
    "businessSectorConfig",
    "appearance",
    "accentColor",
    "compactMode",
  ];
  const rows = db
    .prepare(
      `SELECT key, value FROM app_settings WHERE key IN (${keys.map(() => "?").join(",")}) ORDER BY key`,
    )
    .all(...keys) as Array<{ key: string; value: string }>;
  return JSON.stringify(rows);
}

/**
 * Mirrors the development preview contract: reads + local step navigation only.
 * Opening/closing preview must leave SQLite unchanged.
 */
function testPreviewOpenCloseDoesNotPersist(): void {
  assert(
    !shouldPersistSetupWizardWrites("preview"),
    "preview must not persist writes",
  );
  assert(
    shouldPersistSetupWizardWrites("live"),
    "live mode still persists",
  );
  assert(
    SETUP_WIZARD_PREVIEW_INITIAL_STATE.currentStep === 1,
    "preview starts at welcome",
  );
  assert(
    SETUP_WIZARD_PREVIEW_INITIAL_STATE.status === "in_progress",
    "preview local status is in_progress",
  );

  const db = openDb();
  writeCompanyProfileFields(db, {
    ...DEFAULT_COMPANY_PROFILE_FIELDS,
    legalName: "Preview Guard SpA",
    city: "Torino",
  });
  saveSelectedBusinessSector(db, "workshop_service");
  writeAppSettings(db, {
    appearance: "light",
    accentColor: "rose",
    compactMode: true,
  });
  writeSetupWizardState(db, buildCompletedState("user"));

  const before = snapshotPersistence(db);

  // Open preview: only reads (no writeSetupWizardState / company / sector / settings).
  const wizard = readSetupWizardStateRaw(db);
  assert(wizard?.status === "completed", "preview open sees existing wizard");
  readCompanyProfile(db);
  readBusinessSectorConfig(db);
  readAppSettings(db);

  let step: SetupWizardStep = SETUP_WIZARD_PREVIEW_INITIAL_STATE.currentStep;
  for (let i = 0; i < 4; i += 1) {
    step = moveSetupWizardStep(step, "forward");
  }
  assert(step === 5, "preview can walk to summary");
  for (let i = 0; i < 4; i += 1) {
    step = moveSetupWizardStep(step, "back");
  }
  assert(step === 1, "preview can walk back to welcome");

  // Close preview: still no writes.
  const after = snapshotPersistence(db);
  assert(before === after, "open/close preview left SQLite unchanged");

  assert(
    readSetupWizardState(db).status === "completed",
    "wizard status still completed",
  );
  assert(
    readCompanyProfile(db).legalName === "Preview Guard SpA",
    "company unchanged",
  );
  assert(
    readBusinessSectorConfig(db).sectorId === "workshop_service",
    "sector unchanged",
  );
  assert(readAppSettings(db).appearance === "light", "settings unchanged");
  assert(readAppSettings(db).accentColor === "rose", "accent unchanged");
  assert(readAppSettings(db).compactMode === true, "compact unchanged");

  db.close();
  console.log("OK  preview open/close does not modify persistence");
}

function testCompletedHidesOnboardingCues(): void {
  const completed = buildCompletedState("user");
  assert(isSetupWizardCompleted(completed), "completed helper");
  assert(!shouldShowSetupWizard(completed), "wizard hidden when completed");
  assert(
    !shouldShowSetupOnboardingCues(completed),
    "no onboarding cues when completed",
  );
  assert(
    !shouldShowSetupOnboardingCues(null),
    "no cues while state unknown/loading",
  );
  assert(
    shouldShowSetupOnboardingCues(DEFAULT_SETUP_WIZARD_STATE),
    "cues while not_started",
  );
  assert(
    shouldShowSetupOnboardingCues(buildProgressState("in_progress", 2)),
    "cues while in_progress (deferred resume)",
  );

  // Dashboard alert gate: only unfinished setup AND missing sector.
  const showAlert =
    shouldShowSetupOnboardingCues(completed) &&
    !{ configured: false, sectorId: null }.configured;
  assert(!showAlert, "completed → no dashboard sector onboarding alert");

  const deferredAlert =
    shouldShowSetupOnboardingCues(DEFAULT_SETUP_WIZARD_STATE) &&
    !{ configured: false, sectorId: null }.configured;
  assert(deferredAlert, "deferred incomplete → sector alert allowed");

  console.log("OK  completed hides onboarding; deferred keeps cues");
}

function testRestartAfterCompletionStaysClean(): void {
  const pathFile = path.join(
    os.tmpdir(),
    `pc-wizard-restart-${process.pid}-${Date.now()}.sqlite`,
  );
  const db = openDb(pathFile);
  writeSetupWizardState(db, buildCompletedState("user"));
  db.close();

  const reopened = openDb(pathFile);
  const state = readSetupWizardState(reopened);
  assert(state.status === "completed", "completed survives reopen");
  assert(!shouldShowSetupWizard(state), "wizard does not reappear");
  assert(!shouldShowSetupOnboardingCues(state), "no onboarding after reopen");
  reopened.close();
  cleanupFile(pathFile);
  console.log("OK  restart after completion stays clean");
}

function testSectorChangeDoesNotReopenWizard(): void {
  const db = openDb();
  writeSetupWizardState(db, buildCompletedState("user"));
  saveSelectedBusinessSector(db, "general_services");
  saveSelectedBusinessSector(db, "retail_commerce");

  const state = readSetupWizardState(db);
  assert(state.status === "completed", "wizard still completed after sector change");
  assert(!shouldShowSetupWizard(state), "sector change does not reopen wizard");
  assert(!shouldShowSetupOnboardingCues(state), "no onboarding after sector change");

  const modules = listEnabledModules(readBusinessSectorConfig(db));
  assert(
    modules.some((m) => m.id === "company") &&
      modules.some((m) => m.id === "settings"),
    "Azienda and Impostazioni remain navigable",
  );
  assert(
    modules.some((m) => m.id === "magazzino"),
    "retail enables magazzino after sector change",
  );
  db.close();
  console.log("OK  sector change keeps wizard completed; pages accessible");
}

function testLegacyCompletedNoForcedWizard(): void {
  const db = openDb();
  writeCompanyProfileFields(db, {
    ...DEFAULT_COMPANY_PROFILE_FIELDS,
    legalName: "Legacy Ops SRL",
  });
  const state = readSetupWizardState(db);
  assert(state.completionSource === "legacy_bootstrap", "legacy source");
  assert(isSetupWizardCompleted(state), "legacy treated completed");
  assert(!shouldShowSetupWizard(state), "legacy not forced through wizard");
  assert(!shouldShowSetupOnboardingCues(state), "legacy has no onboarding cues");
  db.close();
  console.log("OK  legacy configured installs skip wizard and cues");
}

async function main(): Promise<void> {
  testFreshInstallShowsWizard();
  testResumeInterruptedWizard();
  testPartialCompanyAndSectorPersistence();
  testSuccessfulCompletionAndDashboardGate();
  testCompletionDoesNotClobberExistingData();
  testLegacyWithCompanyAndSector();
  testLegacyOperationalDataContinuity();
  testCorruptStateNotOverwritten();
  testCompletionPersistenceFailureSemantics();
  await testBackupRestoreWizardState();
  testIpcPayloadValidation();
  testPreviewOpenCloseDoesNotPersist();
  testCompletedHidesOnboardingCues();
  testRestartAfterCompletionStaysClean();
  testSectorChangeDoesNotReopenWizard();
  testLegacyCompletedNoForcedWizard();
  console.log("\nAll setup wizard tests passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
