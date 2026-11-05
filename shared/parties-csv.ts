import type { PartyDto } from "./parties.ts";

/** Excel-friendly Italian CSV: UTF-8 BOM, semicolon separator, CRLF. */
export const PARTIES_CSV_BOM = "\uFEFF";
export const PARTIES_CSV_SEPARATOR = ";";
export const PARTIES_CSV_EOL = "\r\n";

export const PARTIES_CSV_HEADERS = [
  "ID",
  "Nome / Ragione sociale",
  "Cliente",
  "Fornitore",
  "Email",
  "Telefono",
  "Indirizzo",
  "Codice fiscale",
  "Partita IVA",
  "Note",
  "Stato",
  "Data creazione",
  "Ultima modifica",
] as const;

export function escapeCsvField(
  value: string,
  separator = PARTIES_CSV_SEPARATOR,
): string {
  if (
    value.includes('"') ||
    value.includes(separator) ||
    value.includes("\r") ||
    value.includes("\n")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatYesNo(value: boolean): string {
  return value ? "Sì" : "No";
}

function formatStatus(status: PartyDto["status"]): string {
  return status === "archived" ? "Archiviata" : "Attiva";
}

function cell(value: string | null | undefined): string {
  return value ?? "";
}

export function partyToCsvRow(party: PartyDto): string[] {
  return [
    party.id,
    party.displayName,
    formatYesNo(party.isCustomer),
    formatYesNo(party.isSupplier),
    cell(party.email),
    cell(party.phone),
    cell(party.address),
    cell(party.taxCode),
    cell(party.vatNumber),
    cell(party.notes),
    formatStatus(party.status),
    party.createdAt,
    party.updatedAt,
  ];
}

export function serializePartiesCsv(parties: PartyDto[]): string {
  const lines: string[] = [];
  lines.push(
    PARTIES_CSV_HEADERS.map((header) => escapeCsvField(header)).join(
      PARTIES_CSV_SEPARATOR,
    ),
  );
  for (const party of parties) {
    lines.push(
      partyToCsvRow(party)
        .map((field) => escapeCsvField(field))
        .join(PARTIES_CSV_SEPARATOR),
    );
  }
  return PARTIES_CSV_BOM + lines.join(PARTIES_CSV_EOL) + PARTIES_CSV_EOL;
}

/**
 * Minimal semicolon CSV parser for tests (handles quoted fields and "" escapes).
 */
export function parseSemicolonCsv(content: string): string[][] {
  let text = content;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  // Normalize to LF for split, keep field-internal newlines via quote parsing.
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        continue;
      }
      field += ch;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ";") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\r") {
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
