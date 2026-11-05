/**
 * Modulo DDT — importazione, revisione e registrazione magazzino.
 * Quantità: millesimi (allineati a stock_movements).
 * File originali: solo percorso relativo sotto userData (mai assoluto al renderer).
 */

import {
  ARTICLE_UNIT_IDS,
  normalizeArticleCode,
  type ArticleUnitId,
} from "./articles.ts";
import { parseStockQuantityToMilli } from "./stock-movements.ts";

export const DDT_DOCUMENT_TYPES = ["inbound", "outbound"] as const;
export type DdtDocumentType = (typeof DDT_DOCUMENT_TYPES)[number];

export const DDT_DOCUMENT_TYPE_LABELS: Record<DdtDocumentType, string> = {
  inbound: "Ingresso (carico)",
  outbound: "Uscita (scarico)",
};

export const DDT_STATUSES = [
  "imported",
  "processing",
  "review_required",
  "ready",
  "registered",
  "failed",
  "cancelled",
] as const;
export type DdtStatus = (typeof DDT_STATUSES)[number];

export const DDT_STATUS_LABELS: Record<DdtStatus, string> = {
  imported: "Importato",
  processing: "In elaborazione",
  review_required: "Da verificare",
  ready: "Pronto per registrazione",
  registered: "Registrato",
  failed: "Errore",
  cancelled: "Annullato",
};

export const DDT_OCR_STATUSES = [
  "pending",
  "native_text",
  "ocr",
  "manual",
  "failed",
  "skipped",
] as const;
export type DdtOcrStatus = (typeof DDT_OCR_STATUSES)[number];

export const DDT_LINE_SOURCES = [
  "pdf_text",
  "ocr",
  "manual",
] as const;
export type DdtLineSource = (typeof DDT_LINE_SOURCES)[number];

export const DDT_LINE_VALIDATION = [
  "ok",
  "warning",
  "error",
  "unchecked",
] as const;
export type DdtLineValidation = (typeof DDT_LINE_VALIDATION)[number];

export const DDT_ALLOWED_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type DdtAllowedMime = (typeof DDT_ALLOWED_MIME)[number];

export const DDT_FIELD_LIMITS = {
  documentNumber: 64,
  counterpartyName: 200,
  orderReference: 120,
  notes: 4000,
  errorMessage: 2000,
  lineCode: 64,
  lineDescription: 500,
  unitRaw: 32,
  search: 100,
  relativePath: 500,
  sha256: 64,
} as const;

export const DDT_PAGE_SIZE_DEFAULT = 25;
export const DDT_PAGE_SIZE_MAX = 100;
export const DDT_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const DDT_MAX_PAGES = 40;
export const DDT_MAX_BATCH_FILES = 20;

export type DdtDocumentDto = {
  id: string;
  documentType: DdtDocumentType;
  documentNumber: string | null;
  documentDate: string | null;
  counterpartyName: string | null;
  counterpartyPartyId: string | null;
  orderReference: string | null;
  /** Percorso relativo sicuro sotto userData (mai assoluto). */
  originalRelativePath: string;
  originalFileName: string;
  mimeType: DdtAllowedMime;
  contentSha256: string;
  byteSize: number;
  pageCount: number | null;
  status: DdtStatus;
  ocrStatus: DdtOcrStatus;
  documentKey: string | null;
  notes: string | null;
  lastError: string | null;
  importedAt: string;
  processedAt: string | null;
  registeredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DdtLineDto = {
  id: string;
  documentId: string;
  lineNumber: number;
  originalCode: string | null;
  originalDescription: string | null;
  articleId: string | null;
  articleCode: string | null;
  articleDescription: string | null;
  /** Unità catalogo dell’articolo associato (se presente). */
  articleUnit: ArticleUnitId | null;
  quantityRaw: string | null;
  quantityMilli: number | null;
  unitRaw: string | null;
  unitNormalized: ArticleUnitId | null;
  source: DdtLineSource;
  confidence: number | null;
  warnings: string[];
  validationStatus: DdtLineValidation;
  pageNumber: number | null;
  stockMovementId: string | null;
};

export type DdtAssociationSummary = {
  totalLines: number;
  linked: number;
  missing: number;
  conflicts: number;
  invalid: number;
};

export type DdtQuantityParseResult = {
  quantityMilli: number | null;
  ambiguous: boolean;
  interpretedAs:
    | "plain"
    | "italian_decimal"
    | "thousands"
    | "dot_decimal"
    | null;
  warning: string | null;
};

export type DdtMissingArticleDraft = {
  lineId: string;
  code: string;
  description: string;
  unit: ArticleUnitId;
};

export type DdtCreateMissingArticlesInput = {
  id: string;
  drafts?: DdtMissingArticleDraft[];
};

export type DdtProcessingDto = {
  id: string;
  documentId: string;
  attempt: number;
  strategy: "native_text" | "ocr" | "manual_parse";
  outcome: "success" | "partial" | "failed";
  parserVersion: string;
  message: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type DdtDashboardDto = {
  imported: number;
  reviewRequired: number;
  ready: number;
  registered: number;
  failed: number;
  recent: DdtDocumentDto[];
};

export type DdtListQuery = {
  search: string;
  status: DdtStatus | "all";
  documentType: DdtDocumentType | "all";
  dateFrom: string | null;
  dateTo: string | null;
  page: number;
  pageSize: number;
};

export type DdtListResult = {
  items: DdtDocumentDto[];
  total: number;
  page: number;
  pageSize: number;
};

export type DdtDetailDto = {
  document: DdtDocumentDto;
  lines: DdtLineDto[];
  processings: DdtProcessingDto[];
};

export type DdtImportResult =
  | { status: "imported"; document: DdtDocumentDto; duplicateOfId?: undefined }
  | { status: "duplicate"; document: DdtDocumentDto; duplicateOfId: string }
  | { status: "cancelled" };

export type DdtImportBatchResult = {
  results: DdtImportResult[];
};

export type DdtLineUpdateInput = {
  id: string;
  originalCode: string | null;
  originalDescription: string | null;
  articleId: string | null;
  quantityRaw: string | null;
  unitNormalized: ArticleUnitId | null;
};

export type DdtDocumentUpdateInput = {
  id: string;
  documentType: DdtDocumentType;
  documentNumber: string | null;
  documentDate: string | null;
  counterpartyName: string | null;
  counterpartyPartyId: string | null;
  orderReference: string | null;
  notes: string | null;
  lines: DdtLineUpdateInput[];
};

export const DDT_PARSER_VERSION = "1.1.0";

const STATUS_SET = new Set<string>(DDT_STATUSES);
const TYPE_SET = new Set<string>(DDT_DOCUMENT_TYPES);

/** Allowed transitions (explicit state machine). */
export const DDT_ALLOWED_TRANSITIONS: Record<DdtStatus, readonly DdtStatus[]> = {
  imported: ["processing", "cancelled", "failed"],
  processing: ["review_required", "ready", "failed"],
  review_required: ["ready", "processing", "cancelled", "failed"],
  ready: ["registered", "review_required", "cancelled", "failed"],
  registered: [],
  failed: ["processing", "cancelled", "review_required"],
  cancelled: [],
};

export function canTransitionDdtStatus(
  from: DdtStatus,
  to: DdtStatus,
): boolean {
  return DDT_ALLOWED_TRANSITIONS[from].includes(to);
}

export function isDdtStatus(value: unknown): value is DdtStatus {
  return typeof value === "string" && STATUS_SET.has(value);
}

export function isDdtDocumentType(value: unknown): value is DdtDocumentType {
  return typeof value === "string" && TYPE_SET.has(value);
}

export function normalizeDdtDocumentNumber(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Chiave documentale normalizzata per possibili duplicati logici
 * (non prova assoluta: collisioni → revisione).
 */
export function buildDdtDocumentKey(input: {
  documentType: DdtDocumentType;
  documentNumber: string | null;
  documentDate: string | null;
  counterpartyName: string | null;
}): string | null {
  const number = input.documentNumber
    ? normalizeDdtDocumentNumber(input.documentNumber)
    : "";
  const date = input.documentDate?.trim() ?? "";
  const party = (input.counterpartyName ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
  if (!number || !date) {
    return null;
  }
  return `${input.documentType}|${number}|${date}|${party}`;
}

const UNIT_ALIASES: Record<string, ArticleUnitId> = {
  PZ: "pcs",
  PZx: "pcs",
  PCS: "pcs",
  PEZZI: "pcs",
  NR: "pcs",
  N: "pcs",
  KG: "kg",
  KGS: "kg",
  G: "g",
  GR: "g",
  L: "l",
  LT: "l",
  LITRI: "l",
  M: "m",
  MT: "m",
  MQ: "m2",
  M2: "m2",
};

export function normalizeUnitAlias(raw: string | null): ArticleUnitId | null {
  if (!raw) {
    return null;
  }
  const key = raw.trim().toUpperCase().replace(/\./g, "");
  if ((ARTICLE_UNIT_IDS as readonly string[]).includes(key.toLowerCase())) {
    return key.toLowerCase() as ArticleUnitId;
  }
  return UNIT_ALIASES[key] ?? null;
}

/**
 * Normalizza quantità DDT (contesto documentale italiano).
 * - virgola → decimale italiano (`18,500` → 18.5; eventuali punti = migliaia)
 * - `1.250` / `2.500` (gruppi da 3 dopo il punto) → migliaia
 * - `1.25` / `1.5` (1–2 decimali) → decimale con punto
 * Formati non affidabili → ambiguous + quantityMilli null.
 */
export function parseDdtQuantityDetailed(
  raw: string | null,
  unit: ArticleUnitId | null,
): DdtQuantityParseResult {
  if (!raw || !unit) {
    return {
      quantityMilli: null,
      ambiguous: false,
      interpretedAs: null,
      warning: null,
    };
  }
  const cleaned = raw.trim().replace(/\s/g, "");
  if (!cleaned) {
    return {
      quantityMilli: null,
      ambiguous: false,
      interpretedAs: null,
      warning: null,
    };
  }

  let normalized: string;
  let interpretedAs: DdtQuantityParseResult["interpretedAs"];
  let warning: string | null = null;
  const ambiguous = false;

  if (cleaned.includes(",")) {
    // Italiano: 1.234,560 oppure 18,500
    if (!/^\d{1,3}(\.\d{3})*,\d{1,3}$|^\d+,\d{1,3}$/.test(cleaned)) {
      return {
        quantityMilli: null,
        ambiguous: true,
        interpretedAs: null,
        warning: `Quantità ambigua: verificare ${raw}`,
      };
    }
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
    interpretedAs = "italian_decimal";
  } else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    // Separatore migliaia italiano tipico dei DDT (i decimali usano la virgola).
    const asThousands = cleaned.replace(/\./g, "");
    normalized = asThousands;
    interpretedAs = "thousands";
    warning = `Quantità interpretata con separatore migliaia (${cleaned} → ${asThousands}). Correggi se non corretto.`;
  } else if (/^\d+\.\d{1,2}$/.test(cleaned)) {
    normalized = cleaned;
    interpretedAs = "dot_decimal";
  } else if (/^\d+$/.test(cleaned)) {
    normalized = cleaned;
    interpretedAs = "plain";
  } else if (/^\d+\.\d{3,}$/.test(cleaned)) {
    // Es. 12.3456: non è un raggruppamento migliaia affidabile.
    return {
      quantityMilli: null,
      ambiguous: true,
      interpretedAs: null,
      warning: `Quantità ambigua (formato non standard): verificare ${raw}`,
    };
  } else {
    return {
      quantityMilli: null,
      ambiguous: true,
      interpretedAs: null,
      warning: `Quantità ambigua o non valida: ${raw}`,
    };
  }

  try {
    const quantityMilli = parseStockQuantityToMilli(normalized, unit);
    return { quantityMilli, ambiguous, interpretedAs, warning };
  } catch {
    return {
      quantityMilli: null,
      ambiguous: false,
      interpretedAs,
      warning: `Quantità non interpretabile per unità ${unit}: ${raw}`,
    };
  }
}

export function parseDdtQuantityRaw(
  raw: string | null,
  unit: ArticleUnitId | null,
): number | null {
  return parseDdtQuantityDetailed(raw, unit).quantityMilli;
}

export function summarizeDdtAssociation(
  lines: DdtLineDto[],
): DdtAssociationSummary {
  let linked = 0;
  let missing = 0;
  let conflicts = 0;
  let invalid = 0;
  for (const line of lines) {
    if (line.articleId) {
      linked += 1;
    } else {
      missing += 1;
    }
    if (
      line.articleId &&
      line.unitNormalized &&
      line.articleUnit &&
      line.unitNormalized !== line.articleUnit
    ) {
      conflicts += 1;
    }
    const qtyBad = line.quantityMilli === null || line.quantityMilli <= 0;
    const unitBad = !line.unitNormalized;
    const flagged =
      line.validationStatus === "error" ||
      line.warnings.some((w) => /ambigua|non interpretabile|non valida/i.test(w));
    if (qtyBad || unitBad || (flagged && line.articleId)) {
      invalid += 1;
    }
  }
  return {
    totalLines: lines.length,
    linked,
    missing,
    conflicts,
    invalid,
  };
}

export function ddtLineAssociationLabel(line: DdtLineDto): string {
  if (line.articleId && line.articleCode) {
    if (
      line.unitNormalized &&
      line.articleUnit &&
      line.unitNormalized !== line.articleUnit
    ) {
      return "associato (conflitto unità)";
    }
    if (line.quantityMilli === null) {
      return "associato (quantità da verificare)";
    }
    return "associato";
  }
  if (line.originalCode) {
    return "mancante in catalogo";
  }
  return "non associato";
}

/** Bozze precompilate per creazione massiva (una per codice normalizzato). */
export function buildMissingArticleDrafts(
  lines: DdtLineDto[],
): DdtMissingArticleDraft[] {
  const drafts: DdtMissingArticleDraft[] = [];
  const seenCodes = new Set<string>();
  for (const line of lines) {
    if (line.articleId) {
      continue;
    }
    if (!line.originalCode || !line.unitNormalized) {
      continue;
    }
    const code = normalizeArticleCode(line.originalCode);
    if (seenCodes.has(code)) {
      continue;
    }
    seenCodes.add(code);
    drafts.push({
      lineId: line.id,
      code,
      description:
        line.originalDescription?.trim() || `Articolo DDT ${code}`,
      unit: line.unitNormalized,
    });
  }
  return drafts;
}

function requireObject(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`${label} deve essere un oggetto.`);
  }
  return input as Record<string, unknown>;
}

function optString(
  record: Record<string, unknown>,
  key: string,
  max: number,
): string | null {
  if (!(key in record) || record[key] === null) {
    return null;
  }
  if (typeof record[key] !== "string") {
    throw new Error(`Campo "${key}" non valido.`);
  }
  const value = record[key].trim();
  if (!value) {
    return null;
  }
  if (value.length > max) {
    throw new Error(`Campo "${key}" troppo lungo.`);
  }
  return value;
}

function optDate(record: Record<string, unknown>, key: string): string | null {
  const value = optString(record, key, 10);
  if (!value) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Data "${key}" non valida (atteso YYYY-MM-DD).`);
  }
  return value;
}

export function parseDdtListQuery(input: unknown): DdtListQuery {
  const record =
    input === undefined || input === null
      ? {}
      : requireObject(input, "Query DDT");
  const search =
    typeof record.search === "string"
      ? record.search.trim().slice(0, DDT_FIELD_LIMITS.search)
      : "";
  const status =
    record.status === undefined || record.status === "all"
      ? "all"
      : isDdtStatus(record.status)
        ? record.status
        : (() => {
            throw new Error('Filtro "status" non valido.');
          })();
  const documentType =
    record.documentType === undefined || record.documentType === "all"
      ? "all"
      : isDdtDocumentType(record.documentType)
        ? record.documentType
        : (() => {
            throw new Error('Filtro "documentType" non valido.');
          })();
  const page =
    typeof record.page === "number" && Number.isInteger(record.page) && record.page >= 1
      ? record.page
      : 1;
  const pageSize =
    typeof record.pageSize === "number" &&
    Number.isInteger(record.pageSize) &&
    record.pageSize >= 1 &&
    record.pageSize <= DDT_PAGE_SIZE_MAX
      ? record.pageSize
      : DDT_PAGE_SIZE_DEFAULT;
  return {
    search,
    status,
    documentType,
    dateFrom: optDate(record, "dateFrom"),
    dateTo: optDate(record, "dateTo"),
    page,
    pageSize,
  };
}

export function parseDdtDocumentUpdateInput(
  input: unknown,
): DdtDocumentUpdateInput {
  const record = requireObject(input, "Aggiornamento DDT");
  if (typeof record.id !== "string" || !record.id.trim()) {
    throw new Error("ID documento obbligatorio.");
  }
  if (!isDdtDocumentType(record.documentType)) {
    throw new Error("Tipo documento non valido.");
  }
  if (!Array.isArray(record.lines)) {
    throw new Error("Le righe devono essere un array.");
  }
  const lines: DdtLineUpdateInput[] = record.lines.map((line, index) => {
    if (typeof line !== "object" || line === null || Array.isArray(line)) {
      throw new Error(`Riga ${index + 1} non valida.`);
    }
    const row = line as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id.trim()) {
      throw new Error(`Riga ${index + 1}: id obbligatorio.`);
    }
    let unitNormalized: ArticleUnitId | null = null;
    if (row.unitNormalized !== null && row.unitNormalized !== undefined) {
      if (
        typeof row.unitNormalized !== "string" ||
        !(ARTICLE_UNIT_IDS as readonly string[]).includes(row.unitNormalized)
      ) {
        throw new Error(`Riga ${index + 1}: unità non valida.`);
      }
      unitNormalized = row.unitNormalized as ArticleUnitId;
    }
    return {
      id: row.id,
      originalCode: optString(row, "originalCode", DDT_FIELD_LIMITS.lineCode),
      originalDescription: optString(
        row,
        "originalDescription",
        DDT_FIELD_LIMITS.lineDescription,
      ),
      articleId:
        row.articleId === null || row.articleId === undefined
          ? null
          : typeof row.articleId === "string"
            ? row.articleId
            : (() => {
                throw new Error(`Riga ${index + 1}: articleId non valido.`);
              })(),
      quantityRaw: optString(row, "quantityRaw", 40),
      unitNormalized,
    };
  });

  return {
    id: record.id.trim(),
    documentType: record.documentType,
    documentNumber: optString(
      record,
      "documentNumber",
      DDT_FIELD_LIMITS.documentNumber,
    ),
    documentDate: optDate(record, "documentDate"),
    counterpartyName: optString(
      record,
      "counterpartyName",
      DDT_FIELD_LIMITS.counterpartyName,
    ),
    counterpartyPartyId:
      record.counterpartyPartyId === null ||
      record.counterpartyPartyId === undefined
        ? null
        : typeof record.counterpartyPartyId === "string"
          ? record.counterpartyPartyId
          : (() => {
              throw new Error("counterpartyPartyId non valido.");
            })(),
    orderReference: optString(
      record,
      "orderReference",
      DDT_FIELD_LIMITS.orderReference,
    ),
    notes: optString(record, "notes", DDT_FIELD_LIMITS.notes),
    lines,
  };
}

export function parseDdtId(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("ID DDT non valido.");
  }
  return input.trim();
}

export type DdtBlockingIssue = {
  code: string;
  message: string;
};

export function collectDdtRegistrationIssues(
  document: DdtDocumentDto,
  lines: DdtLineDto[],
): { blocking: DdtBlockingIssue[]; warnings: DdtBlockingIssue[] } {
  const blocking: DdtBlockingIssue[] = [];
  const warnings: DdtBlockingIssue[] = [];

  if (document.status === "registered") {
    blocking.push({
      code: "already_registered",
      message: "Il documento è già registrato.",
    });
  }
  if (document.status === "cancelled") {
    blocking.push({
      code: "cancelled",
      message: "Il documento è annullato.",
    });
  }
  if (!document.documentNumber) {
    blocking.push({
      code: "missing_number",
      message: "Numero DDT obbligatorio.",
    });
  }
  if (!document.documentDate) {
    blocking.push({
      code: "missing_date",
      message: "Data documento obbligatoria.",
    });
  }
  if (lines.length === 0) {
    blocking.push({
      code: "no_lines",
      message: "Serve almeno una riga.",
    });
  }

  const validLines = lines.filter((line) => line.validationStatus !== "error");
  if (lines.length > 0 && validLines.length === 0) {
    blocking.push({
      code: "all_lines_invalid",
      message: "Nessuna riga valida per la registrazione.",
    });
  }

  const unlinked = lines.filter((line) => !line.articleId);
  if (unlinked.length > 0) {
    const codes = unlinked
      .map((line) => line.originalCode ?? `#${line.lineNumber}`)
      .slice(0, 12);
    const more =
      unlinked.length > codes.length
        ? ` (+${unlinked.length - codes.length})`
        : "";
    blocking.push({
      code: "unlinked_article",
      message: `${unlinked.length} righe senza articolo associato (${codes.join(", ")}${more}). Usa «Crea gli articoli mancanti» oppure associa singolarmente.`,
    });
  }

  const badQty = lines.filter(
    (line) => line.quantityMilli === null || line.quantityMilli <= 0,
  );
  if (badQty.length > 0) {
    const refs = badQty
      .map((line) => `${line.lineNumber}:${line.quantityRaw ?? "?"}`)
      .slice(0, 8);
    const more =
      badQty.length > refs.length ? ` (+${badQty.length - refs.length})` : "";
    blocking.push({
      code: "bad_quantity",
      message: `${badQty.length} quantità non valide o ambigue (${refs.join(", ")}${more}). Correggi prima della registrazione.`,
    });
  }

  const badUnit = lines.filter((line) => !line.unitNormalized);
  if (badUnit.length > 0) {
    blocking.push({
      code: "bad_unit",
      message: `${badUnit.length} righe senza unità normalizzata.`,
    });
  }

  const unitConflicts = lines.filter(
    (line) =>
      line.articleId &&
      line.unitNormalized &&
      line.articleUnit &&
      line.unitNormalized !== line.articleUnit,
  );
  if (unitConflicts.length > 0) {
    blocking.push({
      code: "unit_conflict",
      message: `${unitConflicts.length} righe con unità incompatibile rispetto al catalogo.`,
    });
  }

  const warningLines = lines.filter(
    (line) => line.validationStatus === "warning" && line.warnings.length > 0,
  );
  if (warningLines.length > 0) {
    warnings.push({
      code: "line_warning",
      message: `${warningLines.length} righe con avvisi (dettaglio nelle singole righe).`,
    });
  }

  if (!document.counterpartyName) {
    warnings.push({
      code: "missing_counterparty",
      message: "Controparte non indicata.",
    });
  }

  return { blocking, warnings };
}

export function parseDdtCreateMissingArticlesInput(
  input: unknown,
): DdtCreateMissingArticlesInput {
  const record = requireObject(input, "Creazione articoli DDT");
  if (typeof record.id !== "string" || !record.id.trim()) {
    throw new Error("ID documento obbligatorio.");
  }
  let drafts: DdtMissingArticleDraft[] | undefined;
  if (record.drafts !== undefined && record.drafts !== null) {
    if (!Array.isArray(record.drafts)) {
      throw new Error("drafts deve essere un array.");
    }
    drafts = record.drafts.map((item, index) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        throw new Error(`Bozza ${index + 1} non valida.`);
      }
      const row = item as Record<string, unknown>;
      if (typeof row.lineId !== "string" || !row.lineId.trim()) {
        throw new Error(`Bozza ${index + 1}: lineId obbligatorio.`);
      }
      if (typeof row.code !== "string" || !row.code.trim()) {
        throw new Error(`Bozza ${index + 1}: codice obbligatorio.`);
      }
      if (typeof row.description !== "string" || !row.description.trim()) {
        throw new Error(`Bozza ${index + 1}: descrizione obbligatoria.`);
      }
      if (
        typeof row.unit !== "string" ||
        !(ARTICLE_UNIT_IDS as readonly string[]).includes(row.unit)
      ) {
        throw new Error(`Bozza ${index + 1}: unità non valida.`);
      }
      return {
        lineId: row.lineId.trim(),
        code: row.code.trim(),
        description: row.description.trim(),
        unit: row.unit as ArticleUnitId,
      };
    });
  }
  return { id: record.id.trim(), drafts };
}
