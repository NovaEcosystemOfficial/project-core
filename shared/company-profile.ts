/**
 * Company profile for document headers (quotes / future PDFs).
 * Stored in app_settings — survives restart and SQLite backup/restore.
 * Defaults are empty; never invent fiscal or contact data.
 */

export const COMPANY_PROFILE_SETTING_KEY = "companyProfile" as const;
export const COMPANY_LOGO_SETTING_KEY = "companyLogo" as const;

export const COMPANY_LOGO_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export type CompanyLogoMimeType = (typeof COMPANY_LOGO_MIME_TYPES)[number];

/** Max logo payload size (decoded bytes). */
export const COMPANY_LOGO_MAX_BYTES = 512 * 1024;

export const COMPANY_FIELD_LIMITS = {
  legalName: 200,
  tradeName: 200,
  address: 500,
  postalCode: 16,
  city: 100,
  province: 64,
  country: 100,
  vatNumber: 32,
  taxCode: 32,
  email: 254,
  phone: 40,
  website: 300,
  defaultQuoteTerms: 8000,
} as const;

export type CompanyProfileFields = {
  legalName: string;
  tradeName: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  country: string;
  vatNumber: string | null;
  taxCode: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  defaultQuoteTerms: string | null;
};

/** Public DTO — logo as data URL only (never a filesystem path). */
export type CompanyProfile = CompanyProfileFields & {
  hasLogo: boolean;
  logoMimeType: CompanyLogoMimeType | null;
  logoDataUrl: string | null;
};

/** Persisted logo payload inside app_settings (main-only serialization). */
export type CompanyLogoRecord = {
  mimeType: CompanyLogoMimeType;
  base64: string;
};

export const DEFAULT_COMPANY_PROFILE_FIELDS: CompanyProfileFields = {
  legalName: "",
  tradeName: null,
  address: null,
  postalCode: null,
  city: null,
  province: null,
  country: "Italia",
  vatNumber: null,
  taxCode: null,
  email: null,
  phone: null,
  website: null,
  defaultQuoteTerms: null,
};

export const DEFAULT_COMPANY_PROFILE: CompanyProfile = {
  ...DEFAULT_COMPANY_PROFILE_FIELDS,
  hasLogo: false,
  logoMimeType: null,
  logoDataUrl: null,
};

export type CompanyLogoSelectResult =
  | { status: "completed"; profile: CompanyProfile }
  | { status: "cancelled" };

const FIELD_KEYS = new Set([
  "legalName",
  "tradeName",
  "address",
  "postalCode",
  "city",
  "province",
  "country",
  "vatNumber",
  "taxCode",
  "email",
  "phone",
  "website",
  "defaultQuoteTerms",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOptionalText(
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
    throw new Error(`"${key}" supera la lunghezza massima consentita.`);
  }
  return trimmed;
}

function parseRequiredString(
  record: Record<string, unknown>,
  key: string,
  max: number,
  allowEmpty: boolean,
): string {
  if (!(key in record)) {
    throw new Error(`Campo obbligatorio mancante: ${key}`);
  }
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`Valore non valido per "${key}".`);
  }
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) {
    throw new Error(`"${key}" non può essere vuoto.`);
  }
  if (trimmed.length > max) {
    throw new Error(`"${key}" supera la lunghezza massima consentita.`);
  }
  return trimmed;
}

/**
 * Strict parser for company profile text fields.
 * Rejects unknown properties. legalName may be empty until the user fills it.
 */
export function parseCompanyProfileFields(input: unknown): CompanyProfileFields {
  if (!isPlainObject(input)) {
    throw new Error("Il profilo aziendale deve essere un oggetto.");
  }
  for (const key of Object.keys(input)) {
    if (!FIELD_KEYS.has(key)) {
      throw new Error(`Proprietà non consentita: ${key}`);
    }
  }
  for (const key of FIELD_KEYS) {
    if (!(key in input)) {
      throw new Error(`Campo obbligatorio mancante: ${key}`);
    }
  }

  const legalName = parseRequiredString(
    input,
    "legalName",
    COMPANY_FIELD_LIMITS.legalName,
    true,
  );
  const email = parseOptionalText(input, "email", COMPANY_FIELD_LIMITS.email);
  if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Indirizzo email non valido.");
  }
  const website = parseOptionalText(
    input,
    "website",
    COMPANY_FIELD_LIMITS.website,
  );
  if (website !== null) {
    // Allow bare domains or http(s) URLs — reject obvious non-URLs with spaces.
    if (/\s/.test(website)) {
      throw new Error("Sito web non valido.");
    }
  }

  const countryRaw = parseRequiredString(
    input,
    "country",
    COMPANY_FIELD_LIMITS.country,
    true,
  );

  return {
    legalName,
    tradeName: parseOptionalText(
      input,
      "tradeName",
      COMPANY_FIELD_LIMITS.tradeName,
    ),
    address: parseOptionalText(input, "address", COMPANY_FIELD_LIMITS.address),
    postalCode: parseOptionalText(
      input,
      "postalCode",
      COMPANY_FIELD_LIMITS.postalCode,
    ),
    city: parseOptionalText(input, "city", COMPANY_FIELD_LIMITS.city),
    province: parseOptionalText(
      input,
      "province",
      COMPANY_FIELD_LIMITS.province,
    ),
    country: countryRaw.length > 0 ? countryRaw : "Italia",
    vatNumber: parseOptionalText(
      input,
      "vatNumber",
      COMPANY_FIELD_LIMITS.vatNumber,
    ),
    taxCode: parseOptionalText(input, "taxCode", COMPANY_FIELD_LIMITS.taxCode),
    email,
    phone: parseOptionalText(input, "phone", COMPANY_FIELD_LIMITS.phone),
    website,
    defaultQuoteTerms: parseOptionalText(
      input,
      "defaultQuoteTerms",
      COMPANY_FIELD_LIMITS.defaultQuoteTerms,
    ),
  };
}

export function isCompanyLogoMimeType(
  value: unknown,
): value is CompanyLogoMimeType {
  return (
    typeof value === "string" &&
    (COMPANY_LOGO_MIME_TYPES as readonly string[]).includes(value)
  );
}

export function parseCompanyLogoRecord(input: unknown): CompanyLogoRecord | null {
  if (input === null || input === undefined) {
    return null;
  }
  if (!isPlainObject(input)) {
    throw new Error("Logo aziendale non valido.");
  }
  const keys = Object.keys(input);
  for (const key of keys) {
    if (key !== "mimeType" && key !== "base64") {
      throw new Error(`Proprietà non consentita nel logo: ${key}`);
    }
  }
  if (!isCompanyLogoMimeType(input.mimeType)) {
    throw new Error("Formato logo non supportato.");
  }
  if (typeof input.base64 !== "string" || input.base64.length === 0) {
    throw new Error("Dati logo non validi.");
  }
  // Rough size check on base64 length (~4/3 of bytes).
  const approxBytes = Math.floor((input.base64.length * 3) / 4);
  if (approxBytes > COMPANY_LOGO_MAX_BYTES) {
    throw new Error("Il logo supera la dimensione massima consentita.");
  }
  return {
    mimeType: input.mimeType,
    base64: input.base64,
  };
}

export function buildLogoDataUrl(
  logo: CompanyLogoRecord | null,
): string | null {
  if (!logo) {
    return null;
  }
  return `data:${logo.mimeType};base64,${logo.base64}`;
}

export function toPublicCompanyProfile(
  fields: CompanyProfileFields,
  logo: CompanyLogoRecord | null,
): CompanyProfile {
  return {
    ...fields,
    hasLogo: logo !== null,
    logoMimeType: logo?.mimeType ?? null,
    logoDataUrl: buildLogoDataUrl(logo),
  };
}
