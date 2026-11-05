import { randomUUID } from "node:crypto";
import { AppError } from "../errors/app-error.ts";
import { getDatabase, withAppTransaction } from "../db/connection.ts";
import {
  findPartyById,
  insertParty,
  listParties,
  setPartyStatus,
  updatePartyFields,
} from "../repositories/parties-repository.ts";
import {
  parsePartyCreateInput,
  parsePartyIdInput,
  parsePartyListQuery,
  parsePartyUpdateInput,
  type PartyDto,
  type PartyListResult,
} from "../../shared/parties.ts";

function wrapDbError(fallback: string, error: unknown): never {
  if (error instanceof AppError) {
    throw error;
  }
  throw AppError.internal(fallback, error);
}

export function listPartiesForApp(input: unknown): PartyListResult {
  let query;
  try {
    query = parsePartyListQuery(input);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Parametri di elenco non validi.";
    throw AppError.validation(message, error);
  }

  try {
    return listParties(getDatabase(), query);
  } catch (error) {
    wrapDbError("Impossibile leggere le anagrafiche.", error);
  }
}

export function getPartyForApp(input: unknown): PartyDto {
  let id: string;
  try {
    id = parsePartyIdInput(input);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Identificativo anagrafica non valido.";
    throw AppError.validation(message, error);
  }

  try {
    const party = findPartyById(getDatabase(), id);
    if (!party) {
      throw AppError.notFound("Anagrafica non trovata.");
    }
    return party;
  } catch (error) {
    wrapDbError("Impossibile leggere l’anagrafica.", error);
  }
}

export function createPartyForApp(input: unknown): PartyDto {
  let fields;
  try {
    fields = parsePartyCreateInput(input);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dati anagrafica non validi.";
    throw AppError.validation(message, error);
  }

  try {
    const id = randomUUID();
    return withAppTransaction((db) => insertParty(db, id, fields));
  } catch (error) {
    wrapDbError("Impossibile creare l’anagrafica.", error);
  }
}

export function updatePartyForApp(input: unknown): PartyDto {
  let payload;
  try {
    payload = parsePartyUpdateInput(input);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dati anagrafica non validi.";
    throw AppError.validation(message, error);
  }

  try {
    return withAppTransaction((db) => {
      const existing = findPartyById(db, payload.id);
      if (!existing) {
        throw AppError.notFound("Anagrafica non trovata.");
      }
      const { id, ...fields } = payload;
      const updated = updatePartyFields(db, id, fields);
      if (!updated) {
        throw AppError.notFound("Anagrafica non trovata.");
      }
      return updated;
    });
  } catch (error) {
    wrapDbError("Impossibile aggiornare l’anagrafica.", error);
  }
}

export function archivePartyForApp(input: unknown): PartyDto {
  let id: string;
  try {
    id = parsePartyIdInput(input);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Identificativo anagrafica non valido.";
    throw AppError.validation(message, error);
  }

  try {
    return withAppTransaction((db) => {
      const existing = findPartyById(db, id);
      if (!existing) {
        throw AppError.notFound("Anagrafica non trovata.");
      }
      if (existing.status === "archived") {
        throw AppError.conflict("L’anagrafica è già archiviata.");
      }
      const updated = setPartyStatus(db, id, "archived");
      if (!updated) {
        throw AppError.notFound("Anagrafica non trovata.");
      }
      return updated;
    });
  } catch (error) {
    wrapDbError("Impossibile archiviare l’anagrafica.", error);
  }
}

export function reactivatePartyForApp(input: unknown): PartyDto {
  let id: string;
  try {
    id = parsePartyIdInput(input);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Identificativo anagrafica non valido.";
    throw AppError.validation(message, error);
  }

  try {
    return withAppTransaction((db) => {
      const existing = findPartyById(db, id);
      if (!existing) {
        throw AppError.notFound("Anagrafica non trovata.");
      }
      if (existing.status === "active") {
        throw AppError.conflict("L’anagrafica è già attiva.");
      }
      const updated = setPartyStatus(db, id, "active");
      if (!updated) {
        throw AppError.notFound("Anagrafica non trovata.");
      }
      return updated;
    });
  } catch (error) {
    wrapDbError("Impossibile riattivare l’anagrafica.", error);
  }
}
