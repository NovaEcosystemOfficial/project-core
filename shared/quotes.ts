import {
  bpsToPercentString,
  calculateLineMoney,
  centsToEuroString,
  isAllowedVatRateBps,
  milliToQuantityString,
  parseDiscountPercentToBps,
  parseEurosToCents,
  parseQuantityToMilli,
  parseVatRatePercentToBps,
  QUOTE_VAT_RATE_BPS,
  sumDocumentTotals,
  type QuoteVatRateBps,
} from "./quotes-money.ts";

export const QUOTE_LIFECYCLE_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "rejected",
  "expired",
] as const;
export type QuoteLifecycleStatus = (typeof QUOTE_LIFECYCLE_STATUSES)[number];

export const QUOTE_LIST_ARCHIVE_FILTERS = ["active", "archived", "all"] as const;
export type QuoteListArchiveFilter = (typeof QUOTE_LIST_ARCHIVE_FILTERS)[number];

export const QUOTE_FIELD_LIMITS = {
  number: 32,
  notes: 8000,
  description: 500,
  unit: 32,
  search: 100,
  customerName: 200,
} as const;

export const QUOTE_PAGE_SIZE_DEFAULT = 25;
export const QUOTE_PAGE_SIZE_MAX = 100;

export const QUOTE_CURRENCY = "EUR" as const;

export type QuoteCustomerSnapshot = {
  name: string;
  address: string | null;
  taxCode: string | null;
  vatNumber: string | null;
  email: string | null;
  phone: string | null;
};

/** Public line DTO — money as integer cents; quantity as decimal string. */
export type QuoteItemDto = {
  id: string;
  position: number;
  description: string;
  quantity: string;
  unit: string | null;
  unitPriceCents: number;
  unitPrice: string;
  discountPercent: string;
  vatRatePercent: string;
  vatRateBps: QuoteVatRateBps;
  taxableCents: number;
  vatCents: number;
  totalCents: number;
  taxable: string;
  vat: string;
  total: string;
};

export type QuoteDto = {
  id: string;
  number: string;
  partyId: string;
  customer: QuoteCustomerSnapshot;
  issueDate: string;
  dueDate: string | null;
  lifecycleStatus: QuoteLifecycleStatus;
  archived: boolean;
  notes: string | null;
  currency: typeof QUOTE_CURRENCY;
  taxableCents: number;
  vatCents: number;
  totalCents: number;
  taxable: string;
  vat: string;
  total: string;
  items: QuoteItemDto[];
  createdAt: string;
  updatedAt: string;
};

export type QuoteListItemDto = {
  id: string;
  number: string;
  partyId: string;
  customerName: string;
  issueDate: string;
  lifecycleStatus: QuoteLifecycleStatus;
  archived: boolean;
  totalCents: number;
  total: string;
  updatedAt: string;
};

export type QuoteListQuery = {
  search: string;
  archive: QuoteListArchiveFilter;
  lifecycleStatus: QuoteLifecycleStatus | "all";
  page: number;
  pageSize: number;
};

export type QuoteListResult = {
  items: QuoteListItemDto[];
  total: number;
  page: number;
  pageSize: number;
};

export type QuoteItemInput = {
  description: string;
  quantity: string;
  unit: string | null;
  unitPrice: string;
  discountPercent: string;
  vatRatePercent: string;
};

export type QuoteWriteInput = {
  partyId: string;
  issueDate: string;
  dueDate: string | null;
  notes: string | null;
  items: QuoteItemInput[];
};

export type QuoteUpdateInput = QuoteWriteInput & {
  id: string;
};

export type QuoteStatusChangeInput = {
  id: string;
  lifecycleStatus: QuoteLifecycleStatus;
};

export type ComputedQuoteItem = {
  id: string;
  position: number;
  description: string;
  quantityMilli: number;
  unit: string | null;
  unitPriceCents: number;
  discountBps: number;
  vatRateBps: QuoteVatRateBps;
  taxableCents: number;
  vatCents: number;
  totalCents: number;
};

export type ComputedQuoteDocument = {
  items: ComputedQuoteItem[];
  taxableCents: number;
  vatCents: number;
  totalCents: number;
};

const WRITE_KEYS = new Set([
  "partyId",
  "issueDate",
  "dueDate",
  "notes",
  "items",
]);
const UPDATE_KEYS = new Set([...WRITE_KEYS, "id"]);
const ITEM_KEYS = new Set([
  "description",
  "quantity",
  "unit",
  "unitPrice",
  "discountPercent",
  "vatRatePercent",
]);
const LIST_KEYS = new Set([
  "search",
  "archive",
  "lifecycleStatus",
  "page",
  "pageSize",
]);
const STATUS_KEYS = new Set(["id", "lifecycleStatus"]);

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

function parseId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} non valido.`);
  }
  const id = value.trim();
  if (id.length > 64 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`${label} non valido.`);
  }
  return id;
}

function parseOptionalText(
  value: unknown,
  key: string,
  max: number,
): string | null {
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
    throw new Error(`"${key}" supera la lunghezza massima consentita.`);
  }
  return trimmed;
}

function parseIsoDate(value: unknown, key: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Data non valida per "${key}".`);
  }
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m! - 1 ||
    dt.getUTCDate() !== d
  ) {
    throw new Error(`Data non valida per "${key}".`);
  }
  return value;
}

function parseOptionalIsoDate(value: unknown, key: string): string | null {
  if (value === null) {
    return null;
  }
  return parseIsoDate(value, key);
}

function parseItemInput(input: unknown, index: number): QuoteItemInput {
  if (!isPlainObject(input)) {
    throw new Error(`Riga ${index + 1}: dati non validi.`);
  }
  assertAllowedKeys(input, ITEM_KEYS);
  for (const key of ITEM_KEYS) {
    if (!(key in input)) {
      throw new Error(`Riga ${index + 1}: campo mancante "${key}".`);
    }
  }
  const description = parseOptionalText(
    input.description,
    "description",
    QUOTE_FIELD_LIMITS.description,
  );
  if (!description) {
    throw new Error(`Riga ${index + 1}: la descrizione è obbligatoria.`);
  }
  return {
    description,
    quantity: String(input.quantity),
    unit: parseOptionalText(input.unit, "unit", QUOTE_FIELD_LIMITS.unit),
    unitPrice: String(input.unitPrice),
    discountPercent: String(input.discountPercent),
    vatRatePercent: String(input.vatRatePercent),
  };
}

export function computeQuoteDocument(
  itemsInput: QuoteItemInput[],
  existingItemIds?: string[],
): ComputedQuoteDocument {
  if (!Array.isArray(itemsInput) || itemsInput.length === 0) {
    throw new Error("Il preventivo deve contenere almeno una riga.");
  }
  if (itemsInput.length > 200) {
    throw new Error("Troppe righe nel preventivo.");
  }

  const items: ComputedQuoteItem[] = itemsInput.map((raw, index) => {
    const quantityMilli = parseQuantityToMilli(raw.quantity);
    const unitPriceCents = parseEurosToCents(raw.unitPrice);
    const discountBps = parseDiscountPercentToBps(raw.discountPercent);
    const vatRateBps = parseVatRatePercentToBps(raw.vatRatePercent);
    const money = calculateLineMoney({
      quantityMilli,
      unitPriceCents,
      discountBps,
      vatRateBps,
    });
    return {
      id: existingItemIds?.[index] ?? `tmp-${index}`,
      position: index + 1,
      description: raw.description,
      quantityMilli,
      unit: raw.unit,
      unitPriceCents,
      discountBps,
      vatRateBps,
      ...money,
    };
  });

  const totals = sumDocumentTotals(items);
  return { items, ...totals };
}

export function parseQuoteWriteInput(input: unknown): QuoteWriteInput {
  if (!isPlainObject(input)) {
    throw new Error("I dati del preventivo devono essere un oggetto.");
  }
  assertAllowedKeys(input, WRITE_KEYS);
  for (const key of WRITE_KEYS) {
    if (!(key in input)) {
      throw new Error(`Campo obbligatorio mancante: ${key}`);
    }
  }
  if (!Array.isArray(input.items)) {
    throw new Error("Le righe del preventivo devono essere un elenco.");
  }
  const items = input.items.map((item, index) => parseItemInput(item, index));
  // Validate calculable now (rejects bad numbers early).
  computeQuoteDocument(items);

  return {
    partyId: parseId(input.partyId, "Cliente"),
    issueDate: parseIsoDate(input.issueDate, "issueDate"),
    dueDate: parseOptionalIsoDate(input.dueDate, "dueDate"),
    notes: parseOptionalText(input.notes, "notes", QUOTE_FIELD_LIMITS.notes),
    items,
  };
}

export function parseQuoteUpdateInput(input: unknown): QuoteUpdateInput {
  if (!isPlainObject(input)) {
    throw new Error("I dati del preventivo devono essere un oggetto.");
  }
  assertAllowedKeys(input, UPDATE_KEYS);
  for (const key of UPDATE_KEYS) {
    if (!(key in input)) {
      throw new Error(`Campo obbligatorio mancante: ${key}`);
    }
  }
  const base = parseQuoteWriteInput({
    partyId: input.partyId,
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    notes: input.notes,
    items: input.items,
  });
  return { id: parseId(input.id, "Preventivo"), ...base };
}

export function parseQuoteIdInput(input: unknown): string {
  if (typeof input === "string") {
    return parseId(input, "Preventivo");
  }
  if (isPlainObject(input) && "id" in input) {
    const keys = Object.keys(input);
    if (keys.length !== 1 || keys[0] !== "id") {
      throw new Error("Proprietà non consentita nella richiesta.");
    }
    return parseId(input.id, "Preventivo");
  }
  throw new Error("Identificativo preventivo non valido.");
}

export function parseQuoteStatusChangeInput(
  input: unknown,
): QuoteStatusChangeInput {
  if (!isPlainObject(input)) {
    throw new Error("Richiesta di cambio stato non valida.");
  }
  assertAllowedKeys(input, STATUS_KEYS);
  if (!("id" in input) || !("lifecycleStatus" in input)) {
    throw new Error("Campi obbligatori mancanti per il cambio stato.");
  }
  if (
    typeof input.lifecycleStatus !== "string" ||
    !(QUOTE_LIFECYCLE_STATUSES as readonly string[]).includes(
      input.lifecycleStatus,
    )
  ) {
    throw new Error("Stato preventivo non valido.");
  }
  return {
    id: parseId(input.id, "Preventivo"),
    lifecycleStatus: input.lifecycleStatus as QuoteLifecycleStatus,
  };
}

export function parseQuoteListQuery(input: unknown): QuoteListQuery {
  if (input === undefined || input === null) {
    return {
      search: "",
      archive: "active",
      lifecycleStatus: "all",
      page: 1,
      pageSize: QUOTE_PAGE_SIZE_DEFAULT,
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
    if (search.length > QUOTE_FIELD_LIMITS.search) {
      throw new Error("La ricerca supera la lunghezza massima consentita.");
    }
  }

  let archive: QuoteListArchiveFilter = "active";
  if ("archive" in input) {
    if (
      typeof input.archive !== "string" ||
      !(QUOTE_LIST_ARCHIVE_FILTERS as readonly string[]).includes(input.archive)
    ) {
      throw new Error('Valore non valido per "archive".');
    }
    archive = input.archive as QuoteListArchiveFilter;
  }

  let lifecycleStatus: QuoteLifecycleStatus | "all" = "all";
  if ("lifecycleStatus" in input) {
    if (input.lifecycleStatus === "all") {
      lifecycleStatus = "all";
    } else if (
      typeof input.lifecycleStatus !== "string" ||
      !(QUOTE_LIFECYCLE_STATUSES as readonly string[]).includes(
        input.lifecycleStatus,
      )
    ) {
      throw new Error('Valore non valido per "lifecycleStatus".');
    } else {
      lifecycleStatus = input.lifecycleStatus as QuoteLifecycleStatus;
    }
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

  let pageSize = QUOTE_PAGE_SIZE_DEFAULT;
  if ("pageSize" in input) {
    if (
      typeof input.pageSize !== "number" ||
      !Number.isInteger(input.pageSize) ||
      input.pageSize < 1 ||
      input.pageSize > QUOTE_PAGE_SIZE_MAX
    ) {
      throw new Error('Valore non valido per "pageSize".');
    }
    pageSize = input.pageSize;
  }

  return { search, archive, lifecycleStatus, page, pageSize };
}

export function mapComputedItemToDto(item: ComputedQuoteItem): QuoteItemDto {
  return {
    id: item.id,
    position: item.position,
    description: item.description,
    quantity: milliToQuantityString(item.quantityMilli),
    unit: item.unit,
    unitPriceCents: item.unitPriceCents,
    unitPrice: centsToEuroString(item.unitPriceCents),
    discountPercent: bpsToPercentString(item.discountBps),
    vatRatePercent: bpsToPercentString(item.vatRateBps),
    vatRateBps: item.vatRateBps,
    taxableCents: item.taxableCents,
    vatCents: item.vatCents,
    totalCents: item.totalCents,
    taxable: centsToEuroString(item.taxableCents),
    vat: centsToEuroString(item.vatCents),
    total: centsToEuroString(item.totalCents),
  };
}

export function emptyQuoteItemInput(): QuoteItemInput {
  return {
    description: "",
    quantity: "1",
    unit: null,
    unitPrice: "0.00",
    discountPercent: "0",
    vatRatePercent: "22",
  };
}

export { QUOTE_VAT_RATE_BPS, isAllowedVatRateBps, centsToEuroString };
