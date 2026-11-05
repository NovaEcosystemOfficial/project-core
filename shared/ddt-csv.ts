import {
  DDT_DOCUMENT_TYPE_LABELS,
  DDT_STATUS_LABELS,
  type DdtDocumentDto,
  type DdtLineDto,
} from "./ddt.ts";
import { escapeCsvField, PARTIES_CSV_BOM, PARTIES_CSV_EOL, PARTIES_CSV_SEPARATOR } from "./parties-csv.ts";
import { milliToQuantityString } from "./quotes-money.ts";

export const DDT_CSV_BOM = PARTIES_CSV_BOM;
export const DDT_CSV_SEPARATOR = PARTIES_CSV_SEPARATOR;
export const DDT_CSV_EOL = PARTIES_CSV_EOL;

export const DDT_DOCUMENTS_CSV_HEADERS = [
  "ID",
  "Tipo",
  "Numero",
  "Data",
  "Controparte",
  "Riferimento ordine",
  "Stato",
  "OCR",
  "File originale",
  "SHA-256",
  "Importato",
  "Registrato",
  "Note",
] as const;

export const DDT_LINES_CSV_HEADERS = [
  "Documento ID",
  "Numero documento",
  "Riga",
  "Codice originale",
  "Descrizione originale",
  "Articolo ID",
  "Quantità",
  "Unità",
  "Fonte",
  "Validazione",
  "Avvisi",
  "Movimento magazzino",
] as const;

export type DdtCsvExportResult =
  | { status: "completed"; fileName: string; rowCount: number }
  | { status: "cancelled" }
  | { status: "empty" };

export type DdtOpenOriginalResult =
  | { status: "opened" }
  | { status: "missing"; message: string }
  | { status: "error"; message: string };

function cell(value: string | null | undefined): string {
  return value ?? "";
}

export function ddtDocumentToCsvRow(doc: DdtDocumentDto): string[] {
  return [
    doc.id,
    DDT_DOCUMENT_TYPE_LABELS[doc.documentType],
    cell(doc.documentNumber),
    cell(doc.documentDate),
    cell(doc.counterpartyName),
    cell(doc.orderReference),
    DDT_STATUS_LABELS[doc.status],
    doc.ocrStatus,
    doc.originalFileName,
    doc.contentSha256,
    doc.importedAt,
    cell(doc.registeredAt),
    cell(doc.notes),
  ];
}

export function ddtLineToCsvRow(
  doc: DdtDocumentDto,
  line: DdtLineDto,
): string[] {
  return [
    doc.id,
    cell(doc.documentNumber),
    String(line.lineNumber),
    cell(line.originalCode),
    cell(line.originalDescription),
    cell(line.articleId),
    line.quantityMilli !== null
      ? milliToQuantityString(line.quantityMilli)
      : cell(line.quantityRaw),
    cell(line.unitNormalized ?? line.unitRaw),
    line.source,
    line.validationStatus,
    line.warnings.join(" | "),
    cell(line.stockMovementId),
  ];
}

function serializeRows(headers: readonly string[], rows: string[][]): string {
  const lines = [
    headers.map((h) => escapeCsvField(h, DDT_CSV_SEPARATOR)).join(DDT_CSV_SEPARATOR),
    ...rows.map((row) =>
      row.map((field) => escapeCsvField(field, DDT_CSV_SEPARATOR)).join(DDT_CSV_SEPARATOR),
    ),
  ];
  return DDT_CSV_BOM + lines.join(DDT_CSV_EOL) + DDT_CSV_EOL;
}

export function serializeDdtDocumentsCsv(docs: DdtDocumentDto[]): string {
  return serializeRows(
    DDT_DOCUMENTS_CSV_HEADERS,
    docs.map(ddtDocumentToCsvRow),
  );
}

export function serializeDdtLinesCsv(
  entries: Array<{ document: DdtDocumentDto; line: DdtLineDto }>,
): string {
  return serializeRows(
    DDT_LINES_CSV_HEADERS,
    entries.map(({ document, line }) => ddtLineToCsvRow(document, line)),
  );
}
