import {
  resolveEffectiveSectorId,
  type BusinessSectorConfig,
  type BusinessSectorId,
} from "./business-sector.ts";

/** Technical / installer name — remains ProjectCore in this codebase. */
export const APP_TECHNICAL_NAME = "ProjectCore";

/**
 * Commercial product identity (UI).
 * Never auto-fill this into the company fiscal profile.
 */
export const PRODUCT_DISPLAY_NAME = "GLITCH Digital Studio";

/**
 * Modules that have a real page and IPC surface today.
 * Planned sector modules use separate IDs and never appear in navigation.
 */
export type ModuleId =
  | "dashboard"
  | "anagrafiche"
  | "preventivi"
  | "magazzino"
  | "ddt"
  | "company"
  | "diagnostics"
  | "settings";

/** Navigation group for sidebar layout (UI only). */
export type NavGroupId = "operations" | "system";

export const NAV_GROUP_LABELS: Record<NavGroupId, string> = {
  operations: "Area operativa",
  system: "Configurazione e sistema",
};

export function getNavGroupForModule(id: ModuleId): NavGroupId {
  if (id === "company" || id === "settings" || id === "diagnostics") {
    return "system";
  }
  return "operations";
}

export type PlannedModuleId =
  | "articoli"
  | "ordini_fornitore"
  | "lavorazioni_tessili"
  | "punto_vendita"
  | "commesse_officina";

export type RegistryModuleId = ModuleId | PlannedModuleId;

export type ModuleCategory = "core" | "common" | "sector";

export type ModuleImplementationStatus = "implemented" | "planned";

export type ModuleManifest = {
  id: RegistryModuleId;
  label: string;
  description: string;
  category: ModuleCategory;
  /** Empty array = available for every sector. */
  compatibleSectors: readonly BusinessSectorId[];
  /** Other registry module IDs that must be active/implemented. */
  dependencies: readonly RegistryModuleId[];
  implementationStatus: ModuleImplementationStatus;
  navOrder: number;
};

/** Public metadata safe to send to the renderer (navigation). */
export type PublicModuleInfo = {
  id: ModuleId;
  label: string;
  description: string;
  category: ModuleCategory;
};

/** Informative card for planned (not navigable) modules. */
export type PublicPlannedModuleInfo = {
  id: PlannedModuleId;
  label: string;
  description: string;
  category: ModuleCategory;
  compatibleSectors: readonly BusinessSectorId[];
};

const ALL_SECTORS: readonly BusinessSectorId[] = [
  "general_services",
  "warehouse_distribution",
  "textile_raw_materials",
  "retail_commerce",
  "workshop_service",
];

/**
 * Single static registry — no dynamic code loading.
 * Implemented modules are navigable; planned ones are informational only.
 */
export const APP_MODULES: readonly ModuleManifest[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Panoramica dell’applicazione e moduli disponibili.",
    category: "core",
    compatibleSectors: ALL_SECTORS,
    dependencies: [],
    implementationStatus: "implemented",
    navOrder: 10,
  },
  {
    id: "anagrafiche",
    label: "Anagrafiche",
    description: "Clienti e fornitori con schede anagrafiche riutilizzabili.",
    category: "common",
    compatibleSectors: ALL_SECTORS,
    dependencies: [],
    implementationStatus: "implemented",
    navOrder: 15,
  },
  {
    id: "preventivi",
    label: "Documenti commerciali",
    description:
      "Preventivi commerciali collegati alle anagrafiche clienti (modulo attuale: preventivi).",
    category: "common",
    compatibleSectors: ALL_SECTORS,
    dependencies: ["anagrafiche"],
    implementationStatus: "implemented",
    navOrder: 16,
  },
  {
    id: "magazzino",
    label: "Magazzino",
    description:
      "Catalogo articoli, movimenti e giacenze del magazzino unico aziendale.",
    category: "sector",
    compatibleSectors: [
      "warehouse_distribution",
      "textile_raw_materials",
      "retail_commerce",
    ],
    dependencies: [],
    implementationStatus: "implemented",
    navOrder: 17,
  },
  {
    id: "ddt",
    label: "DDT",
    description:
      "Importazione, verifica e registrazione documenti di trasporto sul magazzino.",
    category: "sector",
    compatibleSectors: [
      "warehouse_distribution",
      "textile_raw_materials",
      "retail_commerce",
    ],
    dependencies: ["magazzino"],
    implementationStatus: "implemented",
    navOrder: 18,
  },
  {
    id: "company",
    label: "Azienda",
    description: "Profilo aziendale, dati fiscali, sede e logo.",
    category: "core",
    compatibleSectors: ALL_SECTORS,
    dependencies: [],
    implementationStatus: "implemented",
    navOrder: 25,
  },
  {
    id: "settings",
    label: "Impostazioni",
    description: "Settore, aspetto, preferenze e backup del database.",
    category: "core",
    compatibleSectors: ALL_SECTORS,
    dependencies: [],
    implementationStatus: "implemented",
    navOrder: 30,
  },
  {
    id: "diagnostics",
    label: "Diagnostica",
    description: "Stato del bridge desktop e dello schema SQLite.",
    category: "core",
    compatibleSectors: ALL_SECTORS,
    dependencies: [],
    implementationStatus: "implemented",
    navOrder: 40,
  },
  // Planned sector modules — never navigable until implemented.
  {
    id: "articoli",
    label: "Listini e catalogo avanzato",
    description:
      "Estensioni listino sul catalogo magazzino (non ancora disponibile).",
    category: "sector",
    compatibleSectors: [
      "warehouse_distribution",
      "textile_raw_materials",
      "retail_commerce",
    ],
    dependencies: ["magazzino"],
    implementationStatus: "planned",
    navOrder: 110,
  },
  {
    id: "ordini_fornitore",
    label: "Ordini fornitore",
    description: "Approvvigionamento da fornitori (non ancora disponibile).",
    category: "sector",
    compatibleSectors: ["warehouse_distribution", "textile_raw_materials"],
    dependencies: ["anagrafiche", "magazzino"],
    implementationStatus: "planned",
    navOrder: 120,
  },
  {
    id: "lavorazioni_tessili",
    label: "Lavorazioni tessili",
    description: "Processi e lavorazioni tessili (non ancora disponibile).",
    category: "sector",
    compatibleSectors: ["textile_raw_materials"],
    dependencies: ["anagrafiche"],
    implementationStatus: "planned",
    navOrder: 130,
  },
  {
    id: "punto_vendita",
    label: "Punto vendita",
    description: "Vendita al banco e scontrini (non ancora disponibile).",
    category: "sector",
    compatibleSectors: ["retail_commerce"],
    dependencies: ["anagrafiche", "magazzino"],
    implementationStatus: "planned",
    navOrder: 140,
  },
  {
    id: "commesse_officina",
    label: "Commesse officina",
    description: "Interventi e commesse di assistenza (non ancora disponibile).",
    category: "sector",
    compatibleSectors: ["workshop_service"],
    dependencies: ["anagrafiche"],
    implementationStatus: "planned",
    navOrder: 150,
  },
] as const;

export function getModuleById(
  id: RegistryModuleId,
): ModuleManifest | undefined {
  return APP_MODULES.find((module) => module.id === id);
}

export function isImplementedModuleId(id: string): id is ModuleId {
  const module = APP_MODULES.find((item) => item.id === id);
  return module?.implementationStatus === "implemented";
}

function isCompatibleWithSector(
  module: ModuleManifest,
  sectorId: BusinessSectorId,
): boolean {
  if (module.category === "core" || module.category === "common") {
    return true;
  }
  return module.compatibleSectors.includes(sectorId);
}

/**
 * Validates dependency graph for a candidate active set.
 * Throws on missing deps or cycles.
 */
export function validateModuleDependencies(
  activeIds: readonly RegistryModuleId[],
): void {
  const active = new Set(activeIds);
  const visiting = new Set<RegistryModuleId>();
  const visited = new Set<RegistryModuleId>();

  const visit = (id: RegistryModuleId): void => {
    if (visited.has(id)) {
      return;
    }
    if (visiting.has(id)) {
      throw new Error(`Dipendenza ciclica rilevata su "${id}".`);
    }
    const module = getModuleById(id);
    if (!module) {
      throw new Error(`Modulo sconosciuto: ${id}`);
    }
    visiting.add(id);
    for (const dep of module.dependencies) {
      if (!active.has(dep)) {
        throw new Error(
          `Il modulo "${id}" richiede la dipendenza attiva "${dep}".`,
        );
      }
      const depModule = getModuleById(dep);
      if (!depModule) {
        throw new Error(`Dipendenza sconosciuta: ${dep}`);
      }
      visit(dep);
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const id of activeIds) {
    visit(id);
  }
}

/**
 * Deterministic resolution of navigable modules from sector config.
 * Common/core modules stay available for every sector.
 * Planned modules are never returned for navigation.
 */
export function resolveActiveModules(
  config: BusinessSectorConfig,
): ModuleManifest[] {
  const sectorId = resolveEffectiveSectorId(config);
  const candidates = APP_MODULES.filter(
    (module) =>
      module.implementationStatus === "implemented" &&
      isCompatibleWithSector(module, sectorId),
  );

  // Ensure dependencies among implemented modules are satisfied.
  const ids = candidates.map((module) => module.id);
  validateModuleDependencies(ids);

  return candidates.slice().sort((a, b) => a.navOrder - b.navOrder);
}

export function toPublicModuleInfo(module: ModuleManifest): PublicModuleInfo {
  if (module.implementationStatus !== "implemented") {
    throw new Error("Solo i moduli implementati possono essere navigabili.");
  }
  return {
    id: module.id as ModuleId,
    label: module.label,
    description: module.description,
    category: module.category,
  };
}

export function listEnabledModules(
  config: BusinessSectorConfig = {
    sectorId: null,
    configured: false,
  },
): PublicModuleInfo[] {
  return resolveActiveModules(config).map(toPublicModuleInfo);
}

/**
 * Planned modules compatible with the effective sector (informational only).
 */
export function listPlannedModulesForSector(
  config: BusinessSectorConfig,
): PublicPlannedModuleInfo[] {
  const sectorId = resolveEffectiveSectorId(config);
  return APP_MODULES.filter(
    (module) =>
      module.implementationStatus === "planned" &&
      isCompatibleWithSector(module, sectorId),
  )
    .slice()
    .sort((a, b) => a.navOrder - b.navOrder)
    .map((module) => ({
      id: module.id as PlannedModuleId,
      label: module.label,
      description: module.description,
      category: module.category,
      compatibleSectors: module.compatibleSectors,
    }));
}
