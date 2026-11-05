import { randomUUID } from "node:crypto";
import { AppError } from "../errors/app-error.ts";
import { getDatabase, withAppTransaction } from "../db/connection.ts";
import { findPartyById } from "../repositories/parties-repository.ts";
import {
  allocateQuoteNumber,
  findQuoteById,
  insertQuote,
  listQuotes,
  replaceQuoteDraft,
  setQuoteArchived,
  setQuoteLifecycleStatus,
} from "../repositories/quotes-repository.ts";
import {
  computeQuoteDocument,
  parseQuoteIdInput,
  parseQuoteListQuery,
  parseQuoteStatusChangeInput,
  parseQuoteUpdateInput,
  parseQuoteWriteInput,
  type QuoteCustomerSnapshot,
  type QuoteDto,
  type QuoteLifecycleStatus,
  type QuoteListResult,
} from "../../shared/quotes.ts";

function wrapDbError(fallback: string, error: unknown): never {
  if (error instanceof AppError) {
    throw error;
  }
  throw AppError.internal(fallback, error);
}

function snapshotFromParty(party: {
  displayName: string;
  address: string | null;
  taxCode: string | null;
  vatNumber: string | null;
  email: string | null;
  phone: string | null;
}): QuoteCustomerSnapshot {
  return {
    name: party.displayName,
    address: party.address,
    taxCode: party.taxCode,
    vatNumber: party.vatNumber,
    email: party.email,
    phone: party.phone,
  };
}

function assertSelectableCustomer(party: NonNullable<ReturnType<typeof findPartyById>>): void {
  if (!party.isCustomer) {
    throw AppError.validation(
      "Il soggetto selezionato non ha il ruolo cliente.",
    );
  }
  if (party.status !== "active") {
    throw AppError.validation(
      "Non è possibile usare un cliente archiviato per un nuovo documento.",
    );
  }
}

const ALLOWED_TRANSITIONS: Record<
  QuoteLifecycleStatus,
  readonly QuoteLifecycleStatus[]
> = {
  draft: ["sent", "expired"],
  sent: ["accepted", "rejected", "expired", "draft"],
  accepted: ["expired"],
  rejected: ["draft"],
  expired: ["draft"],
};

export function listQuotesForApp(input: unknown): QuoteListResult {
  let query;
  try {
    query = parseQuoteListQuery(input);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Parametri di elenco non validi.";
    throw AppError.validation(message, error);
  }
  try {
    return listQuotes(getDatabase(), query);
  } catch (error) {
    wrapDbError("Impossibile leggere i preventivi.", error);
  }
}

export function getQuoteForApp(input: unknown): QuoteDto {
  let id: string;
  try {
    id = parseQuoteIdInput(input);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Identificativo preventivo non valido.";
    throw AppError.validation(message, error);
  }
  try {
    const quote = findQuoteById(getDatabase(), id);
    if (!quote) {
      throw AppError.notFound("Preventivo non trovato.");
    }
    return quote;
  } catch (error) {
    wrapDbError("Impossibile leggere il preventivo.", error);
  }
}

export function createQuoteForApp(input: unknown): QuoteDto {
  let payload;
  try {
    payload = parseQuoteWriteInput(input);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dati preventivo non validi.";
    throw AppError.validation(message, error);
  }

  try {
    return withAppTransaction((db) => {
      const party = findPartyById(db, payload.partyId);
      if (!party) {
        throw AppError.validation("Cliente non trovato.");
      }
      assertSelectableCustomer(party);

      const computed = computeQuoteDocument(payload.items);
      const itemIds = computed.items.map(() => randomUUID());
      const year = Number(payload.issueDate.slice(0, 4));
      const number = allocateQuoteNumber(db, year);

      return insertQuote(db, {
        id: randomUUID(),
        number,
        partyId: party.id,
        customer: snapshotFromParty(party),
        issueDate: payload.issueDate,
        dueDate: payload.dueDate,
        notes: payload.notes,
        computed: {
          ...computed,
          items: computed.items.map((item, index) => ({
            ...item,
            id: itemIds[index]!,
          })),
        },
        itemIds,
      });
    });
  } catch (error) {
    wrapDbError("Impossibile creare il preventivo.", error);
  }
}

export function updateQuoteForApp(input: unknown): QuoteDto {
  let payload;
  try {
    payload = parseQuoteUpdateInput(input);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dati preventivo non validi.";
    throw AppError.validation(message, error);
  }

  try {
    return withAppTransaction((db) => {
      const existing = findQuoteById(db, payload.id);
      if (!existing) {
        throw AppError.notFound("Preventivo non trovato.");
      }
      if (existing.archived) {
        throw AppError.conflict("Un preventivo archiviato non può essere modificato.");
      }
      if (existing.lifecycleStatus !== "draft") {
        throw AppError.conflict(
          "Solo i preventivi in bozza possono essere modificati.",
        );
      }

      const party = findPartyById(db, payload.partyId);
      if (!party) {
        throw AppError.validation("Cliente non trovato.");
      }
      // Allow keeping / selecting active customers only when changing party.
      assertSelectableCustomer(party);

      const computed = computeQuoteDocument(payload.items);
      const itemIds = computed.items.map(() => randomUUID());
      const updated = replaceQuoteDraft(db, {
        id: payload.id,
        partyId: party.id,
        customer: snapshotFromParty(party),
        issueDate: payload.issueDate,
        dueDate: payload.dueDate,
        notes: payload.notes,
        computed: {
          ...computed,
          items: computed.items.map((item, index) => ({
            ...item,
            id: itemIds[index]!,
          })),
        },
        itemIds,
      });
      if (!updated) {
        throw AppError.conflict(
          "Solo i preventivi in bozza possono essere modificati.",
        );
      }
      return updated;
    });
  } catch (error) {
    wrapDbError("Impossibile aggiornare il preventivo.", error);
  }
}

export function changeQuoteStatusForApp(input: unknown): QuoteDto {
  let payload;
  try {
    payload = parseQuoteStatusChangeInput(input);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Cambio stato non valido.";
    throw AppError.validation(message, error);
  }

  try {
    return withAppTransaction((db) => {
      const existing = findQuoteById(db, payload.id);
      if (!existing) {
        throw AppError.notFound("Preventivo non trovato.");
      }
      if (existing.archived) {
        throw AppError.conflict(
          "Un preventivo archiviato non può cambiare stato.",
        );
      }
      if (existing.lifecycleStatus === payload.lifecycleStatus) {
        throw AppError.conflict("Il preventivo è già in questo stato.");
      }
      const allowed = ALLOWED_TRANSITIONS[existing.lifecycleStatus];
      if (!allowed.includes(payload.lifecycleStatus)) {
        throw AppError.conflict(
          "Transizione di stato non consentita.",
        );
      }
      // Reopening to draft is explicit; amounts stay as last saved snapshot.
      const updated = setQuoteLifecycleStatus(
        db,
        payload.id,
        payload.lifecycleStatus,
      );
      if (!updated) {
        throw AppError.notFound("Preventivo non trovato.");
      }
      return updated;
    });
  } catch (error) {
    wrapDbError("Impossibile aggiornare lo stato del preventivo.", error);
  }
}

export function archiveQuoteForApp(input: unknown): QuoteDto {
  let id: string;
  try {
    id = parseQuoteIdInput(input);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Identificativo preventivo non valido.";
    throw AppError.validation(message, error);
  }

  try {
    return withAppTransaction((db) => {
      const existing = findQuoteById(db, id);
      if (!existing) {
        throw AppError.notFound("Preventivo non trovato.");
      }
      if (existing.archived) {
        throw AppError.conflict("Il preventivo è già archiviato.");
      }
      const updated = setQuoteArchived(db, id, true);
      if (!updated) {
        throw AppError.notFound("Preventivo non trovato.");
      }
      return updated;
    });
  } catch (error) {
    wrapDbError("Impossibile archiviare il preventivo.", error);
  }
}

export function reactivateQuoteForApp(input: unknown): QuoteDto {
  let id: string;
  try {
    id = parseQuoteIdInput(input);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Identificativo preventivo non valido.";
    throw AppError.validation(message, error);
  }

  try {
    return withAppTransaction((db) => {
      const existing = findQuoteById(db, id);
      if (!existing) {
        throw AppError.notFound("Preventivo non trovato.");
      }
      if (!existing.archived) {
        throw AppError.conflict("Il preventivo non è archiviato.");
      }
      const updated = setQuoteArchived(db, id, false);
      if (!updated) {
        throw AppError.notFound("Preventivo non trovato.");
      }
      return updated;
    });
  } catch (error) {
    wrapDbError("Impossibile ripristinare il preventivo.", error);
  }
}

/** Active parties with customer role — for quote editor picker. */
export function listQuoteCustomerOptions(input: unknown): {
  id: string;
  displayName: string;
}[] {
  let search = "";
  if (input !== undefined && input !== null) {
    if (typeof input !== "object" || Array.isArray(input) || input === null) {
      throw AppError.validation("Parametri non validi.");
    }
    const record = input as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key !== "search") {
        throw AppError.validation(`Proprietà non consentita: ${key}`);
      }
    }
    if ("search" in record) {
      if (typeof record.search !== "string") {
        throw AppError.validation('Valore non valido per "search".');
      }
      search = record.search.trim();
      if (search.length > 100) {
        throw AppError.validation("La ricerca supera la lunghezza massima consentita.");
      }
    }
  }

  try {
    const db = getDatabase();
    const params: Record<string, string | number> = { limit: 50 };
    let where =
      "is_customer = 1 AND status = 'active'";
    if (search.length > 0) {
      where +=
        " AND display_name LIKE @pattern ESCAPE '\\' COLLATE NOCASE";
      params.pattern = `%${search.replace(/([\\%_])/g, "\\$1")}%`;
    }
    const rows = db
      .prepare(
        `SELECT id, display_name AS displayName
         FROM parties
         WHERE ${where}
         ORDER BY display_name COLLATE NOCASE ASC, id ASC
         LIMIT @limit`,
      )
      .all(params) as { id: string; displayName: string }[];
    return rows;
  } catch (error) {
    wrapDbError("Impossibile leggere i clienti.", error);
  }
}
