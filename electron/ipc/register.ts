import { app, ipcMain } from "electron";
import { getInternalDatabaseStatus } from "../db/connection.ts";
import {
  getEnabledModulesForRenderer,
  getPlannedModulesForRenderer,
} from "../modules/registry.ts";
import {
  getAppSettings,
  saveAppSettings,
} from "../services/app-settings-service.ts";
import {
  archiveArticleForApp,
  createArticleForApp,
  getArticleForApp,
  listArticlesForApp,
  reactivateArticleForApp,
  updateArticleForApp,
} from "../services/articles-service.ts";
import {
  createStockMovementForApp,
  getArticleStockForApp,
  getWarehouseSummaryForApp,
  listStockBalancesForApp,
  listStockMovementsForApp,
} from "../services/stock-movements-service.ts";
import {
  getBusinessSectorConfig,
  saveBusinessSector,
} from "../services/business-sector-service.ts";
import {
  getCompanyProfile,
  removeCompanyLogo,
  saveCompanyProfile,
  selectCompanyLogo,
} from "../services/company-profile-service.ts";
import {
  createDatabaseBackup,
  restoreDatabaseBackup,
} from "../services/database-backup-service.ts";
import {
  completeSetupWizard,
  getSetupWizardState,
  saveSetupWizardProgress,
} from "../services/setup-wizard-service.ts";
import {
  cancelDdtForApp,
  createMissingDdtArticlesForApp,
  getDdtDashboardForApp,
  getDdtDetailForApp,
  importDdtFilesForApp,
  listDdtDocumentsForApp,
  reassociateDdtArticlesForApp,
  registerDdtForApp,
  reprocessDdtForApp,
  saveDdtReviewForApp,
} from "../services/ddt-service.ts";
import {
  exportDdtArchiveCsv,
  exportDdtLinesCsv,
  openDdtOriginal,
} from "../services/ddt-export-service.ts";
import { exportPartiesCsv } from "../services/parties-export-service.ts";
import {
  archivePartyForApp,
  createPartyForApp,
  getPartyForApp,
  listPartiesForApp,
  reactivatePartyForApp,
  updatePartyForApp,
} from "../services/parties-service.ts";
import { exportQuotePdf } from "../services/quotes-pdf-service.ts";
import { printQuoteDocument } from "../services/quotes-print-service.ts";
import {
  archiveQuoteForApp,
  changeQuoteStatusForApp,
  createQuoteForApp,
  getQuoteForApp,
  listQuoteCustomerOptions,
  listQuotesForApp,
  reactivateQuoteForApp,
  updateQuoteForApp,
} from "../services/quotes-service.ts";
import { APP_TECHNICAL_NAME } from "../../shared/modules.ts";
import {
  DESKTOP_CHANNELS,
  type DesktopAppInfo,
  type DesktopDatabaseStatus,
  type PublicModuleInfo,
} from "../../shared/desktop-api.ts";
import { handleIpc } from "./handle.ts";

const toPublicDatabaseStatus = (): DesktopDatabaseStatus => {
  const status = getInternalDatabaseStatus();
  return {
    initialized: status.initialized,
    schemaVersion: status.schemaVersion,
    healthy: status.healthy,
  };
};

/**
 * Registers desktop handlers.
 * Diagnostic handlers keep local fallbacks. Settings use handleIpc for AppError.
 */
export function registerIpcHandlers(): void {
  ipcMain.handle(DESKTOP_CHANNELS.getAppInfo, (): DesktopAppInfo => ({
    appName: APP_TECHNICAL_NAME,
    version: app.getVersion(),
    platform: process.platform,
    isDesktop: true,
  }));

  ipcMain.handle(
    DESKTOP_CHANNELS.getDatabaseStatus,
    (): DesktopDatabaseStatus => {
      try {
        return toPublicDatabaseStatus();
      } catch {
        return {
          initialized: false,
          schemaVersion: 0,
          healthy: false,
        };
      }
    },
  );

  ipcMain.handle(
    DESKTOP_CHANNELS.listEnabledModules,
    (): PublicModuleInfo[] => {
      try {
        return getEnabledModulesForRenderer();
      } catch {
        return [];
      }
    },
  );

  ipcMain.handle(DESKTOP_CHANNELS.listPlannedModules, () => {
    try {
      return getPlannedModulesForRenderer();
    } catch {
      return [];
    }
  });

  handleIpc(DESKTOP_CHANNELS.getBusinessSectorConfig, () =>
    getBusinessSectorConfig(),
  );

  handleIpc(DESKTOP_CHANNELS.saveBusinessSector, (_event, input: unknown) =>
    saveBusinessSector(input),
  );

  handleIpc(DESKTOP_CHANNELS.getAppSettings, () => getAppSettings());

  handleIpc(DESKTOP_CHANNELS.saveAppSettings, (_event, input: unknown) =>
    saveAppSettings(input),
  );

  handleIpc(DESKTOP_CHANNELS.createDatabaseBackup, () => createDatabaseBackup());

  handleIpc(DESKTOP_CHANNELS.restoreDatabaseBackup, () =>
    restoreDatabaseBackup(),
  );

  handleIpc(DESKTOP_CHANNELS.listParties, (_event, input: unknown) =>
    listPartiesForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.getParty, (_event, input: unknown) =>
    getPartyForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.createParty, (_event, input: unknown) =>
    createPartyForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.updateParty, (_event, input: unknown) =>
    updatePartyForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.archiveParty, (_event, input: unknown) =>
    archivePartyForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.reactivateParty, (_event, input: unknown) =>
    reactivatePartyForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.exportPartiesCsv, (_event, input: unknown) =>
    exportPartiesCsv(input),
  );

  handleIpc(DESKTOP_CHANNELS.listQuotes, (_event, input: unknown) =>
    listQuotesForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.getQuote, (_event, input: unknown) =>
    getQuoteForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.createQuote, (_event, input: unknown) =>
    createQuoteForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.updateQuote, (_event, input: unknown) =>
    updateQuoteForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.changeQuoteStatus, (_event, input: unknown) =>
    changeQuoteStatusForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.archiveQuote, (_event, input: unknown) =>
    archiveQuoteForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.reactivateQuote, (_event, input: unknown) =>
    reactivateQuoteForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.listQuoteCustomerOptions, (_event, input: unknown) =>
    listQuoteCustomerOptions(input),
  );

  handleIpc(DESKTOP_CHANNELS.printQuote, (_event, input: unknown) =>
    printQuoteDocument(input),
  );

  handleIpc(DESKTOP_CHANNELS.exportQuotePdf, (_event, input: unknown) =>
    exportQuotePdf(input),
  );

  handleIpc(DESKTOP_CHANNELS.getCompanyProfile, () => getCompanyProfile());

  handleIpc(DESKTOP_CHANNELS.saveCompanyProfile, (_event, input: unknown) =>
    saveCompanyProfile(input),
  );

  handleIpc(DESKTOP_CHANNELS.selectCompanyLogo, () => selectCompanyLogo());

  handleIpc(DESKTOP_CHANNELS.removeCompanyLogo, () => removeCompanyLogo());

  handleIpc(DESKTOP_CHANNELS.listArticles, (_event, input: unknown) =>
    listArticlesForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.getArticle, (_event, input: unknown) =>
    getArticleForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.createArticle, (_event, input: unknown) =>
    createArticleForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.updateArticle, (_event, input: unknown) =>
    updateArticleForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.archiveArticle, (_event, input: unknown) =>
    archiveArticleForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.reactivateArticle, (_event, input: unknown) =>
    reactivateArticleForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.createStockMovement, (_event, input: unknown) =>
    createStockMovementForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.listStockMovements, (_event, input: unknown) =>
    listStockMovementsForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.listStockBalances, (_event, input: unknown) =>
    listStockBalancesForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.getArticleStock, (_event, input: unknown) =>
    getArticleStockForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.getWarehouseSummary, () =>
    getWarehouseSummaryForApp(),
  );

  handleIpc(DESKTOP_CHANNELS.getSetupWizardState, () => getSetupWizardState());

  handleIpc(DESKTOP_CHANNELS.saveSetupWizardProgress, (_event, input: unknown) =>
    saveSetupWizardProgress(input),
  );

  handleIpc(DESKTOP_CHANNELS.completeSetupWizard, () => completeSetupWizard());

  handleIpc(DESKTOP_CHANNELS.getDdtDashboard, () => getDdtDashboardForApp());

  handleIpc(DESKTOP_CHANNELS.listDdtDocuments, (_event, input: unknown) =>
    listDdtDocumentsForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.getDdtDetail, (_event, input: unknown) =>
    getDdtDetailForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.importDdtFiles, () => importDdtFilesForApp());

  handleIpc(DESKTOP_CHANNELS.reprocessDdt, (_event, input: unknown) =>
    reprocessDdtForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.saveDdtReview, (_event, input: unknown) =>
    saveDdtReviewForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.createMissingDdtArticles, (_event, input: unknown) =>
    createMissingDdtArticlesForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.reassociateDdtArticles, (_event, input: unknown) =>
    reassociateDdtArticlesForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.registerDdt, (_event, input: unknown) =>
    registerDdtForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.cancelDdt, (_event, input: unknown) =>
    cancelDdtForApp(input),
  );

  handleIpc(DESKTOP_CHANNELS.exportDdtArchiveCsv, (_event, input: unknown) =>
    exportDdtArchiveCsv(input),
  );

  handleIpc(DESKTOP_CHANNELS.exportDdtLinesCsv, (_event, input: unknown) =>
    exportDdtLinesCsv(input),
  );

  handleIpc(DESKTOP_CHANNELS.openDdtOriginal, (_event, input: unknown) =>
    openDdtOriginal(input),
  );
}
