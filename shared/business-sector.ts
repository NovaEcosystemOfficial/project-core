/**
 * Business sector configuration.
 * Stable IDs are independent from UI labels (labels may change later).
 * Persisted in app_settings — not part of the company fiscal profile.
 */

export const BUSINESS_SECTOR_SETTING_KEY = "businessSectorConfig" as const;

export const BUSINESS_SECTOR_IDS = [
  "general_services",
  "warehouse_distribution",
  "textile_raw_materials",
  "retail_commerce",
  "workshop_service",
] as const;

export type BusinessSectorId = (typeof BUSINESS_SECTOR_IDS)[number];

export type BusinessSectorDefinition = {
  id: BusinessSectorId;
  /** Display label — may change without invalidating stored IDs. */
  label: string;
  description: string;
};

export const BUSINESS_SECTORS: readonly BusinessSectorDefinition[] = [
  {
    id: "general_services",
    label: "Generale / servizi",
    description: "Attività di servizi e uso generale senza magazzino dedicato.",
  },
  {
    id: "warehouse_distribution",
    label: "Magazzino e distribuzione",
    description: "Gestione scorte, carichi/scarichi e distribuzione (moduli futuri).",
  },
  {
    id: "textile_raw_materials",
    label: "Tessile e materie prime",
    description: "Materie prime e filiere tessili (moduli futuri).",
  },
  {
    id: "retail_commerce",
    label: "Commercio e negozi",
    description: "Punti vendita e commercio al dettaglio (moduli futuri).",
  },
  {
    id: "workshop_service",
    label: "Officine e assistenza",
    description: "Officine, riparazioni e assistenza tecnica (moduli futuri).",
  },
] as const;

/**
 * Persisted configuration.
 * `configured: false` means the user has not completed sector setup yet.
 * Existing databases without this key are treated as unconfigured.
 */
export type BusinessSectorConfig = {
  sectorId: BusinessSectorId | null;
  configured: boolean;
};

export const DEFAULT_BUSINESS_SECTOR_CONFIG: BusinessSectorConfig = {
  sectorId: null,
  configured: false,
};

/**
 * Temporary runtime posture when setup is skipped:
 * modules resolve as if `general_services` without writing a sector choice.
 */
export const TEMPORARY_SECTOR_ID: BusinessSectorId = "general_services";

export function isBusinessSectorId(value: unknown): value is BusinessSectorId {
  return (
    typeof value === "string" &&
    (BUSINESS_SECTOR_IDS as readonly string[]).includes(value)
  );
}

export function getBusinessSectorDefinition(
  id: BusinessSectorId,
): BusinessSectorDefinition {
  const found = BUSINESS_SECTORS.find((sector) => sector.id === id);
  if (!found) {
    throw new Error(`Settore sconosciuto: ${id}`);
  }
  return found;
}

export function parseBusinessSectorConfig(input: unknown): BusinessSectorConfig {
  if (input === null || input === undefined) {
    return { ...DEFAULT_BUSINESS_SECTOR_CONFIG };
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Configurazione settore non valida.");
  }
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "sectorId" && key !== "configured") {
      throw new Error(`Proprietà non consentita: ${key}`);
    }
  }
  if (!("configured" in record) || typeof record.configured !== "boolean") {
    throw new Error('Campo "configured" non valido.');
  }
  if (!("sectorId" in record)) {
    throw new Error('Campo "sectorId" mancante.');
  }
  if (record.sectorId !== null && !isBusinessSectorId(record.sectorId)) {
    throw new Error("Identificativo settore non valido.");
  }
  if (record.configured && record.sectorId === null) {
    throw new Error("Un settore configurato richiede un identificativo valido.");
  }
  return {
    sectorId: record.sectorId,
    configured: record.configured,
  };
}

/** Payload to complete or change sector setup (always sets configured=true). */
export function parseBusinessSectorSelection(input: unknown): BusinessSectorId {
  if (typeof input === "string") {
    if (!isBusinessSectorId(input)) {
      throw new Error("Identificativo settore non valido.");
    }
    return input;
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Selezione settore non valida.");
  }
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "sectorId") {
      throw new Error(`Proprietà non consentita: ${key}`);
    }
  }
  if (!isBusinessSectorId(record.sectorId)) {
    throw new Error("Identificativo settore non valido.");
  }
  return record.sectorId;
}

/** Effective sector used for module resolution. */
export function resolveEffectiveSectorId(
  config: BusinessSectorConfig,
): BusinessSectorId {
  if (config.configured && config.sectorId) {
    return config.sectorId;
  }
  return TEMPORARY_SECTOR_ID;
}
