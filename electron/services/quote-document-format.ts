import type { QuoteDto, QuoteItemDto } from "../../shared/quotes.ts";

/** Format integer euro cents with Italian separators: `1.234,56 €`. */
export function formatEuroIt(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const grouped = whole
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped},${frac} €`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function lifecycleLabelIt(status: QuoteDto["lifecycleStatus"]): string {
  switch (status) {
    case "draft":
      return "Bozza";
    case "sent":
      return "Inviato";
    case "accepted":
      return "Accettato";
    case "rejected":
      return "Rifiutato";
    case "expired":
      return "Scaduto";
    default:
      return status;
  }
}

export type VatBreakdownRow = {
  rateLabel: string;
  taxableCents: number;
  vatCents: number;
};

/** Aggregate VAT using persisted line totals (no independent recalculation). */
export function buildVatBreakdown(items: QuoteItemDto[]): VatBreakdownRow[] {
  const map = new Map<
    number,
    { rateLabel: string; taxableCents: number; vatCents: number }
  >();
  for (const item of items) {
    const existing = map.get(item.vatRateBps);
    if (existing) {
      existing.taxableCents += item.taxableCents;
      existing.vatCents += item.vatCents;
    } else {
      map.set(item.vatRateBps, {
        rateLabel: `${item.vatRatePercent}%`,
        taxableCents: item.taxableCents,
        vatCents: item.vatCents,
      });
    }
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => row);
}

/**
 * Conditions display rule:
 * - company defaults → "Condizioni generali"
 * - quote notes → "Note / condizioni del preventivo"
 * - if both exist and are equal (trimmed), show once as "Condizioni"
 */
export function resolveDocumentTerms(params: {
  companyTerms: string | null;
  quoteNotes: string | null;
}): Array<{ title: string; body: string }> {
  const company = params.companyTerms?.trim() || null;
  const quote = params.quoteNotes?.trim() || null;
  if (company && quote && company === quote) {
    return [{ title: "Condizioni", body: company }];
  }
  const sections: Array<{ title: string; body: string }> = [];
  if (company) {
    sections.push({ title: "Condizioni generali", body: company });
  }
  if (quote) {
    sections.push({
      title: "Note / condizioni del preventivo",
      body: quote,
    });
  }
  return sections;
}

/** Safe default PDF basename from commercial quote number. */
export function buildQuotePdfBaseName(quoteNumber: string): string {
  const withoutControls = [...quoteNumber.trim()]
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return code < 32 ? "-" : ch;
    })
    .join("");
  const sanitized = withoutControls
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const base = sanitized.length > 0 ? sanitized : "preventivo";
  return `Preventivo-${base}.pdf`;
}

export function isPdfBuffer(buffer: Buffer): boolean {
  return (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  );
}
