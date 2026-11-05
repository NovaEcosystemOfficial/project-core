import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import type Database from "better-sqlite3";
import { runMigrations } from "../electron/db/migrations.ts";
import { AppError, toIpcThrownError } from "../electron/errors/app-error.ts";
import {
  insertParty,
  listParties,
  listPartiesForExport,
  setPartyStatus,
} from "../electron/repositories/parties-repository.ts";
import {
  PARTIES_CSV_BOM,
  PARTIES_CSV_EOL,
  PARTIES_CSV_HEADERS,
  PARTIES_CSV_SEPARATOR,
  parseSemicolonCsv,
  serializePartiesCsv,
} from "../shared/parties-csv.ts";
import {
  parsePartyExportFilter,
  PARTY_EXPORT_MAX_ROWS,
  type PartiesCsvExportResult,
} from "../shared/parties-csv-export.ts";
import type { PartyDto, PartyWriteFields } from "../shared/parties.ts";
import { tryParseDesktopErrorPayload } from "../shared/errors.ts";

const require = createRequire(import.meta.url);
type BetterSqlite3Constructor = new (filename: string) => Database;
const BetterSqlite3 = require("better-sqlite3") as BetterSqlite3Constructor;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function fields(
  overrides: Partial<PartyWriteFields> & { displayName: string },
): PartyWriteFields {
  return {
    isCustomer: true,
    isSupplier: false,
    email: null,
    phone: null,
    address: null,
    taxCode: null,
    vatNumber: null,
    notes: null,
    ...overrides,
  };
}

function sampleParty(overrides: Partial<PartyDto> = {}): PartyDto {
  return {
    id: "id-1",
    displayName: "Acme",
    isCustomer: true,
    isSupplier: false,
    email: null,
    phone: null,
    address: null,
    taxCode: null,
    vatNumber: null,
    notes: null,
    status: "active",
    createdAt: "2026-01-01 10:00:00",
    updatedAt: "2026-01-02 11:00:00",
    ...overrides,
  };
}

function testHeadersOrderAndBom(): void {
  const csv = serializePartiesCsv([]);
  assert(csv.startsWith(PARTIES_CSV_BOM), "must start with UTF-8 BOM");
  assert(csv.includes(PARTIES_CSV_EOL), "must use CRLF terminators");
  assert(
    !csv.slice(1).includes("\n\n"),
    "empty export still has trailing CRLF after header",
  );

  const rows = parseSemicolonCsv(csv);
  assert(rows.length === 1, "header-only CSV");
  assert(
    rows[0]?.join("|") === [...PARTIES_CSV_HEADERS].join("|"),
    "headers order must match contract",
  );
  assert(
    PARTIES_CSV_HEADERS.length === 13,
    "expected 13 columns aligned to PartyDto",
  );
  console.log("OK  headers order + UTF-8 BOM + CRLF");
}

function testSeparatorAndEscaping(): void {
  const party = sampleParty({
    displayName: 'Rossi; "Srl"',
    address: "Via Roma 1,\nMilano",
    notes: 'Riga1\r\nRiga2; fine "quote"',
    email: "info@esempio.it",
    isCustomer: true,
    isSupplier: true,
    status: "archived",
  });
  const csv = serializePartiesCsv([party]);
  assert(csv.includes(PARTIES_CSV_SEPARATOR), "semicolon separator");
  assert(csv.includes('"Rossi; ""Srl"""'), "quotes doubled and field quoted");
  assert(csv.includes("Sì"), "boolean sì");
  assert(csv.includes("Archiviata"), "archived label");

  const rows = parseSemicolonCsv(csv);
  assert(rows.length === 2, "header + one data row");
  const data = rows[1]!;
  assert(data[1] === 'Rossi; "Srl"', "name round-trip with ; and quotes");
  assert(data[2] === "Sì" && data[3] === "Sì", "roles Sì/Sì");
  assert(data[6] === "Via Roma 1,\nMilano", "address newline round-trip");
  assert(data[9] === 'Riga1\r\nRiga2; fine "quote"', "notes round-trip");
  assert(data[10] === "Archiviata", "status label");
  console.log("OK  escaping ; quotes newlines + parse round-trip");
}

function testItalianCharactersAndNulls(): void {
  const party = sampleParty({
    displayName: "Società Caffè Perù",
    email: null,
    phone: "",
    taxCode: "RSSMRA80A01H501U",
    vatNumber: null,
    notes: "àèéìòù €",
  });
  const csv = serializePartiesCsv([party]);
  const data = parseSemicolonCsv(csv)[1]!;
  assert(data[1] === "Società Caffè Perù", "italian accents preserved");
  assert(data[4] === "", "null email -> empty");
  assert(data[5] === "", "empty phone stays empty");
  assert(data[7] === "RSSMRA80A01H501U", "tax code");
  assert(data[8] === "", "null vat -> empty");
  assert(data[9] === "àèéìòù €", "notes accents/euro");
  assert(data[2] === "Sì" && data[3] === "No", "customer yes supplier no");
  assert(data[10] === "Attiva", "active status");
  console.log("OK  italian chars + null/empty fields");
}

function testExportBeyondCurrentPage(): void {
  const db = new BetterSqlite3(":memory:");
  runMigrations(db);

  for (let i = 0; i < 30; i += 1) {
    const n = String(i).padStart(2, "0");
    insertParty(
      db,
      `p-${n}`,
      fields({ displayName: `Cliente ${n}`, email: `c${n}@ex.com` }),
    );
  }

  const page = listParties(db, {
    search: "",
    status: "active",
    page: 1,
    pageSize: 25,
  });
  assert(page.items.length === 25, "page window is 25");
  assert(page.total === 30, "total is 30");

  const exported = listPartiesForExport(
    db,
    { search: "", status: "active" },
    PARTY_EXPORT_MAX_ROWS,
  );
  assert(exported.total === 30, "export total ignores page");
  assert(exported.items.length === 30, "export returns all matching rows");

  const csv = serializePartiesCsv(exported.items);
  const rows = parseSemicolonCsv(csv);
  assert(rows.length === 31, "header + 30 data rows");

  db.close();
  console.log("OK  export includes all filtered rows beyond page");
}

function testSearchAndStatusFilters(): void {
  const db = new BetterSqlite3(":memory:");
  runMigrations(db);

  insertParty(db, "a", fields({ displayName: "Alpha Attiva" }));
  insertParty(db, "b", fields({ displayName: "Beta Attiva", email: "beta@ex.com" }));
  insertParty(db, "c", fields({ displayName: "Gamma Archiviata" }));
  setPartyStatus(db, "c", "archived");

  const active = listPartiesForExport(
    db,
    { search: "", status: "active" },
    PARTY_EXPORT_MAX_ROWS,
  );
  assert(active.total === 2, "active filter");

  const archived = listPartiesForExport(
    db,
    { search: "", status: "archived" },
    PARTY_EXPORT_MAX_ROWS,
  );
  assert(archived.total === 1 && archived.items[0]?.id === "c", "archived filter");

  const search = listPartiesForExport(
    db,
    { search: "beta", status: "all" },
    PARTY_EXPORT_MAX_ROWS,
  );
  assert(search.total === 1 && search.items[0]?.id === "b", "search filter");

  const empty = listPartiesForExport(
    db,
    { search: "nessuno", status: "all" },
    PARTY_EXPORT_MAX_ROWS,
  );
  assert(empty.total === 0 && empty.items.length === 0, "empty result set");

  db.close();
  console.log("OK  search/status filters + empty set");
}

function testPayloadValidation(): void {
  let rejected = false;
  try {
    parsePartyExportFilter({ search: "", status: "active", page: 1 });
  } catch {
    rejected = true;
  }
  assert(rejected, "pagination keys must be rejected on export filter");

  rejected = false;
  try {
    parsePartyExportFilter({ status: "ghost" });
  } catch {
    rejected = true;
  }
  assert(rejected, "invalid status rejected");

  const ok = parsePartyExportFilter({ search: "  acme ", status: "all" });
  assert(ok.search === "acme" && ok.status === "all", "export filter parsed");

  const defaults = parsePartyExportFilter(undefined);
  assert(
    defaults.search === "" && defaults.status === "active",
    "defaults match list semantics",
  );
  console.log("OK  export filter IPC validation");
}

function testPublicResultContractNoPaths(): void {
  const completed: PartiesCsvExportResult = {
    status: "completed",
    fileName: "projectcore-anagrafiche-2026-10-27.csv",
    rowCount: 3,
  };
  const cancelled: PartiesCsvExportResult = { status: "cancelled" };
  const empty: PartiesCsvExportResult = { status: "empty" };

  assert(completed.status === "completed", "completed contract");
  assert(cancelled.status === "cancelled", "cancelled contract");
  assert(empty.status === "empty", "empty contract");
  assert(
    !("filePath" in completed) &&
      !JSON.stringify(completed).includes("C:\\") &&
      !JSON.stringify(completed).includes("/Users/"),
    "public result must not expose local paths",
  );

  const encoded = toIpcThrownError(
    AppError.validation("Troppe anagrafiche da esportare."),
  );
  const payload = tryParseDesktopErrorPayload(encoded.message);
  assert(payload?.code === "VALIDATION_FAILED", "validation code");
  assert(
    !encoded.message.includes("SELECT") && !encoded.message.includes(os.tmpdir()),
    "errors stay sanitized",
  );
  console.log("OK  public result contract + sanitized errors");
}

function testWriteCsvFileRoundTrip(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-csv-"));
  const filePath = path.join(dir, "out.csv");
  const parties = [
    sampleParty({
      id: "1",
      displayName: "Caffè & Tè",
      notes: "linea1; linea2",
    }),
    sampleParty({
      id: "2",
      displayName: "Beta",
      isCustomer: false,
      isSupplier: true,
      status: "archived",
    }),
  ];
  const csv = serializePartiesCsv(parties);
  fs.writeFileSync(filePath, csv, "utf8");
  const raw = fs.readFileSync(filePath);
  assert(raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf, "BOM bytes on disk");
  const text = fs.readFileSync(filePath, "utf8");
  const rows = parseSemicolonCsv(text);
  assert(rows[1]?.[1] === "Caffè & Tè", "file round-trip name");
  assert(rows[1]?.[9] === "linea1; linea2", "file round-trip notes");
  assert(rows[2]?.[3] === "Sì" && rows[2]?.[10] === "Archiviata", "second row");
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("OK  filesystem write round-trip with BOM");
}

function main(): void {
  testHeadersOrderAndBom();
  testSeparatorAndEscaping();
  testItalianCharactersAndNulls();
  testExportBeyondCurrentPage();
  testSearchAndStatusFilters();
  testPayloadValidation();
  testPublicResultContractNoPaths();
  testWriteCsvFileRoundTrip();
  console.log("All CSV export tests passed.");
}

main();
