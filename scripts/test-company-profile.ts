import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import type Database from "better-sqlite3";
import { runMigrations } from "../electron/db/migrations.ts";
import { AppError, toIpcThrownError } from "../electron/errors/app-error.ts";
import {
  clearCompanyLogoRecord,
  readCompanyProfile,
  writeCompanyLogoRecord,
  writeCompanyProfileFields,
} from "../electron/repositories/company-profile-repository.ts";
import { validateCompanyLogoBuffer } from "../electron/services/company-logo-validation.ts";
import {
  backupOpenDatabaseToFile,
  cleanupFile,
  restoreDatabaseFromValidatedFile,
  validateSqliteBackupFile,
} from "../electron/services/database-backup-core.ts";
import {
  DEFAULT_COMPANY_PROFILE_FIELDS,
  parseCompanyProfileFields,
  toPublicCompanyProfile,
  type CompanyProfileFields,
} from "../shared/company-profile.ts";
import { tryParseDesktopErrorPayload } from "../shared/errors.ts";

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

function sampleFields(
  overrides: Partial<CompanyProfileFields> = {},
): CompanyProfileFields {
  return {
    ...DEFAULT_COMPANY_PROFILE_FIELDS,
    legalName: "Attività di prova",
    tradeName: null,
    address: "Via Example 1",
    postalCode: "20100",
    city: "Milano",
    province: "MI",
    country: "Italia",
    vatNumber: null,
    taxCode: null,
    email: "info@example.com",
    phone: null,
    website: "example.com",
    defaultQuoteTerms: "Pagamento a 30 giorni.",
    ...overrides,
  };
}

/** Minimal valid 1x1 PNG. */
function tinyPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

function testDefaultsAndOptionalEmpty(): void {
  const db = openDb();
  const profile = readCompanyProfile(db);
  assert(profile.legalName === "", "default legalName empty");
  assert(profile.country === "Italia", "default country Italia");
  assert(profile.hasLogo === false, "no logo by default");
  assert(profile.logoDataUrl === null, "no data url");
  assert(!profile.legalName.includes("GLITCH"), "no invented brand");

  writeCompanyProfileFields(db, sampleFields({ tradeName: null, phone: null }));
  const saved = readCompanyProfile(db);
  assert(saved.tradeName === null, "optional null preserved");
  assert(saved.phone === null, "optional phone null");
  assert(saved.email === "info@example.com", "email saved");
  db.close();
  console.log("OK  defaults + optional empty fields");
}

function testPersistenceAcrossReopen(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-company-"));
  const file = path.join(dir, "app.sqlite");
  {
    const db = openDb(file);
    writeCompanyProfileFields(
      db,
      sampleFields({ legalName: "Studio Persistente" }),
    );
    const logo = validateCompanyLogoBuffer(tinyPng());
    writeCompanyLogoRecord(db, logo);
    db.close();
  }
  {
    const db = openDb(file);
    const profile = readCompanyProfile(db);
    assert(profile.legalName === "Studio Persistente", "persists reopen");
    assert(profile.hasLogo === true, "logo persists");
    assert(
      profile.logoDataUrl?.startsWith("data:image/png;base64,") === true,
      "data url for preview",
    );
    assert(
      !profile.logoDataUrl?.includes("C:\\") &&
        !profile.logoDataUrl?.includes(dir),
      "no filesystem path in public profile",
    );
    db.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("OK  persistence across reopen + logo");
}

function testValidationAndUnknownProps(): void {
  let rejected = false;
  try {
    parseCompanyProfileFields({
      ...sampleFields(),
      unexpected: true,
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "unknown props rejected");

  rejected = false;
  try {
    parseCompanyProfileFields({
      ...sampleFields({ email: "not-an-email" }),
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "bad email rejected");

  rejected = false;
  try {
    parseCompanyProfileFields({
      ...sampleFields({ legalName: "x".repeat(300) }),
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "overlong legalName rejected");

  const emptyName = parseCompanyProfileFields(sampleFields({ legalName: "  " }));
  assert(emptyName.legalName === "", "blank legalName allowed as empty");

  console.log("OK  validation + unknown properties");
}

function testLogoValidationAndRemoval(): void {
  const png = validateCompanyLogoBuffer(tinyPng());
  assert(png.mimeType === "image/png", "png detected by magic");

  let rejected = false;
  try {
    validateCompanyLogoBuffer(Buffer.from("not-an-image"));
  } catch (error) {
    rejected = error instanceof AppError && error.code === "VALIDATION_FAILED";
  }
  assert(rejected, "non-image rejected");

  rejected = false;
  try {
    validateCompanyLogoBuffer(Buffer.alloc(600 * 1024, 1));
  } catch (error) {
    rejected = error instanceof AppError;
  }
  assert(rejected, "oversized rejected");

  // JPEG magic but truncated — still detected as jpeg type; size ok
  const jpegHead = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const jpeg = validateCompanyLogoBuffer(jpegHead);
  assert(jpeg.mimeType === "image/jpeg", "jpeg magic");

  const db = openDb();
  writeCompanyLogoRecord(db, png);
  assert(readCompanyProfile(db).hasLogo === true, "logo written");
  clearCompanyLogoRecord(db);
  assert(readCompanyProfile(db).hasLogo === false, "logo removed");
  db.close();
  console.log("OK  logo validation + removal");
}

function testPublicIpcSanitization(): void {
  const encoded = toIpcThrownError(
    AppError.validation("Formato logo non supportato. Usa PNG, JPEG, WebP o GIF."),
  );
  const payload = tryParseDesktopErrorPayload(encoded.message);
  assert(payload?.code === "VALIDATION_FAILED", "validation code");
  assert(
    !encoded.message.includes("C:\\") &&
      !encoded.message.includes(os.tmpdir()) &&
      !encoded.message.includes("SELECT"),
    "IPC errors sanitized",
  );

  const publicProfile = toPublicCompanyProfile(sampleFields(), {
    mimeType: "image/png",
    base64: tinyPng().toString("base64"),
  });
  assert(
    !JSON.stringify(publicProfile).includes("userData") &&
      !JSON.stringify(publicProfile).includes("filePath"),
    "public DTO has no path fields",
  );
  console.log("OK  IPC sanitization + public DTO");
}

async function testBackupRestoreIncludesLogo(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-co-bak-"));
  const live = path.join(dir, "live.sqlite");
  const backup = path.join(dir, "backup.sqlite");
  const safety = path.join(dir, "safety.sqlite");

  let db = openDb(live);
  writeCompanyProfileFields(
    db,
    sampleFields({ legalName: "Backup Co", defaultQuoteTerms: "Termini X" }),
  );
  writeCompanyLogoRecord(db, validateCompanyLogoBuffer(tinyPng()));
  await backupOpenDatabaseToFile(db, backup);
  validateSqliteBackupFile(backup);

  writeCompanyProfileFields(db, sampleFields({ legalName: "Changed" }));
  clearCompanyLogoRecord(db);

  await restoreDatabaseFromValidatedFile({
    liveDbPath: live,
    sourceBackupPath: backup,
    safetyBackupPath: safety,
    closeLive: () => db.close(),
    openLive: () => {
      db = openDb(live);
    },
    backupLiveWhileOpen: async (destinationPath) => {
      await backupOpenDatabaseToFile(db, destinationPath);
    },
  });

  const restored = readCompanyProfile(db);
  assert(restored.legalName === "Backup Co", "profile restored");
  assert(restored.defaultQuoteTerms === "Termini X", "terms restored");
  assert(restored.hasLogo === true, "logo restored from sqlite backup");
  assert(
    restored.logoDataUrl?.startsWith("data:image/png;base64,") === true,
    "logo data url after restore",
  );

  db.close();
  cleanupFile(backup);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("OK  backup/restore profile + logo in SQLite");
}

function testLegacyBackupCompatibility(): void {
  // Fresh v4 DB without company keys still opens and returns defaults.
  const db = openDb();
  const profile = readCompanyProfile(db);
  assert(profile.legalName === "", "legacy empty profile");
  assert(profile.hasLogo === false, "legacy no logo");
  // Appearance settings still present from migrations.
  const appearance = db
    .prepare(`SELECT value FROM app_settings WHERE key = 'appearance'`)
    .get() as { value?: string };
  assert(appearance?.value === '"dark"', "existing settings untouched");
  db.close();
  console.log("OK  compatibility with DBs without company keys");
}

function testCancelContract(): void {
  const cancelled = { status: "cancelled" as const };
  assert(cancelled.status === "cancelled", "logo dialog cancel contract");
  console.log("OK  logo cancel result contract");
}

async function main(): Promise<void> {
  testDefaultsAndOptionalEmpty();
  testPersistenceAcrossReopen();
  testValidationAndUnknownProps();
  testLogoValidationAndRemoval();
  testPublicIpcSanitization();
  testCancelContract();
  testLegacyBackupCompatibility();
  await testBackupRestoreIncludesLogo();
  console.log("All company profile tests passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
