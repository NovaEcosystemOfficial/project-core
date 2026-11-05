import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import type Database from "better-sqlite3";
import { runMigrations } from "../electron/db/migrations.ts";
import { AppError, toIpcThrownError } from "../electron/errors/app-error.ts";
import {
  readBusinessSectorConfig,
  saveSelectedBusinessSector,
} from "../electron/repositories/business-sector-repository.ts";
import {
  findPartyById,
  insertParty,
} from "../electron/repositories/parties-repository.ts";
import {
  allocateQuoteNumber,
  findQuoteById,
  insertQuote,
} from "../electron/repositories/quotes-repository.ts";
import {
  backupOpenDatabaseToFile,
  restoreDatabaseFromValidatedFile,
  validateSqliteBackupFile,
  cleanupFile,
} from "../electron/services/database-backup-core.ts";
import { withTransaction } from "../electron/db/transactions.ts";
import {
  BUSINESS_SECTOR_SETTING_KEY,
  DEFAULT_BUSINESS_SECTOR_CONFIG,
  isBusinessSectorId,
  parseBusinessSectorConfig,
  parseBusinessSectorSelection,
  resolveEffectiveSectorId,
  TEMPORARY_SECTOR_ID,
  type BusinessSectorId,
} from "../shared/business-sector.ts";
import { tryParseDesktopErrorPayload } from "../shared/errors.ts";
import { computeQuoteDocument } from "../shared/quotes.ts";
import {
  APP_MODULES,
  listEnabledModules,
  listPlannedModulesForSector,
  resolveActiveModules,
  validateModuleDependencies,
  type ModuleId,
  type RegistryModuleId,
} from "../shared/modules.ts";

const require = createRequire(import.meta.url);
type BetterSqlite3Constructor = new (filename: string) => Database;
const BetterSqlite3 = require("better-sqlite3") as BetterSqlite3Constructor;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function openDb(filePath?: string): Database {
  const db = new BetterSqlite3(filePath ?? ":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

function assertCommonModules(ids: readonly string[]): void {
  for (const id of [
    "dashboard",
    "anagrafiche",
    "preventivi",
    "company",
    "diagnostics",
    "settings",
  ] as const) {
    assert(ids.includes(id), `common/core module missing: ${id}`);
  }
}

function testMissingConfigDefaults(): void {
  const db = openDb();
  const config = readBusinessSectorConfig(db);
  assert(config.configured === false, "unconfigured by default");
  assert(config.sectorId === null, "sectorId null when missing");
  assert(
    resolveEffectiveSectorId(config) === TEMPORARY_SECTOR_ID,
    "temporary general when unconfigured",
  );
  console.log("OK  missing config / temporary sector");
}

function testPersistAndReload(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-sector-"));
  const file = path.join(dir, "app.sqlite");
  const db = openDb(file);
  const saved = saveSelectedBusinessSector(db, "retail_commerce");
  assert(saved.configured === true, "configured after save");
  assert(saved.sectorId === "retail_commerce", "sector persisted");
  db.close();

  const reopened = new BetterSqlite3(file);
  reopened.pragma("foreign_keys = ON");
  const loaded = readBusinessSectorConfig(reopened);
  reopened.close();
  assert(loaded.sectorId === "retail_commerce", "reload sector");
  assert(loaded.configured === true, "reload configured");
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("OK  sector persistence across reopen");
}

function testIdentifierValidation(): void {
  assert(isBusinessSectorId("general_services"), "valid id");
  assert(!isBusinessSectorId("Generale"), "label is not id");
  assert(!isBusinessSectorId("warehouse"), "unknown id rejected");

  let threw = false;
  try {
    parseBusinessSectorSelection("not_a_sector");
  } catch {
    threw = true;
  }
  assert(threw, "invalid selection throws");

  threw = false;
  try {
    parseBusinessSectorConfig({ configured: true, sectorId: null });
  } catch {
    threw = true;
  }
  assert(threw, "configured without id rejected");

  threw = false;
  try {
    parseBusinessSectorConfig({
      configured: true,
      sectorId: "retail_commerce",
      extra: 1,
    });
  } catch {
    threw = true;
  }
  assert(threw, "extra props rejected");

  const ok = parseBusinessSectorConfig({
    configured: false,
    sectorId: null,
  });
  assert(ok.configured === false, "valid unconfigured parse");
  console.log("OK  identifier / payload validation");
}

function testCommonModulesAlwaysAvailable(): void {
  for (const sectorId of [
    "general_services",
    "warehouse_distribution",
    "textile_raw_materials",
    "retail_commerce",
    "workshop_service",
  ] as BusinessSectorId[]) {
    const enabled = listEnabledModules({ configured: true, sectorId });
    assertCommonModules(enabled.map((m) => m.id));
  }
  const unconfigured = listEnabledModules(DEFAULT_BUSINESS_SECTOR_CONFIG);
  assertCommonModules(unconfigured.map((m) => m.id));
  console.log("OK  common modules always available");
}

function testPlannedNotNavigable(): void {
  const warehouseEnabled = listEnabledModules({
    configured: true,
    sectorId: "warehouse_distribution",
  });
  assert(
    warehouseEnabled.some((m) => m.id === "magazzino"),
    "magazzino navigable for warehouse sector",
  );
  const generalEnabled = listEnabledModules({
    configured: true,
    sectorId: "general_services",
  });
  assert(
    !generalEnabled.some((m) => m.id === "magazzino"),
    "magazzino not navigable for general sector",
  );
  const planned = listPlannedModulesForSector({
    configured: true,
    sectorId: "warehouse_distribution",
  });
  assert(
    planned.some((m) => m.id === "articoli"),
    "planned listini still informational",
  );
  assert(
    !planned.some((m) => (m.id as string) === "magazzino"),
    "implemented magazzino not in planned list",
  );
  assert(
    !warehouseEnabled.some((m) => m.id === ("articoli" as ModuleId)),
    "planned articoli not in nav",
  );
  console.log("OK  planned sector modules not navigable");
}

/** Magazzino visibility for all five sectors — registry source of truth. */
function testSectorModuleMatrix(): void {
  const magazzinoSectors = new Set<BusinessSectorId>([
    "warehouse_distribution",
    "textile_raw_materials",
    "retail_commerce",
  ]);
  const noMagazzinoSectors = new Set<BusinessSectorId>([
    "general_services",
    "workshop_service",
  ]);

  for (const sectorId of [
    ...magazzinoSectors,
    ...noMagazzinoSectors,
  ] as BusinessSectorId[]) {
    const enabled = listEnabledModules({ configured: true, sectorId });
    const ids = enabled.map((m) => m.id);
    assertCommonModules(ids);
    const hasMagazzino = ids.includes("magazzino");
    const hasDdt = ids.includes("ddt");
    if (magazzinoSectors.has(sectorId)) {
      assert(hasMagazzino, `magazzino expected for ${sectorId}`);
      assert(hasDdt, `ddt expected for ${sectorId}`);
    } else {
      assert(!hasMagazzino, `magazzino must be hidden for ${sectorId}`);
      assert(!hasDdt, `ddt must be hidden for ${sectorId}`);
    }
    assert(
      !ids.some((id) =>
        [
          "articoli",
          "ordini_fornitore",
          "lavorazioni_tessili",
          "punto_vendita",
          "commesse_officina",
        ].includes(id),
      ),
      `no planned modules in nav for ${sectorId}`,
    );
  }

  const temporary = listEnabledModules(DEFAULT_BUSINESS_SECTOR_CONFIG);
  assert(
    resolveEffectiveSectorId(DEFAULT_BUSINESS_SECTOR_CONFIG) ===
      TEMPORARY_SECTOR_ID,
    "temporary sector is general_services",
  );
  assert(
    !temporary.some((m) => m.id === "magazzino"),
    "temporary unconfigured UI hides magazzino",
  );

  const magManifest = APP_MODULES.find((m) => m.id === "magazzino");
  assert(magManifest !== undefined, "magazzino in registry");
  assert(
    magManifest!.compatibleSectors.length === 3 &&
      magManifest!.compatibleSectors.every((s) => magazzinoSectors.has(s)),
    "registry magazzino sectors match matrix",
  );

  console.log("OK  five-sector module visibility matrix");
}

function testDependenciesValidAndMissing(): void {
  validateModuleDependencies(
    resolveActiveModules({
      configured: true,
      sectorId: "general_services",
    }).map((m) => m.id),
  );

  let threw = false;
  try {
    validateModuleDependencies(["preventivi"] as RegistryModuleId[]);
  } catch (error) {
    threw = error instanceof Error && error.message.includes("anagrafiche");
  }
  assert(threw, "missing dependency detected");

  validateModuleDependencies(APP_MODULES.map((m) => m.id));
  console.log("OK  dependency validation");
}

function testSectorChangeKeepsData(): void {
  const db = openDb();
  insertParty(db, "party-sector-1", {
    displayName: "Cliente settore",
    isCustomer: true,
    isSupplier: false,
    email: null,
    phone: null,
    address: null,
    taxCode: null,
    vatNumber: null,
    notes: null,
  });

  const computed = computeQuoteDocument([
    {
      description: "Servizio",
      quantity: "1",
      unit: null,
      unitPrice: "100.00",
      discountPercent: "0",
      vatRatePercent: "22",
    },
  ]);
  const number = withTransaction(db, (tx) => allocateQuoteNumber(tx, 2026));
  insertQuote(db, {
    id: "quote-sector-1",
    number,
    partyId: "party-sector-1",
    customer: {
      name: "Cliente settore",
      address: null,
      taxCode: null,
      vatNumber: null,
      email: null,
      phone: null,
    },
    issueDate: "2026-10-27",
    dueDate: null,
    notes: null,
    computed: {
      ...computed,
      items: computed.items.map((item, i) => ({
        ...item,
        id: `qi-${i}`,
      })),
    },
    itemIds: ["qi-0"],
  });

  saveSelectedBusinessSector(db, "general_services");
  saveSelectedBusinessSector(db, "workshop_service");

  assert(findPartyById(db, "party-sector-1")?.displayName === "Cliente settore", "party retained");
  assert(findQuoteById(db, "quote-sector-1")?.number === number, "quote retained");
  assert(
    readBusinessSectorConfig(db).sectorId === "workshop_service",
    "sector changed",
  );
  db.close();
  console.log("OK  sector change keeps anagrafiche/preventivi");
}

function testExistingDbWithoutSector(): void {
  const db = openDb();
  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(BUSINESS_SECTOR_SETTING_KEY);
  assert(row === undefined, "key absent on fresh migrate");
  const config = readBusinessSectorConfig(db);
  assert(config.configured === false, "legacy treated as unconfigured");
  assert(
    !listEnabledModules(config).some((m) => m.id === "magazzino"),
    "temporary general does not expose magazzino",
  );
  db.close();
  console.log("OK  existing DB without sector (safe transition)");
}

async function testBackupRestoreSector(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-sector-bak-"));
  const live = path.join(dir, "live.sqlite");
  const backup = path.join(dir, "backup.sqlite");
  const safety = path.join(dir, "safety.sqlite");

  let db = openDb(live);
  saveSelectedBusinessSector(db, "textile_raw_materials");
  await backupOpenDatabaseToFile(db, backup);
  validateSqliteBackupFile(backup);

  saveSelectedBusinessSector(db, "general_services");

  await restoreDatabaseFromValidatedFile({
    liveDbPath: live,
    sourceBackupPath: backup,
    safetyBackupPath: safety,
    closeLive: () => {
      db.close();
    },
    openLive: () => {
      db = openDb(live);
    },
    backupLiveWhileOpen: async (destinationPath) => {
      await backupOpenDatabaseToFile(db, destinationPath);
    },
  });

  const config = readBusinessSectorConfig(db);
  assert(config.sectorId === "textile_raw_materials", "sector in backup");
  assert(config.configured === true, "configured restored");
  db.close();
  cleanupFile(backup);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("OK  backup/restore sector settings");
}

function testInvalidIpcPayloadPublicError(): void {
  let caught: unknown;
  try {
    parseBusinessSectorSelection({ sectorId: "xxx" });
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof Error, "throws on bad ipc-like payload");
  const encoded = toIpcThrownError(
    AppError.validation(
      caught instanceof Error ? caught.message : "Selezione settore non valida.",
    ),
  );
  const payload = tryParseDesktopErrorPayload(encoded.message);
  assert(payload?.code === "VALIDATION_FAILED", "public validation code");
  assert(
    !encoded.message.includes("C:\\") && !encoded.message.includes("/Users/"),
    "no paths in error",
  );
  console.log("OK  invalid IPC payload encoding");
}

function testCorruptStoredSectorRejected(): void {
  const db = openDb();
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(
    BUSINESS_SECTOR_SETTING_KEY,
    JSON.stringify({ configured: true, sectorId: "bogus" }),
  );
  let threw = false;
  try {
    readBusinessSectorConfig(db);
  } catch {
    threw = true;
  }
  assert(threw, "corrupt stored sector rejected on read");
  db.close();
  console.log("OK  corrupt stored sector rejected");
}

async function main(): Promise<void> {
  testMissingConfigDefaults();
  testPersistAndReload();
  testIdentifierValidation();
  testCommonModulesAlwaysAvailable();
  testPlannedNotNavigable();
  testSectorModuleMatrix();
  testDependenciesValidAndMissing();
  testSectorChangeKeepsData();
  testExistingDbWithoutSector();
  await testBackupRestoreSector();
  testInvalidIpcPayloadPublicError();
  testCorruptStoredSectorRejected();
  console.log("\nAll sector tests passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
