/**
 * Commercial money helpers for quotes.
 *
 * Storage conventions:
 * - Money: integer euro cents
 * - Quantity: integer milli-units (1.000 = 1 → 1000)
 * - Discount / VAT rate: integer basis points (22.00% → 2200; 12.5% discount → 1250)
 *
 * Rounding: half-up to the nearest integer cent / milli / bp step as documented per helper.
 */

/** Allowed VAT rates in basis points (commercial preset, not a full fiscal catalog). */
export const QUOTE_VAT_RATE_BPS = [0, 400, 500, 1000, 2200] as const;
export type QuoteVatRateBps = (typeof QUOTE_VAT_RATE_BPS)[number];

export const QUOTE_VAT_RATE_LABELS: Record<QuoteVatRateBps, string> = {
  0: "0%",
  400: "4%",
  500: "5%",
  1000: "10%",
  2200: "22%",
};

/** Half-up rounding toward +∞ for |n| when fractional part ≥ 0.5. */
export function roundHalfUp(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Valore numerico non valido.");
  }
  return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
}

export function isAllowedVatRateBps(value: number): value is QuoteVatRateBps {
  return (QUOTE_VAT_RATE_BPS as readonly number[]).includes(value);
}

export type LineMoneyInput = {
  quantityMilli: number;
  unitPriceCents: number;
  discountBps: number;
  vatRateBps: number;
};

export type LineMoneyResult = {
  taxableCents: number;
  vatCents: number;
  totalCents: number;
};

/**
 * Line calculation (all integer storage units):
 * 1. gross = roundHalfUp(quantityMilli * unitPriceCents / 1000)
 * 2. discount = roundHalfUp(gross * discountBps / 10000)
 * 3. taxable = gross - discount
 * 4. vat = roundHalfUp(taxable * vatRateBps / 10000)
 * 5. total = taxable + vat
 */
export function calculateLineMoney(input: LineMoneyInput): LineMoneyResult {
  if (
    !Number.isInteger(input.quantityMilli) ||
    input.quantityMilli <= 0 ||
    !Number.isInteger(input.unitPriceCents) ||
    input.unitPriceCents < 0 ||
    !Number.isInteger(input.discountBps) ||
    input.discountBps < 0 ||
    input.discountBps > 10_000 ||
    !Number.isInteger(input.vatRateBps) ||
    !isAllowedVatRateBps(input.vatRateBps)
  ) {
    throw new Error("Parametri di calcolo riga non validi.");
  }

  const grossCents = roundHalfUp(
    (input.quantityMilli * input.unitPriceCents) / 1000,
  );
  const discountCents = roundHalfUp((grossCents * input.discountBps) / 10_000);
  const taxableCents = grossCents - discountCents;
  const vatCents = roundHalfUp((taxableCents * input.vatRateBps) / 10_000);
  return {
    taxableCents,
    vatCents,
    totalCents: taxableCents + vatCents,
  };
}

export function sumDocumentTotals(lines: LineMoneyResult[]): LineMoneyResult {
  return lines.reduce(
    (acc, line) => ({
      taxableCents: acc.taxableCents + line.taxableCents,
      vatCents: acc.vatCents + line.vatCents,
      totalCents: acc.totalCents + line.totalCents,
    }),
    { taxableCents: 0, vatCents: 0, totalCents: 0 },
  );
}

/** Parse a decimal quantity string/number into milli-units (max 3 decimals). */
export function parseQuantityToMilli(value: unknown): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error("La quantità deve essere maggiore di zero.");
    }
    return parseQuantityToMilli(String(value));
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Quantità non valida.");
  }
  const trimmed = value.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,3})?$/.test(trimmed)) {
    throw new Error("La quantità ammette al massimo 3 decimali.");
  }
  const [whole, frac = ""] = trimmed.split(".");
  const milli = Number(whole) * 1000 + Number((frac + "000").slice(0, 3));
  if (!Number.isInteger(milli) || milli <= 0) {
    throw new Error("La quantità deve essere maggiore di zero.");
  }
  return milli;
}

export function milliToQuantityString(milli: number): string {
  const whole = Math.trunc(milli / 1000);
  const frac = Math.abs(milli % 1000);
  if (frac === 0) {
    return String(whole);
  }
  return `${whole}.${String(frac).padStart(3, "0").replace(/0+$/, "")}`;
}

/** Parse euro amount (string/number) to integer cents (max 2 decimals, ≥ 0). */
export function parseEurosToCents(value: unknown): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("Il prezzo non può essere negativo.");
    }
    return roundHalfUp(value * 100);
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Prezzo non valido.");
  }
  const trimmed = value.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error("Il prezzo ammette al massimo 2 decimali.");
  }
  const [whole, frac = ""] = trimmed.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

export function centsToEuroString(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}

/** Discount percent 0–100 with max 2 decimals → basis points. */
export function parseDiscountPercentToBps(value: unknown): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error("Lo sconto deve essere compreso tra 0 e 100.");
    }
    return roundHalfUp(value * 100);
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Sconto non valido.");
  }
  const trimmed = value.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error("Lo sconto ammette al massimo 2 decimali.");
  }
  const [whole, frac = ""] = trimmed.split(".");
  const bps = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (bps < 0 || bps > 10_000) {
    throw new Error("Lo sconto deve essere compreso tra 0 e 100.");
  }
  return bps;
}

export function bpsToPercentString(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const frac = bps % 100;
  if (frac === 0) {
    return String(whole);
  }
  return `${whole}.${String(frac).padStart(2, "0").replace(/0+$/, "")}`;
}

export function parseVatRatePercentToBps(value: unknown): QuoteVatRateBps {
  let percent: number;
  if (typeof value === "number") {
    percent = value;
  } else if (typeof value === "string" && value.trim().length > 0) {
    percent = Number(value.trim().replace(",", "."));
  } else {
    throw new Error("Aliquota IVA non valida.");
  }
  if (!Number.isFinite(percent)) {
    throw new Error("Aliquota IVA non valida.");
  }
  const bps = roundHalfUp(percent * 100);
  if (!isAllowedVatRateBps(bps)) {
    throw new Error("Aliquota IVA non consentita.");
  }
  return bps;
}
