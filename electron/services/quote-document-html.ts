import type { CompanyProfile } from "../../shared/company-profile.ts";
import type { QuoteDto } from "../../shared/quotes.ts";
import {
  buildVatBreakdown,
  escapeHtml,
  formatEuroIt,
  lifecycleLabelIt,
  resolveDocumentTerms,
} from "./quote-document-format.ts";

function lineOrNull(
  label: string | null | undefined,
  value: string | null | undefined,
): string | null {
  const v = value?.trim();
  if (!v) {
    return null;
  }
  return label ? `${label}${v}` : v;
}

function joinAddress(profile: CompanyProfile): string | null {
  const cityLine =
    [profile.postalCode?.trim(), profile.city?.trim()]
      .filter(Boolean)
      .join(" ")
      .trim() || null;
  const parts = [
    profile.address?.trim() || null,
    cityLine,
    profile.province?.trim() || null,
    profile.country?.trim() || null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Builds a self-contained printable A4 HTML document from trusted DTOs.
 * All user/company texts are HTML-escaped. No remote resources.
 */
export function buildQuoteDocumentHtml(
  quote: QuoteDto,
  profile: CompanyProfile,
): string {
  const companyLines = [
    profile.legalName.trim() || null,
    profile.tradeName?.trim() || null,
    joinAddress(profile),
    lineOrNull("P.IVA ", profile.vatNumber),
    lineOrNull("CF ", profile.taxCode),
    profile.email?.trim() || null,
    profile.phone?.trim() || null,
    profile.website?.trim() || null,
  ].filter((line): line is string => Boolean(line));

  const logoHtml =
    profile.hasLogo &&
    profile.logoDataUrl &&
    /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(profile.logoDataUrl)
      ? `<img class="logo" src="${profile.logoDataUrl.replace(/"/g, "")}" alt="" />`
      : "";

  const companyBlock =
    companyLines.length > 0 || logoHtml
      ? `<div class="company">
          ${logoHtml}
          <div class="company-text">
            ${companyLines
              .map((line, index) =>
                index === 0
                  ? `<div class="company-name">${escapeHtml(line)}</div>`
                  : `<div>${escapeHtml(line)}</div>`,
              )
              .join("")}
          </div>
        </div>`
      : `<div class="company"><div class="company-name muted">Intestazione non configurata</div></div>`;

  const customerLines = [
    quote.customer.name,
    quote.customer.address,
    lineOrNull("CF ", quote.customer.taxCode),
    lineOrNull("P.IVA ", quote.customer.vatNumber),
    quote.customer.email,
    quote.customer.phone,
  ]
    .filter((line): line is string => Boolean(line && String(line).trim()))
    .map((line) => `<div>${escapeHtml(line)}</div>`)
    .join("");

  const rows = quote.items
    .map((item) => {
      const qty = `${item.quantity}${item.unit ? ` ${item.unit}` : ""}`;
      const discount =
        item.discountPercent === "0" ? "—" : `${escapeHtml(item.discountPercent)}%`;
      return `<tr>
        <td class="desc">${escapeHtml(item.description)}</td>
        <td class="num">${escapeHtml(qty)}</td>
        <td class="num">${escapeHtml(formatEuroIt(item.unitPriceCents))}</td>
        <td class="num">${discount}</td>
        <td class="num">${escapeHtml(item.vatRatePercent)}%</td>
        <td class="num">${escapeHtml(formatEuroIt(item.taxableCents))}</td>
        <td class="num">${escapeHtml(formatEuroIt(item.totalCents))}</td>
      </tr>`;
    })
    .join("");

  const vatRows = buildVatBreakdown(quote.items)
    .map(
      (row) => `<tr>
        <td>IVA ${escapeHtml(row.rateLabel)}</td>
        <td class="num">${escapeHtml(formatEuroIt(row.taxableCents))}</td>
        <td class="num">${escapeHtml(formatEuroIt(row.vatCents))}</td>
      </tr>`,
    )
    .join("");

  const terms = resolveDocumentTerms({
    companyTerms: profile.defaultQuoteTerms,
    quoteNotes: quote.notes,
  })
    .map(
      (section) => `<section class="terms">
        <h2>${escapeHtml(section.title)}</h2>
        <div class="terms-body">${escapeHtml(section.body)}</div>
      </section>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <title>Preventivo ${escapeHtml(quote.number)}</title>
  <style>
    @page {
      size: A4;
      margin: 14mm 14mm 18mm 14mm;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #15202b;
      font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      font-size: 10.5pt;
      line-height: 1.45;
      background: #fff;
    }
    .muted { color: #667788; }
    header.doc-header {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      padding-bottom: 14px;
      border-bottom: 2px solid #1f6f66;
      margin-bottom: 18px;
    }
    .company { display: flex; gap: 14px; align-items: flex-start; max-width: 58%; }
    .logo {
      max-width: 72px;
      max-height: 72px;
      object-fit: contain;
      flex-shrink: 0;
    }
    .company-name { font-size: 13pt; font-weight: 700; color: #0f3d39; margin-bottom: 2px; }
    .company-text div { font-size: 9.5pt; color: #334455; }
    .doc-meta { text-align: right; min-width: 38%; }
    .doc-meta .title {
      font-size: 18pt;
      font-weight: 700;
      letter-spacing: 0.04em;
      color: #0f3d39;
      margin: 0 0 8px;
    }
    .doc-meta div { font-size: 9.5pt; }
    .parties {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
      margin: 16px 0 20px;
    }
    .panel {
      border: 1px solid #d7e0e7;
      border-radius: 6px;
      padding: 12px 14px;
      background: #f7fafb;
    }
    .panel h2 {
      margin: 0 0 8px;
      font-size: 9pt;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #5a6b78;
    }
    table.items {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    table.items thead { display: table-header-group; }
    table.items tr { page-break-inside: avoid; break-inside: avoid; }
    table.items th, table.items td {
      padding: 7px 6px;
      border-bottom: 1px solid #d7e0e7;
      vertical-align: top;
      font-size: 9.5pt;
    }
    table.items th {
      text-align: left;
      font-size: 8pt;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #5a6b78;
      background: #eef4f5;
    }
    table.items .desc { width: 34%; word-wrap: break-word; overflow-wrap: anywhere; }
    .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .summary {
      margin-top: 18px;
      display: flex;
      justify-content: flex-end;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .summary-box { width: 320px; }
    .summary-box table { width: 100%; border-collapse: collapse; }
    .summary-box td { padding: 4px 0; font-size: 9.5pt; }
    .summary-box .grand td {
      padding-top: 8px;
      border-top: 2px solid #1f6f66;
      font-weight: 700;
      font-size: 11pt;
    }
    .vat-block { margin-top: 14px; max-width: 420px; page-break-inside: avoid; }
    .vat-block h2 {
      margin: 0 0 6px;
      font-size: 9pt;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #5a6b78;
    }
    .vat-block table { width: 100%; border-collapse: collapse; }
    .vat-block th, .vat-block td {
      padding: 4px 6px;
      border-bottom: 1px solid #d7e0e7;
      font-size: 9pt;
    }
    .terms {
      margin-top: 18px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .terms h2 {
      margin: 0 0 6px;
      font-size: 9pt;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #5a6b78;
    }
    .terms-body {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 9.5pt;
      color: #334455;
    }
    footer.doc-footer {
      margin-top: 28px;
      padding-top: 10px;
      border-top: 1px solid #d7e0e7;
      font-size: 8pt;
      color: #7a8a96;
    }
  </style>
</head>
<body>
  <header class="doc-header">
    ${companyBlock}
    <div class="doc-meta">
      <p class="title">PREVENTIVO</p>
      <div><strong>Numero:</strong> ${escapeHtml(quote.number)}</div>
      <div><strong>Data:</strong> ${escapeHtml(quote.issueDate)}</div>
      ${
        quote.dueDate
          ? `<div><strong>Scadenza:</strong> ${escapeHtml(quote.dueDate)}</div>`
          : ""
      }
      <div><strong>Stato:</strong> ${escapeHtml(lifecycleLabelIt(quote.lifecycleStatus))}</div>
    </div>
  </header>

  <div class="parties">
    <section class="panel">
      <h2>Cliente</h2>
      ${customerLines || "<div class='muted'>—</div>"}
    </section>
    <section class="panel">
      <h2>Documento</h2>
      <div>Valuta: EUR</div>
      <div>Numerazione commerciale interna</div>
      <div class="muted">(non costituisce fattura fiscale)</div>
    </section>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th>Descrizione</th>
        <th class="num">Qtà</th>
        <th class="num">Prezzo</th>
        <th class="num">Sconto</th>
        <th class="num">IVA</th>
        <th class="num">Imponibile</th>
        <th class="num">Totale</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <section class="vat-block">
    <h2>Riepilogo IVA</h2>
    <table>
      <thead>
        <tr>
          <th>Aliquota</th>
          <th class="num">Imponibile</th>
          <th class="num">Imposta</th>
        </tr>
      </thead>
      <tbody>${vatRows}</tbody>
    </table>
  </section>

  <div class="summary">
    <div class="summary-box">
      <table>
        <tr>
          <td>Imponibile</td>
          <td class="num">${escapeHtml(formatEuroIt(quote.taxableCents))}</td>
        </tr>
        <tr>
          <td>Totale IVA</td>
          <td class="num">${escapeHtml(formatEuroIt(quote.vatCents))}</td>
        </tr>
        <tr class="grand">
          <td>Totale documento</td>
          <td class="num">${escapeHtml(formatEuroIt(quote.totalCents))}</td>
        </tr>
      </table>
    </div>
  </div>

  ${terms}

  <footer class="doc-footer">
    Documento generato da ProjectCore · Preventivo ${escapeHtml(quote.number)}
  </footer>
</body>
</html>`;
}
