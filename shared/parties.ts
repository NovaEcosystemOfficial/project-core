/**
 * Public DTOs and strict parsers for the Anagrafiche (parties) module.
 *
 * Timestamps are stored and returned as UTC SQLite datetime strings:
 * `YYYY-MM-DD HH:MM:SS` (from `datetime('now')`).
 */

export const PARTY_STATUSES = ["active", "archived"] as const;
export type PartyStatus = (typeof PARTY_STATUSES)[number];

export const PARTY_LIST_STATUS_FILTERS = [
  "active",
  "archived",
  "all",
] as const;
export type PartyListStatusFilter = (typeof PARTY_LIST_STATUS_FILTERS)[number];

export const PARTY_FIELD_LIMITS = {
  displayName: 200,
  email: 254,
  phone: 40,
  address: 500,
  taxCode: 32,
  vatNumber: 32,
  notes: 4000,
  search: 100,
} as const;

export const PARTY_PAGE_SIZE_DEFAULT = 25;
export const PARTY_PAGE_SIZE_MAX = 100;

/** Public party record safe for the renderer. */
export type PartyDto = {
  id: string;
  displayName: string;
  isCustomer: boolean;
  isSupplier: boolean;
  email: string | null;
  phone: string | null;
  address: string | null;
  taxCode: string | null;
  vatNumber: string | null;
  notes: string | null;
  status: PartyStatus;
  createdAt: string;
  updatedAt: string;
};

export type PartyWriteFields = {
  displayName: string;
  isCustomer: boolean;
  isSupplier: boolean;
  email: string | null;
  phone: string | null;
  address: string | null;
  taxCode: string | null;
  vatNumber: string | null;
  notes: string | null;
};

export type PartyCreateInput = PartyWriteFields;

export type PartyUpdateInput = PartyWriteFields & {
  id: string;
};

export type PartyListQuery = {
  search: string;
  status: PartyListStatusFilter;
  page: number;
  pageSize: number;
};

export type PartyListResult = {
  items: PartyDto[];
  total: number;
  page: number;
  pageSize: number;
};

const CREATE_KEYS = new Set([
  "displayName",
  "isCustomer",
  "isSupplier",
  "email",
  "phone",
  "address",
  "taxCode",
  "vatNumber",
  "notes",
]);

const UPDATE_KEYS = new Set([...CREATE_KEYS, "id"]);

const LIST_KEYS = new Set(["search", "status", "page", "pageSize"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertAllowedKeys(
  record: Record<string, unknown>,
  allowed: Set<string>,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(`Proprietà non consentita: ${key}`);
    }
  }
}

function requireBoolean(record: Record<string, unknown>, key: string): boolean {
  if (!(key in record)) {
    throw new Error(`Campo obbligatorio mancante: ${key}`);
  }
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`Valore non valido per "${key}".`);
  }
  return value;
}

function requireString(record: Record<string, unknown>, key: string): string {
  if (!(key in record)) {
    throw new Error(`Campo obbligatorio mancante: ${key}`);
  }
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`Valore non valido per "${key}".`);
  }
  return value;
}

function parseOptionalText(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | null {
  if (!(key in record)) {
    throw new Error(`Campo obbligatorio mancante: ${key}`);
  }
  const value = record[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`Valore non valido per "${key}".`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > maxLength) {
    throw new Error(`"${key}" supera la lunghezza massima consentita.`);
  }
  return trimmed;
}

function parseDisplayName(record: Record<string, unknown>): string {
  const raw = requireString(record, "displayName").trim();
  if (raw.length === 0) {
    throw new Error("Il nome o la ragione sociale è obbligatorio.");
  }
  if (raw.length > PARTY_FIELD_LIMITS.displayName) {
    throw new Error("Il nome supera la lunghezza massima consentita.");
  }
  return raw;
}

function parseEmail(record: Record<string, unknown>): string | null {
  const email = parseOptionalText(record, "email", PARTY_FIELD_LIMITS.email);
  if (email === null) {
    return null;
  }
  // Practical check — not a full RFC validator.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Indirizzo email non valido.");
  }
  return email;
}

function parseWriteFields(record: Record<string, unknown>): PartyWriteFields {
  const isCustomer = requireBoolean(record, "isCustomer");
  const isSupplier = requireBoolean(record, "isSupplier");
  if (!isCustomer && !isSupplier) {
    throw new Error("Selezionare almeno un ruolo: cliente o fornitore.");
  }

  return {
    displayName: parseDisplayName(record),
    isCustomer,
    isSupplier,
    email: parseEmail(record),
    phone: parseOptionalText(record, "phone", PARTY_FIELD_LIMITS.phone),
    address: parseOptionalText(record, "address", PARTY_FIELD_LIMITS.address),
    taxCode: parseOptionalText(record, "taxCode", PARTY_FIELD_LIMITS.taxCode),
    vatNumber: parseOptionalText(
      record,
      "vatNumber",
      PARTY_FIELD_LIMITS.vatNumber,
    ),
    notes: parseOptionalText(record, "notes", PARTY_FIELD_LIMITS.notes),
  };
}

function parsePartyId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Identificativo anagrafica non valido.");
  }
  const id = value.trim();
  if (id.length > 64 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error("Identificativo anagrafica non valido.");
  }
  return id;
}

/** Strict create payload: rejects unknown keys and incomplete objects. */
export function parsePartyCreateInput(input: unknown): PartyCreateInput {
  if (!isPlainObject(input)) {
    throw new Error("I dati dell’anagrafica devono essere un oggetto.");
  }
  assertAllowedKeys(input, CREATE_KEYS);
  for (const key of CREATE_KEYS) {
    if (!(key in input)) {
      throw new Error(`Campo obbligatorio mancante: ${key}`);
    }
  }
  return parseWriteFields(input);
}

/** Strict update payload including stable id. */
export function parsePartyUpdateInput(input: unknown): PartyUpdateInput {
  if (!isPlainObject(input)) {
    throw new Error("I dati dell’anagrafica devono essere un oggetto.");
  }
  assertAllowedKeys(input, UPDATE_KEYS);
  for (const key of UPDATE_KEYS) {
    if (!(key in input)) {
      throw new Error(`Campo obbligatorio mancante: ${key}`);
    }
  }
  return {
    id: parsePartyId(input.id),
    ...parseWriteFields(input),
  };
}

export function parsePartyIdInput(input: unknown): string {
  if (typeof input === "string") {
    return parsePartyId(input);
  }
  if (isPlainObject(input) && "id" in input) {
    const keys = Object.keys(input);
    if (keys.length !== 1 || keys[0] !== "id") {
      throw new Error("Proprietà non consentita nella richiesta.");
    }
    return parsePartyId(input.id);
  }
  throw new Error("Identificativo anagrafica non valido.");
}

export function parsePartyListQuery(input: unknown): PartyListQuery {
  if (input === undefined || input === null) {
    return {
      search: "",
      status: "active",
      page: 1,
      pageSize: PARTY_PAGE_SIZE_DEFAULT,
    };
  }
  if (!isPlainObject(input)) {
    throw new Error("Parametri di elenco non validi.");
  }
  assertAllowedKeys(input, LIST_KEYS);

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

  let page = 1;
  if ("page" in input) {
    if (
      typeof input.page !== "number" ||
      !Number.isInteger(input.page) ||
      input.page < 1
    ) {
      throw new Error('Valore non valido per "page".');
    }
    page = input.page;
  }

  let pageSize = PARTY_PAGE_SIZE_DEFAULT;
  if ("pageSize" in input) {
    if (
      typeof input.pageSize !== "number" ||
      !Number.isInteger(input.pageSize) ||
      input.pageSize < 1 ||
      input.pageSize > PARTY_PAGE_SIZE_MAX
    ) {
      throw new Error('Valore non valido per "pageSize".');
    }
    pageSize = input.pageSize;
  }

  return { search, status, page, pageSize };
}

export function emptyPartyWriteFields(): PartyWriteFields {
  return {
    displayName: "",
    isCustomer: true,
    isSupplier: false,
    email: null,
    phone: null,
    address: null,
    taxCode: null,
    vatNumber: null,
    notes: null,
  };
}
