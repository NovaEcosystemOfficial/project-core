/**
 * Catalogo articoli (modulo Magazzino — Passaggio 16A).
 * Nessuna giacenza: le quantità arriveranno con i movimenti.
 *
 * Codice articolo: normalizzato con trim + maiuscole, confronto case-insensitive.
 * Unità: ID stabili indipendenti dalle etichette UI.
 */

export const ARTICLE_STATUSES = ["active", "archived"] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export const ARTICLE_LIST_STATUS_FILTERS = [
  "active",
  "archived",
  "all",
] as const;
export type ArticleListStatusFilter =
  (typeof ARTICLE_LIST_STATUS_FILTERS)[number];

/** Stable unit IDs — labels may change without migrating stored values. */
export const ARTICLE_UNIT_IDS = [
  "pcs",
  "kg",
  "g",
  "l",
  "m",
  "m2",
] as const;
export type ArticleUnitId = (typeof ARTICLE_UNIT_IDS)[number];

export type ArticleUnitDefinition = {
  id: ArticleUnitId;
  label: string;
};

export const ARTICLE_UNITS: readonly ArticleUnitDefinition[] = [
  { id: "pcs", label: "Pezzi" },
  { id: "kg", label: "Chilogrammi (kg)" },
  { id: "g", label: "Grammi (g)" },
  { id: "l", label: "Litri" },
  { id: "m", label: "Metri" },
  { id: "m2", label: "Metri quadrati" },
] as const;

export const ARTICLE_FIELD_LIMITS = {
  code: 64,
  description: 300,
  category: 120,
  notes: 4000,
  search: 100,
} as const;

export const ARTICLE_PAGE_SIZE_DEFAULT = 25;
export const ARTICLE_PAGE_SIZE_MAX = 100;

export type ArticleDto = {
  id: string;
  code: string;
  description: string;
  category: string | null;
  unit: ArticleUnitId;
  /** Soglia minima di scorta (≥ 0). Null = non impostata. Non è una giacenza. */
  minStock: number | null;
  notes: string | null;
  status: ArticleStatus;
  createdAt: string;
  updatedAt: string;
};

export type ArticleWriteFields = {
  code: string;
  description: string;
  category: string | null;
  unit: ArticleUnitId;
  minStock: number | null;
  notes: string | null;
};

export type ArticleCreateInput = ArticleWriteFields;
export type ArticleUpdateInput = ArticleWriteFields & { id: string };

export type ArticleListQuery = {
  search: string;
  status: ArticleListStatusFilter;
  page: number;
  pageSize: number;
};

export type ArticleListResult = {
  items: ArticleDto[];
  total: number;
  page: number;
  pageSize: number;
};

const CREATE_KEYS = new Set([
  "code",
  "description",
  "category",
  "unit",
  "minStock",
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

/**
 * Normalizzazione codice: trim, collassa spazi interni, maiuscole.
 * L’unicità è valutata su questo valore (non case-sensitive).
 */
export function normalizeArticleCode(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toUpperCase();
}

export function isArticleUnitId(value: unknown): value is ArticleUnitId {
  return (
    typeof value === "string" &&
    (ARTICLE_UNIT_IDS as readonly string[]).includes(value)
  );
}

export function getArticleUnitLabel(unit: ArticleUnitId): string {
  const found = ARTICLE_UNITS.find((item) => item.id === unit);
  return found?.label ?? unit;
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  max: number,
): string {
  if (!(key in record)) {
    throw new Error(`Campo obbligatorio mancante: ${key}`);
  }
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`Valore non valido per "${key}".`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`Il campo "${key}" non può essere vuoto.`);
  }
  if (trimmed.length > max) {
    throw new Error(`Il campo "${key}" supera la lunghezza massima (${max}).`);
  }
  return trimmed;
}

function optionalNullableString(
  record: Record<string, unknown>,
  key: string,
  max: number,
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
  if (trimmed.length > max) {
    throw new Error(`Il campo "${key}" supera la lunghezza massima (${max}).`);
  }
  return trimmed;
}

function parseMinStock(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error('Valore non valido per "minStock".');
  }
  if (value < 0) {
    throw new Error("La soglia minima non può essere negativa.");
  }
  // Bound extreme values (display/stock planning, not inventory qty).
  if (value > 1_000_000_000) {
    throw new Error("La soglia minima supera il limite consentito.");
  }
  return value;
}

function parseWriteFields(record: Record<string, unknown>): ArticleWriteFields {
  const codeRaw = requireString(record, "code", ARTICLE_FIELD_LIMITS.code);
  const code = normalizeArticleCode(codeRaw);
  if (code.length === 0) {
    throw new Error("Il codice articolo non può essere vuoto.");
  }
  if (code.length > ARTICLE_FIELD_LIMITS.code) {
    throw new Error(
      `Il codice articolo supera la lunghezza massima (${ARTICLE_FIELD_LIMITS.code}).`,
    );
  }

  if (!("unit" in record) || !isArticleUnitId(record.unit)) {
    throw new Error("Unità di misura non valida.");
  }
  if (!("minStock" in record)) {
    throw new Error('Campo obbligatorio mancante: minStock');
  }

  return {
    code,
    description: requireString(
      record,
      "description",
      ARTICLE_FIELD_LIMITS.description,
    ),
    category: optionalNullableString(
      record,
      "category",
      ARTICLE_FIELD_LIMITS.category,
    ),
    unit: record.unit,
    minStock: parseMinStock(record.minStock),
    notes: optionalNullableString(record, "notes", ARTICLE_FIELD_LIMITS.notes),
  };
}

export function parseArticleCreateInput(input: unknown): ArticleCreateInput {
  if (!isPlainObject(input)) {
    throw new Error("Payload creazione articolo non valido.");
  }
  assertAllowedKeys(input, CREATE_KEYS);
  return parseWriteFields(input);
}

export function parseArticleUpdateInput(input: unknown): ArticleUpdateInput {
  if (!isPlainObject(input)) {
    throw new Error("Payload aggiornamento articolo non valido.");
  }
  assertAllowedKeys(input, UPDATE_KEYS);
  if (!("id" in input) || typeof input.id !== "string" || input.id.trim() === "") {
    throw new Error("Identificativo articolo non valido.");
  }
  return {
    id: input.id.trim(),
    ...parseWriteFields(input),
  };
}

export function parseArticleIdInput(input: unknown): string {
  if (typeof input === "string" && input.trim().length > 0) {
    return input.trim();
  }
  if (isPlainObject(input) && typeof input.id === "string" && input.id.trim()) {
    return input.id.trim();
  }
  throw new Error("Identificativo articolo non valido.");
}

export function parseArticleListQuery(input: unknown): ArticleListQuery {
  if (input === undefined || input === null) {
    return {
      search: "",
      status: "active",
      page: 1,
      pageSize: ARTICLE_PAGE_SIZE_DEFAULT,
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
    if (search.length > ARTICLE_FIELD_LIMITS.search) {
      throw new Error(
        `La ricerca supera la lunghezza massima (${ARTICLE_FIELD_LIMITS.search}).`,
      );
    }
  }

  let status: ArticleListStatusFilter = "active";
  if ("status" in input) {
    if (
      typeof input.status !== "string" ||
      !(ARTICLE_LIST_STATUS_FILTERS as readonly string[]).includes(input.status)
    ) {
      throw new Error('Valore non valido per "status".');
    }
    status = input.status as ArticleListStatusFilter;
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

  let pageSize = ARTICLE_PAGE_SIZE_DEFAULT;
  if ("pageSize" in input) {
    if (
      typeof input.pageSize !== "number" ||
      !Number.isInteger(input.pageSize) ||
      input.pageSize < 1 ||
      input.pageSize > ARTICLE_PAGE_SIZE_MAX
    ) {
      throw new Error('Valore non valido per "pageSize".');
    }
    pageSize = input.pageSize;
  }

  return { search, status, page, pageSize };
}

export function emptyArticleWriteFields(): ArticleWriteFields {
  return {
    code: "",
    description: "",
    category: null,
    unit: "pcs",
    minStock: null,
    notes: null,
  };
}
