/**
 * Deterministic Italian DDT field/line parser from plain text.
 * No invented confidence scores — semantic certainty is separate from OCR.
 */

import {
  DDT_PARSER_VERSION,
  buildDdtDocumentKey,
  normalizeUnitAlias,
  parseDdtQuantityDetailed,
  type DdtDocumentType,
  type DdtLineSource,
  type DdtLineValidation,
} from "../../shared/ddt.ts";
import type { ArticleUnitId } from "../../shared/articles.ts";
import { ARTICLE_UNIT_IDS } from "../../shared/articles.ts";

export type ParsedDdtLine = {
  lineNumber: number;
  originalCode: string | null;
  originalDescription: string | null;
  quantityRaw: string | null;
  quantityMilli: number | null;
  unitRaw: string | null;
  unitNormalized: ArticleUnitId | null;
  source: DdtLineSource;
  confidence: number | null;
  warnings: string[];
  validationStatus: DdtLineValidation;
  pageNumber: number | null;
};

export type ParsedDdtDocument = {
  documentNumber: string | null;
  documentDate: string | null;
  counterpartyName: string | null;
  orderReference: string | null;
  documentKey: string | null;
  lines: ParsedDdtLine[];
  warnings: string[];
  parserVersion: string;
};

const HEADER_CODE = /^(cod(?:ice|\.?)\s*(?:art(?:icolo|\.?)?)?|articolo|cod\.?\s*art\.?)$/i;
const HEADER_DESC = /^(descrizione|descri(?:zione)?|articolo\s*\/\s*descrizione)$/i;
const HEADER_QTY = /^(q\.?\s*t[aà]|quantit[aà]|qty|qta)$/i;
const HEADER_UNIT = /^(u\.?\s*m\.?|unit[aà](?:\s*di\s*misura)?|um)$/i;

const SECTION_LABEL_ONLY =
  /^(mittente|fornitore|destinatario|destinatario\s*\/\s*cliente|mittente\s*\/\s*fornitore|fornitore\s*\/\s*mittente|beni\s+trasportati|dati\s+del\s+trasporto|note|documento\s+di\s+trasporto)(\s*\/\s*(mittente|fornitore|destinatario))?$/i;

const FOOTER_OR_NOISE =
  /^(tel\.|fax|p\.?\s*iva|cod\.?\s*fisc|pagina\s+\d|firma|trasporto\s+a\s+cura|trasporto\s+a\s+mezzo|colli\b|peso\b|data\/?ora|note\b|_{3,}|fac-simile|documento\s+fittizio|documento\s+dimostrativo)/i;

const UNIT_TOKEN = new RegExp(
  `^(${ARTICLE_UNIT_IDS.join("|")}|pz|pzs|nr|n|lt|litri|mq)$`,
  "i",
);

const QTY_TOKEN = /^\d{1,6}(?:[.,]\d{1,3})?$/;

function parseItalianDate(raw: string): string | null {
  const iso = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  const dmy = raw.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/);
  if (!dmy) {
    return null;
  }
  const day = dmy[1].padStart(2, "0");
  const month = dmy[2].padStart(2, "0");
  let year = dmy[3];
  if (year.length === 2) {
    year = Number(year) >= 70 ? `19${year}` : `20${year}`;
  }
  return `${year}-${month}-${day}`;
}

function extractField(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function splitTableRows(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function looksLikeHeader(cells: string[]): boolean {
  const joined = cells.map((c) => c.toLowerCase().trim());
  const hasCode = joined.some((c) => HEADER_CODE.test(c));
  const hasQty = joined.some((c) => HEADER_QTY.test(c));
  const hasUnit = joined.some((c) => HEADER_UNIT.test(c));
  const hasDesc = joined.some((c) => HEADER_DESC.test(c));
  // Single-line header without separators: "Codice Descrizione U.M. Quantità"
  if (cells.length === 1) {
    const one = cells[0].toLowerCase();
    return (
      /codice/.test(one) &&
      /descrit/.test(one) &&
      (/quantit/.test(one) || /q\.?\s*t/.test(one))
    );
  }
  return hasCode || hasQty || hasUnit || hasDesc;
}

function tokenizeCells(line: string): string[] {
  if (line.includes("\t")) {
    return line.split("\t").map((c) => c.trim()).filter(Boolean);
  }
  if (line.includes("|")) {
    return line.split("|").map((c) => c.trim()).filter(Boolean);
  }
  return line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
}

function isSectionLabel(line: string): boolean {
  return SECTION_LABEL_ONLY.test(line.trim());
}

function isNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (FOOTER_OR_NOISE.test(trimmed)) {
    return true;
  }
  if (/^p\.?\s*iva\s*:/i.test(trimmed)) {
    return true;
  }
  if (/^email\s*:/i.test(trimmed)) {
    return true;
  }
  if (/via\s+/i.test(trimmed) && /\d{5}/.test(trimmed)) {
    return true;
  }
  return false;
}

function normalizeUnitToken(raw: string | null): ArticleUnitId | null {
  if (!raw) {
    return null;
  }
  return normalizeUnitAlias(raw);
}

/**
 * Parse a product row that may use either:
 *   CODE  DESC  QTY  UNIT
 *   CODE  DESC  UNIT  QTY
 * or a single-space row: "ART-001 Viti ... pcs 250"
 */
function parseProductRow(
  raw: string,
  lineNumber: number,
  source: DdtLineSource,
  pageNumber: number | null,
): ParsedDdtLine | null {
  const warnings: string[] = [];
  let cells = tokenizeCells(raw);

  // Fallback for single-space rows: split code + rest, then peel unit/qty from the end.
  if (cells.length < 3) {
    const spaced = raw.trim().split(/\s+/);
    if (spaced.length >= 3) {
      cells = spaced;
    }
  }

  if (cells.length < 2) {
    return null;
  }

  // Reject clear headers mistaken as rows
  if (looksLikeHeader(cells)) {
    return null;
  }
  if (HEADER_CODE.test(cells[0]) || /^(codice|descrizione)$/i.test(cells[0])) {
    return null;
  }

  let originalCode: string | null = cells[0] || null;
  let unitRaw: string | null;
  let quantityRaw: string | null;
  let descriptionParts: string[];

  const last = cells[cells.length - 1];
  const secondLast = cells.length >= 2 ? cells[cells.length - 2] : "";

  if (cells.length >= 3 && UNIT_TOKEN.test(last) && QTY_TOKEN.test(secondLast)) {
    // CODE DESC… QTY UNIT
    unitRaw = last;
    quantityRaw = secondLast;
    descriptionParts = cells.slice(1, -2);
  } else if (
    cells.length >= 3 &&
    QTY_TOKEN.test(last) &&
    UNIT_TOKEN.test(secondLast)
  ) {
    // CODE DESC… UNIT QTY  (common in Italian DDT tables)
    quantityRaw = last;
    unitRaw = secondLast;
    descriptionParts = cells.slice(1, -2);
  } else if (QTY_TOKEN.test(last) && cells.length >= 3) {
    // CODE DESC… QTY  (unit missing)
    quantityRaw = last;
    unitRaw = null;
    descriptionParts = cells.slice(1, -1);
    warnings.push("Unità di misura assente o non riconosciuta.");
  } else if (
    cells.length === 2 &&
    QTY_TOKEN.test(last) &&
    !UNIT_TOKEN.test(cells[0])
  ) {
    quantityRaw = last;
    unitRaw = null;
    originalCode = null;
    descriptionParts = [cells[0]];
    warnings.push("Codice articolo assente.");
  } else {
    // Not a convincing product row
    return null;
  }

  const codeLooksValid =
    originalCode != null &&
    /^[A-Z0-9][A-Z0-9._\-/]{0,31}$/i.test(originalCode) &&
    !/^(cod|descr|q\.?t|u\.?m|quant)/i.test(originalCode);

  if (originalCode && !codeLooksValid) {
    // First cell is likely a description without article code.
    descriptionParts = [originalCode, ...descriptionParts];
    originalCode = null;
    warnings.push("Codice articolo assente.");
  }

  const originalDescription = descriptionParts.join(" ").trim() || null;
  const unitNormalized = normalizeUnitToken(unitRaw);
  if (unitRaw && !unitNormalized) {
    warnings.push(`Unità non riconosciuta: ${unitRaw}`);
  }
  const qtyParsed = parseDdtQuantityDetailed(quantityRaw, unitNormalized);
  const quantityMilli = qtyParsed.quantityMilli;
  if (qtyParsed.warning) {
    warnings.push(qtyParsed.warning);
  } else if (quantityRaw && quantityMilli === null) {
    warnings.push("Quantità non interpretabile.");
  }

  let validationStatus: DdtLineValidation = "ok";
  if (!originalCode || quantityMilli === null || !unitNormalized) {
    validationStatus = warnings.length > 0 ? "warning" : "unchecked";
  }
  if ((quantityMilli === null && quantityRaw) || qtyParsed.ambiguous) {
    validationStatus = "error";
  }

  return {
    lineNumber,
    originalCode,
    originalDescription,
    quantityRaw,
    quantityMilli,
    unitRaw,
    unitNormalized,
    source,
    confidence: null,
    warnings,
    validationStatus,
    pageNumber,
  };
}

function looksLikeDocNumber(value: string): boolean {
  const v = value.trim();
  if (!v || /^(ddt|numero|data|causale|ordine|rif|doc|bolla)$/i.test(v)) {
    return false;
  }
  // Prefer codes with a digit (TEST-2026-001, 12345/A, DDT-2026-001).
  return /\d/.test(v) && /^[A-Z0-9][A-Z0-9\-/]*$/i.test(v);
}

function extractDocumentNumber(text: string, rows: string[]): string | null {
  // Use [ \t] (not \s) so labels on their own line cannot capture the next row
  // (e.g. "DDT" + newline + "Causale").
  const fromPatterns = extractField(text, [
    /(?:n\.?[ \t]*(?:ddt|doc(?:umento)?|bolla)|ddt[ \t]*n\.?|documento[ \t]*n\.?)[ \t]*[:#]?[ \t]*([A-Z0-9][A-Z0-9\-/]*)/i,
    /\bDDT[ \t]+([A-Z0-9][A-Z0-9\-/]{2,})\b/i,
    /numero[ \t]*ddt[ \t]*[:#]?[ \t]*([A-Z0-9][A-Z0-9\-/]*)/i,
    /numero[ \t]*[:#]?[ \t]*([A-Z0-9][A-Z0-9\-/]{3,})/i,
  ]);
  if (fromPatterns && looksLikeDocNumber(fromPatterns)) {
    return fromPatterns;
  }

  // Label/value split across nearby lines: "Numero DDT" then "TEST-2026-001"
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (/numero[ \t]*ddt|ddt[ \t]*n\.?|^numero\b/i.test(row)) {
      const inline = row.match(
        /(?:numero(?:[ \t]*ddt)?|ddt)[ \t]*[:#]?[ \t]*([A-Z0-9][A-Z0-9\-/]{2,})/i,
      );
      if (inline?.[1] && looksLikeDocNumber(inline[1])) {
        return inline[1];
      }
      const glued = row.match(/numero(?:[ \t]*ddt)?([A-Z0-9][A-Z0-9\-/]{2,})/i);
      if (glued?.[1] && looksLikeDocNumber(glued[1])) {
        return glued[1];
      }
      for (const next of rows.slice(i, i + 3)) {
        const value =
          next.match(/\b([A-Z]{2,10}-\d{4}-\d{1,6})\b/i) ??
          next.match(/\b(\d{2,8}[A-Z]?)\b/);
        if (
          value?.[1] &&
          looksLikeDocNumber(value[1]) &&
          !/^\d{1,2}[./]\d{1,2}/.test(next)
        ) {
          return value[1];
        }
      }
    }
  }

  // Standalone document codes common in fac-similes
  const standalone = text.match(/\b((?:DDT|TEST|DOC)-\d{4}-\d{1,6})\b/i);
  return standalone?.[1] ?? null;
}

function extractCounterparty(rows: string[]): string | null {
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!/(fornitore|mittente)/i.test(row)) {
      continue;
    }
    // Skip pure section titles: "MITTENTE / FORNITORE"
    if (isSectionLabel(row)) {
      for (const next of rows.slice(i + 1, i + 4)) {
        if (isSectionLabel(next) || isNoiseLine(next) || looksLikeHeader(tokenizeCells(next))) {
          continue;
        }
        if (/destinatario/i.test(next) && !/s\.?\s*r\.?\s*l/i.test(next)) {
          // "Forniture Demo S.r.l.  DESTINATARIO" — take left company
          const left = next.split(/\s{2,}|\s+(?=<)|(?=DESTINATARIO)/i)[0]?.trim();
          const company = left?.replace(/\s*DESTINATARIO.*$/i, "").trim();
          if (company && company.length >= 3 && !isSectionLabel(company)) {
            return company.replace(/\s+/g, " ").trim();
          }
          continue;
        }
        const firstCol = (next.split(/\s{2,}/)[0] ?? next)
          .replace(/\bDESTINATARIO\b.*$/i, "")
          .trim();
        if (
          firstCol &&
          !isSectionLabel(firstCol) &&
          !isNoiseLine(firstCol) &&
          !/^(via|p\.?\s*iva|email)\b/i.test(firstCol)
        ) {
          return firstCol.replace(/\s+/g, " ").trim();
        }
      }
      continue;
    }

    // "Fornitore: Acme Srl"
    const labeled = row.match(
      /(?:fornitore|mittente)\s*[:#]\s*(.+)$/i,
    );
    if (labeled?.[1]) {
      const value = labeled[1].trim();
      if (!isSectionLabel(value) && value !== "/" && !/^\/\s*fornitore$/i.test(value)) {
        return value.split(/\s{2,}/)[0].trim();
      }
    }
  }

  // Fallback: company-looking token with S.r.l. near the top half
  for (const row of rows.slice(0, Math.min(rows.length, 25))) {
    if (/destinatario/i.test(row) && !/fornitore|mittente/i.test(row)) {
      continue;
    }
    const company = row.match(
      /([A-ZÀ-Ü][A-Za-zÀ-ü0-9 .,&'’-]{2,60}?S\.?\s*r\.?\s*l\.?)/i,
    );
    if (company?.[1] && !/glitch\s+azienda/i.test(company[1])) {
      return company[1].replace(/\s+/g, " ").trim();
    }
  }
  return null;
}

/**
 * Parse extracted plain text into DDT header + lines.
 */
export function parseDdtText(
  text: string,
  options: {
    source: DdtLineSource;
    documentType?: DdtDocumentType;
    pageNumber?: number | null;
  },
): ParsedDdtDocument {
  const warnings: string[] = [];
  const normalized = text.replace(/\u00a0/g, " ");
  const rows = splitTableRows(normalized);

  const documentNumber = extractDocumentNumber(normalized, rows);
  const dateRaw = extractField(normalized, [
    /(?:data\s*(?:doc(?:umento)?|ddt)?)\s*[:#]?\s*([0-9./-]{6,10})/i,
    /\bdel\s+([0-9./-]{6,10})/i,
  ]);
  const documentDate = dateRaw
    ? parseItalianDate(dateRaw)
    : parseItalianDate(normalized);
  const counterpartyName = extractCounterparty(rows);
  const orderReference = extractField(normalized, [
    /(?:rif(?:erimento)?\.?\s*(?:ordine|ord\.?)|ordine\s*n\.?)\s*[:#]?\s*([A-Z0-9\-/]+)/i,
  ]);

  if (!documentNumber) {
    warnings.push("Numero DDT non rilevato automaticamente.");
  }
  if (!documentDate) {
    warnings.push("Data documento non rilevata automaticamente.");
  }
  if (!counterpartyName) {
    warnings.push("Controparte/fornitore non rilevata automaticamente.");
  }

  const lines: ParsedDdtLine[] = [];
  let sawHeader = false;
  let lineNumber = 0;
  let inGoodsSection = false;

  for (const raw of rows) {
    if (/beni\s+trasportati|righe\s+articolo|dettaglio\s+merci/i.test(raw)) {
      inGoodsSection = true;
      continue;
    }
    if (/dati\s+del\s+trasporto|^note$|firma\s+/i.test(raw)) {
      inGoodsSection = false;
      // Stop consuming product rows after goods section ends
      if (lines.length > 0) {
        break;
      }
      continue;
    }
    if (isSectionLabel(raw) || isNoiseLine(raw)) {
      continue;
    }

    const cells = tokenizeCells(raw);
    if (cells.length === 0) {
      continue;
    }
    if (looksLikeHeader(cells) || looksLikeHeader([raw])) {
      sawHeader = true;
      inGoodsSection = true;
      continue;
    }

    const parsed = parseProductRow(
      raw,
      lineNumber + 1,
      options.source,
      options.pageNumber ?? null,
    );
    if (!parsed) {
      continue;
    }

    // Before header/goods section, only accept strong ART-* style rows
    if (!sawHeader && !inGoodsSection) {
      if (!/^ART[-\s]?\d+/i.test(parsed.originalCode ?? "")) {
        continue;
      }
    }

    lineNumber += 1;
    lines.push({ ...parsed, lineNumber });
  }

  if (lines.length === 0) {
    warnings.push(
      "Nessuna riga articolo riconosciuta: compilazione manuale richiesta.",
    );
  }

  const documentType = options.documentType ?? "inbound";
  const documentKey = buildDdtDocumentKey({
    documentType,
    documentNumber,
    documentDate,
    counterpartyName,
  });

  return {
    documentNumber,
    documentDate,
    counterpartyName,
    orderReference,
    documentKey,
    lines,
    warnings,
    parserVersion: DDT_PARSER_VERSION,
  };
}
