/**
 * Public contracts for Anagrafiche CSV export.
 * Never include filesystem paths in results sent to the renderer.
 */

import {
  PARTY_FIELD_LIMITS,
  PARTY_LIST_STATUS_FILTERS,
  type PartyListStatusFilter,
} from "./parties.ts";

/** Hard cap for a single export — keeps memory predictable for a desktop ERP. */
export const PARTY_EXPORT_MAX_ROWS = 50_000;

export type PartyExportFilter = {
  search: string;
  status: PartyListStatusFilter;
};

export type PartiesCsvExportResult =
  | { status: "completed"; fileName: string; rowCount: number }
  | { status: "cancelled" }
  | { status: "empty" };

const EXPORT_FILTER_KEYS = new Set(["search", "status"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Strict parser for export filters (search + status only).
 * Same semantics as list filters; pagination keys are rejected.
 */
export function parsePartyExportFilter(input: unknown): PartyExportFilter {
  if (input === undefined || input === null) {
    return { search: "", status: "active" };
  }
  if (!isPlainObject(input)) {
    throw new Error("Parametri di esportazione non validi.");
  }

  for (const key of Object.keys(input)) {
    if (!EXPORT_FILTER_KEYS.has(key)) {
      throw new Error(`Proprietà non consentita: ${key}`);
    }
  }

  let search = "";
  if ("search" in input) {
    if (typeof input.search !== "string") {
      throw new Error('Valore non valido per "search".');
    }
    search = input.search.trim();
    if (search.length > PARTY_FIELD_LIMITS.search) {
      throw new Error("La ricerca supera la lunghezza massima consentita.");
    }
  }

  let status: PartyListStatusFilter = "active";
  if ("status" in input) {
    if (
      typeof input.status !== "string" ||
      !(PARTY_LIST_STATUS_FILTERS as readonly string[]).includes(input.status)
    ) {
      throw new Error('Valore non valido per "status".');
    }
    status = input.status as PartyListStatusFilter;
  }

  return { search, status };
}
