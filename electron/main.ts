import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  closeDatabase,
  getDatabaseFilePath,
  openDatabase,
} from "./db/connection.ts";
import { registerIpcHandlers } from "./ipc/register.ts";
import type { DesktopDatabaseStatus } from "../shared/desktop-api.ts";
import { APP_TECHNICAL_NAME } from "../shared/modules.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Set by `dev:desktop` to the Vite URL. Absent → production `dist/index.html`. */
const rendererDevUrl = process.env.ELECTRON_RENDERER_URL;
const isSmokeTest = process.env.ELECTRON_SMOKE_TEST === "1";

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: APP_TECHNICAL_NAME,
    backgroundColor: "#0b1218",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (rendererDevUrl) {
    void mainWindow.loadURL(rendererDevUrl);
  } else {
    const indexHtml = path.join(__dirname, "../../dist/index.html");
    void mainWindow.loadFile(indexHtml);
  }

  if (isSmokeTest) {
    mainWindow.webContents.once("did-finish-load", () => {
      void mainWindow.webContents
        .executeJavaScript(
          `(() => {
            const root = document.getElementById("root");
            const mounted = Boolean(root && root.childElementCount > 0);
            const api = window.desktopAPI;
            if (
              !mounted ||
              !api?.getAppInfo ||
              !api?.getDatabaseStatus ||
              !api?.listEnabledModules ||
              !api?.listPlannedModules ||
              !api?.getBusinessSectorConfig ||
              !api?.saveBusinessSector ||
              !api?.getAppSettings ||
              !api?.saveAppSettings ||
              !api?.createDatabaseBackup ||
              !api?.restoreDatabaseBackup
            ) {
              return Promise.resolve({ ok: false, reason: "missing-mount-or-api" });
            }
            return Promise.all([
              api.getAppInfo(),
              api.getDatabaseStatus(),
              api.listEnabledModules(),
              api.getAppSettings(),
              api.getBusinessSectorConfig(),
              api.listPlannedModules(),
              api.getSetupWizardState(),
            ]).then(([info, db, modules, settings, sector, planned, wizard]) => {
              const keys = db && typeof db === "object" ? Object.keys(db).sort() : [];
              const pathLeaked = keys.some((key) =>
                /path|file|dir|sql|stack/i.test(key),
              );
              const moduleIdList = Array.isArray(modules)
                ? modules.map((module) => module?.id).filter(Boolean)
                : [];
              const moduleIds = moduleIdList.slice().sort().join(",");
              const requiredModules = [
                "anagrafiche",
                "company",
                "dashboard",
                "diagnostics",
                "preventivi",
                "settings",
              ];
              const hasRequiredModules = requiredModules.every((id) =>
                moduleIdList.includes(id),
              );
              const magazzinoSectors = [
                "warehouse_distribution",
                "textile_raw_materials",
                "retail_commerce",
              ];
              const expectMagazzino = Boolean(
                sector?.configured &&
                  sector.sectorId &&
                  magazzinoSectors.includes(sector.sectorId),
              );
              const hasMagazzino = moduleIdList.includes("magazzino");
              const shell = Boolean(
                document.querySelector("[data-testid='app-shell']") &&
                  document.querySelector("[data-testid='nav-dashboard']") &&
                  document.querySelector("[data-testid='nav-anagrafiche']") &&
                  document.querySelector("[data-testid='nav-preventivi']") &&
                  document.querySelector("[data-testid='nav-company']") &&
                  document.querySelector("[data-testid='nav-diagnostics']") &&
                  document.querySelector("[data-testid='nav-settings']"),
              );
              const settingsOk =
                (settings?.appearance === "dark" ||
                  settings?.appearance === "light") &&
                typeof settings?.accentColor === "string" &&
                typeof settings?.compactMode === "boolean";
              const backupApiOk =
                typeof api.createDatabaseBackup === "function" &&
                typeof api.restoreDatabaseBackup === "function";
              const partiesApiOk =
                typeof api.listParties === "function" &&
                typeof api.createParty === "function" &&
                typeof api.updateParty === "function" &&
                typeof api.archiveParty === "function" &&
                typeof api.reactivateParty === "function" &&
                typeof api.exportPartiesCsv === "function";
              const quotesApiOk =
                typeof api.listQuotes === "function" &&
                typeof api.createQuote === "function" &&
                typeof api.updateQuote === "function" &&
                typeof api.changeQuoteStatus === "function" &&
                typeof api.printQuote === "function" &&
                typeof api.exportQuotePdf === "function";
              const companyApiOk =
                typeof api.getCompanyProfile === "function" &&
                typeof api.saveCompanyProfile === "function" &&
                typeof api.selectCompanyLogo === "function" &&
                typeof api.removeCompanyLogo === "function";
              const sectorOk =
                sector &&
                typeof sector.configured === "boolean" &&
                (sector.sectorId === null || typeof sector.sectorId === "string") &&
                Array.isArray(planned) &&
                hasMagazzino === expectMagazzino;
              const wizardOk =
                wizard &&
                (wizard.status === "not_started" ||
                  wizard.status === "in_progress" ||
                  wizard.status === "completed") &&
                typeof wizard.currentStep === "number";
              return {
                ok:
                  info?.isDesktop === true &&
                  info?.appName === "ProjectCore" &&
                  typeof info?.version === "string" &&
                  typeof info?.platform === "string" &&
                  db?.initialized === true &&
                  db?.schemaVersion === 7 &&
                  db?.healthy === true &&
                  !pathLeaked &&
                  keys.join(",") === "healthy,initialized,schemaVersion" &&
                  hasRequiredModules &&
                  shell &&
                  settingsOk &&
                  backupApiOk &&
                  partiesApiOk &&
                  quotesApiOk &&
                  companyApiOk &&
                  sectorOk &&
                  wizardOk &&
                  typeof api.listArticles === "function" &&
                  typeof api.createArticle === "function" &&
                  typeof api.updateArticle === "function" &&
                  typeof api.archiveArticle === "function" &&
                  typeof api.reactivateArticle === "function" &&
                  typeof api.createStockMovement === "function" &&
                  typeof api.listStockMovements === "function" &&
                  typeof api.listStockBalances === "function" &&
                  typeof api.getArticleStock === "function" &&
                  typeof api.getWarehouseSummary === "function" &&
                  typeof api.getSetupWizardState === "function" &&
                  typeof api.saveSetupWizardProgress === "function" &&
                  typeof api.completeSetupWizard === "function" &&
                  typeof api.getDdtDashboard === "function" &&
                  typeof api.listDdtDocuments === "function" &&
                  typeof api.getDdtDetail === "function" &&
                  typeof api.importDdtFiles === "function" &&
                  typeof api.createMissingDdtArticles === "function" &&
                  typeof api.reassociateDdtArticles === "function" &&
                  typeof api.registerDdt === "function" &&
                  typeof api.exportDdtArchiveCsv === "function" &&
                  typeof api.openDdtOriginal === "function",
                db,
                keys,
                moduleIds,
                shell,
                settings,
              };
            });
          })()`,
        )
        .then(
          (result: {
            ok: boolean;
            reason?: string;
            db?: DesktopDatabaseStatus;
            keys?: string[];
            moduleIds?: string;
            shell?: boolean;
            settings?: unknown;
          }) => {
            if (!result?.ok) {
              console.error(
                "SMOKE_FAIL:",
                result?.reason ?? "desktop/database/modules/shell/settings check failed",
                {
                  db: result?.db,
                  keys: result?.keys,
                  moduleIds: result?.moduleIds,
                  shell: result?.shell,
                  settings: result?.settings,
                },
              );
              app.exit(1);
              return;
            }

            const userData = path.resolve(app.getPath("userData"));
            const dbPath = path.resolve(getDatabaseFilePath());
            const projectRoot = path.resolve(__dirname, "../..");
            const underUserData =
              dbPath === userData || dbPath.startsWith(userData + path.sep);
            const underProject =
              dbPath === projectRoot || dbPath.startsWith(projectRoot + path.sep);

            if (!underUserData || underProject) {
              console.error("SMOKE_FAIL: database path location invalid", {
                dbPath,
                userData,
                projectRoot,
              });
              app.exit(1);
              return;
            }

            // DB close is covered by unit tests and before-quit; avoid racing
            // late renderer getAppSettings calls during smoke shutdown.
            console.log(
              "SMOKE_OK: shell, modules, sector, setup wizard API, DDT API, articles/stock API, settings/backup/parties/csv/quotes/company/pdf API, sqlite schema v7, path isolated",
            );
            app.exit(0);
          },
        )
        .catch((error: unknown) => {
          console.error("SMOKE_FAIL:", error);
          app.exit(1);
        });
    });

    mainWindow.webContents.once("did-fail-load", (_event, code, description) => {
      console.error(`SMOKE_FAIL: load error ${code} ${description}`);
      app.exit(1);
    });
  }
};

app.whenReady().then(() => {
  try {
    openDatabase();
  } catch (error) {
    console.error("Failed to initialize database:", error);
    if (isSmokeTest) {
      app.exit(1);
      return;
    }
  }

  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  closeDatabase();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
