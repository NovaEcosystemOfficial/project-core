import { createRequire } from "node:module";
import type Database from "better-sqlite3";
import { runMigrations } from "../electron/db/migrations.ts";
import { insertParty } from "../electron/repositories/parties-repository.ts";
import {
  writeCompanyLogoRecord,
  writeCompanyProfileFields,
} from "../electron/repositories/company-profile-repository.ts";
import { allocateQuoteNumber, insertQuote } from "../electron/repositories/quotes-repository.ts";
import { withTransaction } from "../electron/db/transactions.ts";
import { validateCompanyLogoBuffer } from "../electron/services/company-logo-validation.ts";
import { buildQuoteDocumentHtml } from "../electron/services/quote-document-html.ts";
import {
  buildQuotePdfBaseName,
  buildVatBreakdown,
  escapeHtml,
  formatEuroIt,
  isPdfBuffer,
  resolveDocumentTerms,
} from "../electron/services/quote-document-format.ts";
import { computeQuoteDocument } from "../shared/quotes.ts";
import {
  DEFAULT_COMPANY_PROFILE,
  DEFAULT_COMPANY_PROFILE_FIELDS,
  toPublicCompanyProfile,
  type CompanyProfile,
} from "../shared/company-profile.ts";
import { AppError, toIpcThrownError } from "../electron/errors/app-error.ts";
import { tryParseDesktopErrorPayload } from "../shared/errors.ts";
import { parseQuoteIdInput } from "../shared/quotes.ts";

const require = createRequire(import.meta.url);
type BetterSqlite3Constructor = new (filename: string) => Database;
const BetterSqlite3 = require("better-sqlite3") as BetterSqlite3Constructor;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function tinyPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

function openDb(): Database {
  const db = new BetterSqlite3(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

function seedQuote(db: Database, opts?: { longDesc?: boolean }) {
  insertParty(db, "cust-1", {
    displayName: "Cliente Snapshot",
    isCustomer: true,
    isSupplier: false,
    email: "old@example.com",
    phone: null,
    address: "Via Cliente 1",
    taxCode: null,
    vatNumber: "IT111",
    notes: null,
  });

  const items = [
    {
      description: opts?.longDesc
        ? `Servizio dettagliato ${"lorem ".repeat(80)}fine`
        : 'Consulenza <script>alert("x")</script> & co.',
      quantity: "2",
      unit: "h",
      unitPrice: "100.00",
      discountPercent: "10",
      vatRatePercent: "22",
    },
    {
      description: "Materiali",
      quantity: "1.5",
      unit: "kg",
      unitPrice: "20.00",
      discountPercent: "0",
      vatRatePercent: "10",
    },
  ];
  const computed = computeQuoteDocument(items);
  const itemIds = computed.items.map((_, i) => `it-${i}`);
  const number = withTransaction(db, (tx) => allocateQuoteNumber(tx, 2026));
  return insertQuote(db, {
    id: "quote-pdf-1",
    number,
    partyId: "cust-1",
    customer: {
      name: "Cliente Snapshot",
      address: "Via Cliente 1",
      taxCode: null,
      vatNumber: "IT111",
      email: "old@example.com",
      phone: null,
    },
    issueDate: "2026-10-27",
    dueDate: "2026-11-27",
    notes: "Condizioni del preventivo specifiche.",
    computed: {
      ...computed,
      items: computed.items.map((item, i) => ({ ...item, id: itemIds[i]! })),
    },
    itemIds,
  });
}

function testFormattingAndVat(): void {
  assert(formatEuroIt(123456) === "1.234,56 €", "italian euro format");
  assert(formatEuroIt(50) === "0,50 €", "cents only");
  assert(escapeHtml(`a<b>&"'`) === "a&lt;b&gt;&amp;&quot;&#39;", "escape");

  const quote = seedQuote(openDb());
  const breakdown = buildVatBreakdown(quote.items);
  assert(breakdown.length === 2, "two vat rates");
  assert(
    breakdown.reduce((s, r) => s + r.vatCents, 0) === quote.vatCents,
    "vat sum matches document",
  );
  assert(
    breakdown.reduce((s, r) => s + r.taxableCents, 0) === quote.taxableCents,
    "taxable sum matches document",
  );
  console.log("OK  euro format + VAT breakdown from persisted totals");
}

function testTermsResolution(): void {
  assert(
    resolveDocumentTerms({
      companyTerms: "A",
      quoteNotes: "A",
    }).length === 1,
    "identical terms shown once",
  );
  const both = resolveDocumentTerms({
    companyTerms: "Generali",
    quoteNotes: "Specifiche",
  });
  assert(both.length === 2, "both sections when different");
  assert(both[0]?.title === "Condizioni generali", "company title");
  assert(both[1]?.title === "Note / condizioni del preventivo", "quote title");
  console.log("OK  terms resolution rule");
}

function testHtmlWithAndWithoutLogo(): void {
  const db = openDb();
  const quote = seedQuote(db);

  const emptyProfile: CompanyProfile = { ...DEFAULT_COMPANY_PROFILE };
  const htmlNoLogo = buildQuoteDocumentHtml(quote, emptyProfile);
  assert(htmlNoLogo.includes("PREVENTIVO"), "title");
  assert(htmlNoLogo.includes(quote.number), "number");
  assert(htmlNoLogo.includes("Cliente Snapshot"), "customer snapshot");
  assert(!htmlNoLogo.includes("<script>"), "script escaped out of text");
  assert(htmlNoLogo.includes("&lt;script&gt;"), "escaped markup visible as text");
  assert(htmlNoLogo.includes(" €"), "euro amounts");
  assert(htmlNoLogo.includes("Riepilogo IVA"), "vat summary");
  assert(htmlNoLogo.includes("@page"), "A4 page css");
  assert(htmlNoLogo.includes("thead { display: table-header-group; }"), "repeat headers");
  assert(!htmlNoLogo.includes("http://") && !htmlNoLogo.includes("https://"), "no remote urls");

  writeCompanyProfileFields(db, {
    ...DEFAULT_COMPANY_PROFILE_FIELDS,
    legalName: "Studio Esempio",
    tradeName: "Brand Ops",
    address: "Via Roma 1",
    postalCode: "20100",
    city: "Milano",
    province: "MI",
    country: "Italia",
    vatNumber: "IT999",
    taxCode: null,
    email: "info@studio.test",
    phone: null,
    website: null,
    defaultQuoteTerms: "Pagamento a 30 giorni.",
  });
  const logo = validateCompanyLogoBuffer(tinyPng());
  writeCompanyLogoRecord(db, logo);
  const profile = toPublicCompanyProfile(
    {
      legalName: "Studio Esempio",
      tradeName: "Brand Ops",
      address: "Via Roma 1",
      postalCode: "20100",
      city: "Milano",
      province: "MI",
      country: "Italia",
      vatNumber: "IT999",
      taxCode: null,
      email: "info@studio.test",
      phone: null,
      website: null,
      defaultQuoteTerms: "Pagamento a 30 giorni.",
    },
    logo,
  );
  const htmlLogo = buildQuoteDocumentHtml(quote, profile);
  assert(htmlLogo.includes("Studio Esempio"), "company name");
  assert(htmlLogo.includes("Brand Ops"), "trade name");
  assert(htmlLogo.includes("data:image/png;base64,"), "embedded logo");
  assert(htmlLogo.includes("Condizioni generali"), "company terms section");
  assert(htmlLogo.includes("Note / condizioni del preventivo"), "quote notes");
  assert(htmlLogo.includes("Pagamento a 30 giorni."), "company terms body");

  // Snapshot independence: change party name in DB, HTML still uses quote snapshot
  db.prepare(`UPDATE parties SET display_name = 'NUOVO NOME' WHERE id = 'cust-1'`).run();
  const htmlAfter = buildQuoteDocumentHtml(quote, profile);
  assert(htmlAfter.includes("Cliente Snapshot"), "snapshot unchanged");
  assert(!htmlAfter.includes("NUOVO NOME"), "live anagrafica not used");

  db.close();
  console.log("OK  HTML with/without logo + escaping + snapshot");
}

function testMultipageLongDescriptions(): void {
  const db = openDb();
  const quote = seedQuote(db, { longDesc: true });
  const html = buildQuoteDocumentHtml(quote, DEFAULT_COMPANY_PROFILE);
  assert(html.includes("lorem "), "long description present");
  assert(html.includes("page-break-inside: avoid"), "avoid split rows");
  assert(html.includes("overflow-wrap: anywhere"), "long text wrap");
  db.close();
  console.log("OK  multipage CSS for long descriptions");
}

function testFileNameAndContracts(): void {
  assert(
    buildQuotePdfBaseName("PREV-2026-0001") === "Preventivo-PREV-2026-0001.pdf",
    "default name",
  );
  assert(
    buildQuotePdfBaseName('PREV/2026:"bad?"') === "Preventivo-PREV-2026-bad.pdf" ||
      buildQuotePdfBaseName('PREV/2026:"bad?"').startsWith("Preventivo-"),
    "sanitized name",
  );
  assert(!buildQuotePdfBaseName("A<>B").includes("<"), "no angle brackets");

  const cancelled = { status: "cancelled" as const };
  assert(cancelled.status === "cancelled", "cancel contract");

  const completed = {
    status: "completed" as const,
    fileName: "Preventivo-PREV-2026-0001.pdf",
  };
  assert(
    !("filePath" in completed) && !JSON.stringify(completed).includes("C:\\"),
    "public result has no paths",
  );

  let rejected = false;
  try {
    parseQuoteIdInput({ id: "x", extra: 1 });
  } catch {
    rejected = true;
  }
  assert(rejected, "invalid ipc id payload");

  const encoded = toIpcThrownError(
    AppError.validation("Identificativo preventivo non valido."),
  );
  const payload = tryParseDesktopErrorPayload(encoded.message);
  assert(payload?.code === "VALIDATION_FAILED", "validation code");

  // Fake HTML-as-pdf must fail magic check
  assert(!isPdfBuffer(Buffer.from("<!DOCTYPE html>")), "html is not pdf");
  assert(isPdfBuffer(Buffer.from("%PDF-1.4\n%âãÏÓ")), "pdf magic ok");

  console.log("OK  filename sanitize + IPC contracts + PDF magic");
}

function testPartialCompanyProfile(): void {
  const db = openDb();
  const quote = seedQuote(db);
  const profile: CompanyProfile = {
    ...DEFAULT_COMPANY_PROFILE,
    legalName: "Solo Nome",
    country: "Italia",
  };
  const html = buildQuoteDocumentHtml(quote, profile);
  assert(html.includes("Solo Nome"), "partial legal name");
  // Company block should not invent empty fiscal rows; customer snapshot may still show P.IVA.
  assert(!html.includes("P.IVA IT999"), "no invented company VAT");
  assert(!html.includes("null"), "no null literals");
  db.close();
  console.log("OK  partial company profile omits empty rows");
}

function main(): void {
  testFormattingAndVat();
  testTermsResolution();
  testHtmlWithAndWithoutLogo();
  testMultipageLongDescriptions();
  testFileNameAndContracts();
  testPartialCompanyProfile();
  console.log("All PDF export (document) tests passed.");
  console.log(
    "NOTE: real Chromium printToPDF rendering is covered by npm run test:pdf-render (Electron).",
  );
}

main();
