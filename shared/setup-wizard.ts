/**
 * First-run setup wizard state.
 * Persisted in app_settings — survives restart and SQLite backup/restore.
 * Does not duplicate company profile, sector, or appearance settings.
 */

export const SETUP_WIZARD_SETTING_KEY = "setupWizardState" as const;

export const SETUP_WIZARD_STATUSES = [
  "not_started",
  "in_progress",
  "completed",
] as const;

export type SetupWizardStatus = (typeof SETUP_WIZARD_STATUSES)[number];

/** Wizard steps 1–5 (welcome → company → sector → preferences → summary). */
export const SETUP_WIZARD_STEPS = [1, 2, 3, 4, 5] as const;
export type SetupWizardStep = (typeof SETUP_WIZARD_STEPS)[number];

export type SetupWizardState = {
  status: SetupWizardStatus;
  currentStep: SetupWizardStep;
  /** How the completed status was established (explicit finish vs legacy bootstrap). */
  completionSource: "user" | "legacy_bootstrap" | null;
  updatedAt: string | null;
};

export const DEFAULT_SETUP_WIZARD_STATE: SetupWizardState = {
  status: "not_started",
  currentStep: 1,
  completionSource: null,
  updatedAt: null,
};

export const SETUP_WIZARD_STEP_LABELS: Record<SetupWizardStep, string> = {
  1: "Benvenuto",
  2: "Azienda",
  3: "Settore",
  4: "Preferenze",
  5: "Riepilogo",
};

const STATUS_SET = new Set<string>(SETUP_WIZARD_STATUSES);
const STEP_SET = new Set<number>(SETUP_WIZARD_STEPS);

function isStatus(value: unknown): value is SetupWizardStatus {
  return typeof value === "string" && STATUS_SET.has(value);
}

function isStep(value: unknown): value is SetupWizardStep {
  return typeof value === "number" && Number.isInteger(value) && STEP_SET.has(value);
}

function isCompletionSource(
  value: unknown,
): value is SetupWizardState["completionSource"] {
  return value === null || value === "user" || value === "legacy_bootstrap";
}

/**
 * Strict parser for persisted / IPC wizard payloads.
 * Rejects unknown properties and invalid combinations.
 */
export function parseSetupWizardState(input: unknown): SetupWizardState {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Lo stato del wizard deve essere un oggetto.");
  }

  const record = input as Record<string, unknown>;
  const allowed = new Set([
    "status",
    "currentStep",
    "completionSource",
    "updatedAt",
  ]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(`Proprietà non consentita: ${key}`);
    }
  }

  for (const key of ["status", "currentStep", "completionSource", "updatedAt"]) {
    if (!(key in record)) {
      throw new Error(`Campo obbligatorio mancante: ${key}`);
    }
  }

  if (!isStatus(record.status)) {
    throw new Error('Valore non valido per "status".');
  }
  if (!isStep(record.currentStep)) {
    throw new Error('Valore non valido per "currentStep".');
  }
  if (!isCompletionSource(record.completionSource)) {
    throw new Error('Valore non valido per "completionSource".');
  }
  if (record.updatedAt !== null && typeof record.updatedAt !== "string") {
    throw new Error('Valore non valido per "updatedAt".');
  }

  if (record.status === "completed" && record.completionSource === null) {
    throw new Error(
      'Uno stato "completed" richiede completionSource "user" o "legacy_bootstrap".',
    );
  }
  if (record.status !== "completed" && record.completionSource !== null) {
    throw new Error(
      "completionSource è consentito solo quando lo stato è completed.",
    );
  }

  return {
    status: record.status,
    currentStep: record.currentStep,
    completionSource: record.completionSource,
    updatedAt: record.updatedAt,
  };
}

/** Progress write from the renderer (step change / start). */
export type SetupWizardProgressInput = {
  status: "not_started" | "in_progress";
  currentStep: SetupWizardStep;
};

export function parseSetupWizardProgressInput(
  input: unknown,
): SetupWizardProgressInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Il progresso del wizard deve essere un oggetto.");
  }
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  for (const key of keys) {
    if (key !== "status" && key !== "currentStep") {
      throw new Error(`Proprietà non consentita: ${key}`);
    }
  }
  if (!("status" in record) || !("currentStep" in record)) {
    throw new Error("Campi status e currentStep obbligatori.");
  }
  if (record.status !== "not_started" && record.status !== "in_progress") {
    throw new Error('Lo stato progresso deve essere "not_started" o "in_progress".');
  }
  if (!isStep(record.currentStep)) {
    throw new Error('Valore non valido per "currentStep".');
  }
  return {
    status: record.status,
    currentStep: record.currentStep,
  };
}

export function shouldShowSetupWizard(state: SetupWizardState): boolean {
  return state.status !== "completed";
}

export function isSetupWizardCompleted(
  state: SetupWizardState | null | undefined,
): boolean {
  return state?.status === "completed";
}

/**
 * Residual first-run cues (dashboard alerts, warning badges, sidebar onboarding).
 * False once the wizard is completed — including legacy_bootstrap — so the UI
 * stays in normal operational mode. True only while setup is unfinished.
 * Null/unknown during load → no cues (avoid flash before state is known).
 */
export function shouldShowSetupOnboardingCues(
  state: SetupWizardState | null | undefined,
): boolean {
  if (state == null) {
    return false;
  }
  return state.status !== "completed";
}

/** Runtime mode for the shared SetupWizard UI. */
export type SetupWizardMode = "live" | "preview";

/**
 * Initial local state for development preview.
 * Never written to SQLite — preview must not touch setupWizardState.
 */
export const SETUP_WIZARD_PREVIEW_INITIAL_STATE: SetupWizardState = {
  status: "in_progress",
  currentStep: 1,
  completionSource: null,
  updatedAt: null,
};

/** Live wizard persists; preview is navigation-only and never writes. */
export function shouldPersistSetupWizardWrites(mode: SetupWizardMode): boolean {
  return mode === "live";
}

/** Local step navigation for preview (and live UI before a persist round-trip). */
export function moveSetupWizardStep(
  current: SetupWizardStep,
  direction: "forward" | "back",
): SetupWizardStep {
  if (direction === "forward") {
    return (current >= 5 ? 5 : ((current + 1) as SetupWizardStep));
  }
  return (current <= 1 ? 1 : ((current - 1) as SetupWizardStep));
}
