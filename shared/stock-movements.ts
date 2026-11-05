/**
 * Movimenti di magazzino (Passaggio 16B).
 *
 * Quantità interne: millesimi di unità (1 = 1000).
 * Giacenza = Σ(in + adjustment_in) − Σ(out + adjustment_out).
 * Storico immutabile: niente update/delete dei movimenti registrati.
 */

import {
  milliToQuantityString,
  parseQuantityToMilli,
} from "./quotes-money.ts";
import type { ArticleUnitId } from "./articles.ts";

export const STOCK_MOVEMENT_TYPES = [
  "in",
  "out",
  "adjustment_in",
  "adjustment_out",
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const STOCK_MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  in: "Carico",
  out: "Scarico",
  adjustment_in: "Rettifica positiva",
  adjustment_out: "Rettifica negativa",
};

export const STOCK_FIELD_LIMITS = {
  reason: 300,
  notes: 4000,
  search: 100,
} as const;

export const STOCK_PAGE_SIZE_DEFAULT = 25;
export const STOCK_PAGE_SIZE_MAX = 100;

export type StockMovementDto = {
  id: string;
  articleId: string;
  articleCode: string;
  articleDescription: string;
  articleUnit: ArticleUnitId;
  movementType: StockMovementType;
  quantityMilli: number;
  /** Quantità in forma decimale (punto), es. "2.5". */
  quantity: string;
  movementDate: string;
  reason: string | null;
  notes: string | null;
  createdAt: string;
};

export type StockMovementCreateInput = {
  articleId: string;
  movementType: StockMovementType;
  /** Decimal string/number from UI; parsed to milli in main. */
  quantity: string;
  movementDate: string;
  reason: string | null;
  notes: string | null;
};

export type StockMovementListQuery = {
  search: string;
  articleId: string | null;
  movementType: StockMovementType | "all";
  dateFrom: string | null;
  dateTo: string | null;
  page: number;
  pageSize: number;
};

export type StockMovementListResult = {
  items: StockMovementDto[];
  total: number;
  page: number;
  pageSize: number;
};

export type ArticleStockDto = {
  articleId: string;
  stockMilli: number;
  stock: string;
};

export type StockBalanceDto = {
  articleId: string;
  code: string;
  description: string;
  unit: ArticleUnitId;
  stockMilli: number;
  stock: string;
  minStock: number | null;
  minStockMilli: number | null;
  belowMinStock: boolean;
  status: "active" | "archived";
};

export type StockBalanceListQuery = {
  search: string;
  /** Solo attivi di default; "below_min" filtra sotto scorta. */
  filter: "active" | "below_min" | "all_active";
  page: number;
  pageSize: number;
};

export type StockBalanceListResult = {
  items: StockBalanceDto[];
  total: number;
  page: number;
  pageSize: number;
};

export type WarehouseSummaryDto = {
  activeArticles: number;
  belowMinStockCount: number;
  movementCount: number;
};

const CREATE_KEYS = new Set([
  "articleId",
  "movementType",
  "quantity",
  "movementDate",
  "reason",
  "notes",
]);

const LIST_KEYS = new Set([
  "search",
  "articleId",
  "movementType",
  "dateFrom",
  "dateTo",
  "page",
  "pageSize",
]);

const BALANCE_KEYS = new Set(["search", "filter", "page", "pageSize"]);

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

export function isStockMovementType(
  value: unknown,
): value is StockMovementType {
  return (
    typeof value === "string" &&
    (STOCK_MOVEMENT_TYPES as readonly string[]).includes(value)
  );
}

export function isOutboundMovement(type: StockMovementType): boolean {
  return type === "out" || type === "adjustment_out";
}

export function isInboundMovement(type: StockMovementType): boolean {
  return type === "in" || type === "adjustment_in";
}

/** Signed milli contribution to stock for a movement type. */
export function movementSignedMilli(
  type: StockMovementType,
  quantityMilli: number,
): number {
  return isInboundMovement(type) ? quantityMilli : -quantityMilli;
}

export function minStockToMilli(minStock: number | null): number | null {
  if (minStock === null) {
    return null;
  }
  if (!Number.isFinite(minStock) || minStock < 0) {
    return null;
  }
  if (minStock === 0) {
    return 0;
  }
  // Align with quantity milli precision (3 decimals).
  return Math.round(minStock * 1000);
}

export function isBelowMinStock(
  stockMilli: number,
  minStock: number | null,
): boolean {
  if (minStock === null || minStock <= 0) {
    return false;
  }
  const threshold = minStockToMilli(minStock);
  if (threshold === null) {
    return false;
  }
  return stockMilli <= threshold;
}

/** Italian display: decimal comma. */
export function formatQuantityItalian(milli: number): string {
  return milliToQuantityString(milli).replace(".", ",");
}

/**
 * Parse quantity for stock movements.
 * - Always > 0, max 3 decimals.
 * - For `pcs`, only whole units (milli % 1000 === 0).
 */
export function parseStockQuantityToMilli(
  value: unknown,
  unit: ArticleUnitId,
): number {
  const milli = parseQuantityToMilli(value);
  if (unit === "pcs" && milli % 1000 !== 0) {
    throw new Error(
      "Per l’unità pezzi sono ammesse solo quantità intere.",
    );
  }
  return milli;
}

function parseIsoDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Data non valida per "${field}".`);
  }
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m! - 1 ||
    dt.getUTCDate() !== d
  ) {
    throw new Error(`Data non valida per "${field}".`);
  }
  return value;
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

export function parseStockMovementCreateInput(
  input: unknown,
): StockMovementCreateInput {
  if (!isPlainObject(input)) {
    throw new Error("Payload movimento non valido.");
  }
  assertAllowedKeys(input, CREATE_KEYS);

  if (
    !("articleId" in input) ||
    typeof input.articleId !== "string" ||
    input.articleId.trim().length === 0
  ) {
    throw new Error("Identificativo articolo non valido.");
  }
  if (!("movementType" in input) || !isStockMovementType(input.movementType)) {
    throw new Error("Tipo di movimento non valido.");
  }
  if (!("quantity" in input) || typeof input.quantity !== "string") {
    throw new Error("Quantità non valida.");
  }
  if (!("movementDate" in input)) {
    throw new Error('Campo obbligatorio mancante: movementDate');
  }

  const reason = optionalNullableString(
    input,
    "reason",
    STOCK_FIELD_LIMITS.reason,
  );
  const notes = optionalNullableString(
    input,
    "notes",
    STOCK_FIELD_LIMITS.notes,
  );
  const type = input.movementType;
  if (
    (type === "adjustment_in" || type === "adjustment_out") &&
    (reason === null || reason.length === 0)
  ) {
    throw new Error("La causale è obbligatoria per le rettifiche.");
  }

  return {
    articleId: input.articleId.trim(),
    movementType: type,
    quantity: input.quantity.trim(),
    movementDate: parseIsoDate(input.movementDate, "movementDate"),
    reason,
    notes,
  };
}

export function parseStockMovementListQuery(
  input: unknown,
): StockMovementListQuery {
  if (input === undefined || input === null) {
    return {
      search: "",
      articleId: null,
      movementType: "all",
      dateFrom: null,
      dateTo: null,
      page: 1,
      pageSize: STOCK_PAGE_SIZE_DEFAULT,
    };
  }
  if (!isPlainObject(input)) {
    throw new Error("Parametri di elenco movimenti non validi.");
  }
  assertAllowedKeys(input, LIST_KEYS);

  let search = "";
  if ("search" in input) {
    if (typeof input.search !== "string") {
      throw new Error('Valore non valido per "search".');
    }
    search = input.search.trim();
    if (search.length > STOCK_FIELD_LIMITS.search) {
      throw new Error(
        `La ricerca supera la lunghezza massima (${STOCK_FIELD_LIMITS.search}).`,
      );
    }
  }

  let articleId: string | null = null;
  if ("articleId" in input && input.articleId !== null) {
    if (typeof input.articleId !== "string" || !input.articleId.trim()) {
      throw new Error('Valore non valido per "articleId".');
    }
    articleId = input.articleId.trim();
  }

  let movementType: StockMovementType | "all" = "all";
  if ("movementType" in input) {
    if (input.movementType === "all") {
      movementType = "all";
    } else if (isStockMovementType(input.movementType)) {
      movementType = input.movementType;
    } else {
      throw new Error('Valore non valido per "movementType".');
    }
  }

  let dateFrom: string | null = null;
  if ("dateFrom" in input && input.dateFrom !== null) {
    dateFrom = parseIsoDate(input.dateFrom, "dateFrom");
  }
  let dateTo: string | null = null;
  if ("dateTo" in input && input.dateTo !== null) {
    dateTo = parseIsoDate(input.dateTo, "dateTo");
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new Error("L’intervallo date non è valido.");
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

  let pageSize = STOCK_PAGE_SIZE_DEFAULT;
  if ("pageSize" in input) {
    if (
      typeof input.pageSize !== "number" ||
      !Number.isInteger(input.pageSize) ||
      input.pageSize < 1 ||
      input.pageSize > STOCK_PAGE_SIZE_MAX
    ) {
      throw new Error('Valore non valido per "pageSize".');
    }
    pageSize = input.pageSize;
  }

  return {
    search,
    articleId,
    movementType,
    dateFrom,
    dateTo,
    page,
    pageSize,
  };
}

export function parseStockBalanceListQuery(
  input: unknown,
): StockBalanceListQuery {
  if (input === undefined || input === null) {
    return {
      search: "",
      filter: "active",
      page: 1,
      pageSize: STOCK_PAGE_SIZE_DEFAULT,
    };
  }
  if (!isPlainObject(input)) {
    throw new Error("Parametri di elenco giacenze non validi.");
  }
  assertAllowedKeys(input, BALANCE_KEYS);

  let search = "";
  if ("search" in input) {
    if (typeof input.search !== "string") {
      throw new Error('Valore non valido per "search".');
    }
    search = input.search.trim();
    if (search.length > STOCK_FIELD_LIMITS.search) {
      throw new Error(
        `La ricerca supera la lunghezza massima (${STOCK_FIELD_LIMITS.search}).`,
      );
    }
  }

  let filter: StockBalanceListQuery["filter"] = "active";
  if ("filter" in input) {
    if (
      input.filter !== "active" &&
      input.filter !== "below_min" &&
      input.filter !== "all_active"
    ) {
      throw new Error('Valore non valido per "filter".');
    }
    filter = input.filter;
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

  let pageSize = STOCK_PAGE_SIZE_DEFAULT;
  if ("pageSize" in input) {
    if (
      typeof input.pageSize !== "number" ||
      !Number.isInteger(input.pageSize) ||
      input.pageSize < 1 ||
      input.pageSize > STOCK_PAGE_SIZE_MAX
    ) {
      throw new Error('Valore non valido per "pageSize".');
    }
    pageSize = input.pageSize;
  }

  return { search, filter, page, pageSize };
}

export function parseArticleIdForStock(input: unknown): string {
  if (typeof input === "string" && input.trim()) {
    return input.trim();
  }
  if (isPlainObject(input) && typeof input.articleId === "string" && input.articleId.trim()) {
    return input.articleId.trim();
  }
  if (isPlainObject(input) && typeof input.id === "string" && input.id.trim()) {
    return input.id.trim();
  }
  throw new Error("Identificativo articolo non valido.");
}
