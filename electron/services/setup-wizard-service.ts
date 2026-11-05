import { AppError } from "../errors/app-error.ts";
import { withAppTransaction } from "../db/connection.ts";
import {
  buildCompletedState,
  buildProgressState,
  detectLegacyConfiguredInstallation,
  readSetupWizardState,
  readSetupWizardStateRaw,
  writeSetupWizardState,
} from "../repositories/setup-wizard-repository.ts";
import {
  parseSetupWizardProgressInput,
  type SetupWizardState,
} from "../../shared/setup-wizard.ts";

function wrap(fallback: string, error: unknown): never {
  if (error instanceof AppError) {
    throw error;
  }
  throw AppError.internal(fallback, error);
}

function isCorruptWizardError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("non valido") ||
      error.message.includes("Proprietà") ||
      error.message.includes("Campo") ||
      error.message.includes("Valore") ||
      error.message.includes("completionSource") ||
      error.message.includes("obbligatorio"))
  );
}

export function getSetupWizardState(): SetupWizardState {
  try {
    return withAppTransaction((db) => readSetupWizardState(db));
  } catch (error) {
    if (isCorruptWizardError(error)) {
      throw AppError.validation(
        "Stato della configurazione iniziale non leggibile. I dati aziendali non sono stati modificati.",
        error,
      );
    }
    wrap("Impossibile leggere lo stato della configurazione iniziale.", error);
  }
}

export function saveSetupWizardProgress(input: unknown): SetupWizardState {
  let progress;
  try {
    progress = parseSetupWizardProgressInput(input);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Progresso wizard non valido.";
    throw AppError.validation(message, error);
  }

  try {
    return withAppTransaction((db) => {
      const existing = readSetupWizardStateRaw(db);
      if (existing?.status === "completed") {
        throw AppError.conflict(
          "La configurazione iniziale è già completata. Usa Azienda e Impostazioni per le modifiche.",
        );
      }
      if (existing === null && detectLegacyConfiguredInstallation(db)) {
        throw AppError.conflict(
          "Questa installazione risulta già configurata. La procedura guidata non è necessaria.",
        );
      }
      const next = buildProgressState(progress.status, progress.currentStep);
      writeSetupWizardState(db, next);
      return next;
    });
  } catch (error) {
    wrap("Impossibile salvare il progresso della configurazione.", error);
  }
}

/**
 * Marks the wizard completed after prior steps persisted company/sector/settings
 * through their own APIs. Does not invent or overwrite those domains.
 */
export function completeSetupWizard(): SetupWizardState {
  try {
    return withAppTransaction((db) => {
      const existing = readSetupWizardStateRaw(db);
      if (existing?.status === "completed") {
        return existing;
      }
      const next = buildCompletedState("user");
      writeSetupWizardState(db, next);
      return next;
    });
  } catch (error) {
    if (isCorruptWizardError(error)) {
      throw AppError.validation(
        "Stato della configurazione iniziale non leggibile. Completamento annullato; i dati non sono stati sovrascritti.",
        error,
      );
    }
    wrap("Impossibile completare la configurazione iniziale.", error);
  }
}
