import type { AppSettings } from "./app-settings.ts";
import type {
  ArticleCreateInput,
  ArticleDto,
  ArticleListQuery,
  ArticleListResult,
  ArticleUpdateInput,
} from "./articles.ts";
import type {
  ArticleStockDto,
  StockBalanceListQuery,
  StockBalanceListResult,
  StockMovementCreateInput,
  StockMovementDto,
  StockMovementListQuery,
  StockMovementListResult,
  WarehouseSummaryDto,
} from "./stock-movements.ts";
import type {
  BusinessSectorConfig,
  BusinessSectorId,
} from "./business-sector.ts";
import type {
  CompanyLogoSelectResult,
  CompanyProfile,
  CompanyProfileFields,
} from "./company-profile.ts";
import type {
  DatabaseBackupResult,
  DatabaseRestoreResult,
} from "./database-backup.ts";
import type {
  PublicModuleInfo,
  PublicPlannedModuleInfo,
} from "./modules.ts";
import type {
  PartiesCsvExportResult,
  PartyExportFilter,
} from "./parties-csv-export.ts";
import type {
  PartyCreateInput,
  PartyDto,
  PartyListQuery,
  PartyListResult,
  PartyUpdateInput,
} from "./parties.ts";
import type { QuotePdfExportResult } from "./quote-pdf.ts";
import type { QuotePrintResult } from "./quote-print.ts";
import type {
  QuoteDto,
  QuoteListQuery,
  QuoteListResult,
  QuoteStatusChangeInput,
  QuoteUpdateInput,
  QuoteWriteInput,
} from "./quotes.ts";
import type {
  SetupWizardProgressInput,
  SetupWizardState,
} from "./setup-wizard.ts";
import type {
  DdtCreateMissingArticlesInput,
  DdtDashboardDto,
  DdtDetailDto,
  DdtDocumentDto,
  DdtDocumentUpdateInput,
  DdtImportBatchResult,
  DdtListQuery,
  DdtListResult,
} from "./ddt.ts";
import type {
  DdtCsvExportResult,
  DdtOpenOriginalResult,
} from "./ddt-csv.ts";

/** IPC channel names — keep in sync between main and preload only. */
export const DESKTOP_CHANNELS = {
  getAppInfo: "desktop:getAppInfo",
  getDatabaseStatus: "desktop:getDatabaseStatus",
  listEnabledModules: "desktop:listEnabledModules",
  listPlannedModules: "desktop:listPlannedModules",
  getBusinessSectorConfig: "desktop:getBusinessSectorConfig",
  saveBusinessSector: "desktop:saveBusinessSector",
  getAppSettings: "desktop:getAppSettings",
  saveAppSettings: "desktop:saveAppSettings",
  createDatabaseBackup: "desktop:createDatabaseBackup",
  restoreDatabaseBackup: "desktop:restoreDatabaseBackup",
  listParties: "desktop:listParties",
  getParty: "desktop:getParty",
  createParty: "desktop:createParty",
  updateParty: "desktop:updateParty",
  archiveParty: "desktop:archiveParty",
  reactivateParty: "desktop:reactivateParty",
  exportPartiesCsv: "desktop:exportPartiesCsv",
  listQuotes: "desktop:listQuotes",
  getQuote: "desktop:getQuote",
  createQuote: "desktop:createQuote",
  updateQuote: "desktop:updateQuote",
  changeQuoteStatus: "desktop:changeQuoteStatus",
  archiveQuote: "desktop:archiveQuote",
  reactivateQuote: "desktop:reactivateQuote",
  listQuoteCustomerOptions: "desktop:listQuoteCustomerOptions",
  printQuote: "desktop:printQuote",
  exportQuotePdf: "desktop:exportQuotePdf",
  getCompanyProfile: "desktop:getCompanyProfile",
  saveCompanyProfile: "desktop:saveCompanyProfile",
  selectCompanyLogo: "desktop:selectCompanyLogo",
  removeCompanyLogo: "desktop:removeCompanyLogo",
  listArticles: "desktop:listArticles",
  getArticle: "desktop:getArticle",
  createArticle: "desktop:createArticle",
  updateArticle: "desktop:updateArticle",
  archiveArticle: "desktop:archiveArticle",
  reactivateArticle: "desktop:reactivateArticle",
  createStockMovement: "desktop:createStockMovement",
  listStockMovements: "desktop:listStockMovements",
  listStockBalances: "desktop:listStockBalances",
  getArticleStock: "desktop:getArticleStock",
  getWarehouseSummary: "desktop:getWarehouseSummary",
  getSetupWizardState: "desktop:getSetupWizardState",
  saveSetupWizardProgress: "desktop:saveSetupWizardProgress",
  completeSetupWizard: "desktop:completeSetupWizard",
  getDdtDashboard: "desktop:getDdtDashboard",
  listDdtDocuments: "desktop:listDdtDocuments",
  getDdtDetail: "desktop:getDdtDetail",
  importDdtFiles: "desktop:importDdtFiles",
  reprocessDdt: "desktop:reprocessDdt",
  saveDdtReview: "desktop:saveDdtReview",
  createMissingDdtArticles: "desktop:createMissingDdtArticles",
  reassociateDdtArticles: "desktop:reassociateDdtArticles",
  registerDdt: "desktop:registerDdt",
  cancelDdt: "desktop:cancelDdt",
  exportDdtArchiveCsv: "desktop:exportDdtArchiveCsv",
  exportDdtLinesCsv: "desktop:exportDdtLinesCsv",
  openDdtOriginal: "desktop:openDdtOriginal",
} as const;

/** Non-sensitive desktop identity exposed to the renderer. */
export type DesktopAppInfo = {
  appName: string;
  version: string;
  platform: string;
  isDesktop: true;
};

/**
 * Safe DB health snapshot for the renderer.
 * Must never include file paths, SQL, or stack traces.
 */
export type DesktopDatabaseStatus = {
  initialized: boolean;
  schemaVersion: number;
  healthy: boolean;
};

export type QuoteCustomerOption = {
  id: string;
  displayName: string;
};

/**
 * Controlled API surface on `window.desktopAPI`.
 * ipcRenderer is never exposed; only typed methods are.
 */
export type DesktopAPI = {
  getAppInfo: () => Promise<DesktopAppInfo>;
  getDatabaseStatus: () => Promise<DesktopDatabaseStatus>;
  listEnabledModules: () => Promise<PublicModuleInfo[]>;
  listPlannedModules: () => Promise<PublicPlannedModuleInfo[]>;
  getBusinessSectorConfig: () => Promise<BusinessSectorConfig>;
  saveBusinessSector: (sectorId: BusinessSectorId) => Promise<BusinessSectorConfig>;
  getAppSettings: () => Promise<AppSettings>;
  saveAppSettings: (settings: AppSettings) => Promise<AppSettings>;
  createDatabaseBackup: () => Promise<DatabaseBackupResult>;
  restoreDatabaseBackup: () => Promise<DatabaseRestoreResult>;
  listParties: (query?: PartyListQuery) => Promise<PartyListResult>;
  getParty: (id: string) => Promise<PartyDto>;
  createParty: (input: PartyCreateInput) => Promise<PartyDto>;
  updateParty: (input: PartyUpdateInput) => Promise<PartyDto>;
  archiveParty: (id: string) => Promise<PartyDto>;
  reactivateParty: (id: string) => Promise<PartyDto>;
  exportPartiesCsv: (filter: PartyExportFilter) => Promise<PartiesCsvExportResult>;
  listQuotes: (query?: QuoteListQuery) => Promise<QuoteListResult>;
  getQuote: (id: string) => Promise<QuoteDto>;
  createQuote: (input: QuoteWriteInput) => Promise<QuoteDto>;
  updateQuote: (input: QuoteUpdateInput) => Promise<QuoteDto>;
  changeQuoteStatus: (input: QuoteStatusChangeInput) => Promise<QuoteDto>;
  archiveQuote: (id: string) => Promise<QuoteDto>;
  reactivateQuote: (id: string) => Promise<QuoteDto>;
  listQuoteCustomerOptions: (input?: {
    search?: string;
  }) => Promise<QuoteCustomerOption[]>;
  printQuote: (id: string) => Promise<QuotePrintResult>;
  exportQuotePdf: (id: string) => Promise<QuotePdfExportResult>;
  getCompanyProfile: () => Promise<CompanyProfile>;
  saveCompanyProfile: (fields: CompanyProfileFields) => Promise<CompanyProfile>;
  selectCompanyLogo: () => Promise<CompanyLogoSelectResult>;
  removeCompanyLogo: () => Promise<CompanyProfile>;
  listArticles: (query?: ArticleListQuery) => Promise<ArticleListResult>;
  getArticle: (id: string) => Promise<ArticleDto>;
  createArticle: (input: ArticleCreateInput) => Promise<ArticleDto>;
  updateArticle: (input: ArticleUpdateInput) => Promise<ArticleDto>;
  archiveArticle: (id: string) => Promise<ArticleDto>;
  reactivateArticle: (id: string) => Promise<ArticleDto>;
  createStockMovement: (
    input: StockMovementCreateInput,
  ) => Promise<StockMovementDto>;
  listStockMovements: (
    query?: StockMovementListQuery,
  ) => Promise<StockMovementListResult>;
  listStockBalances: (
    query?: StockBalanceListQuery,
  ) => Promise<StockBalanceListResult>;
  getArticleStock: (articleId: string) => Promise<ArticleStockDto>;
  getWarehouseSummary: () => Promise<WarehouseSummaryDto>;
  getSetupWizardState: () => Promise<SetupWizardState>;
  saveSetupWizardProgress: (
    input: SetupWizardProgressInput,
  ) => Promise<SetupWizardState>;
  completeSetupWizard: () => Promise<SetupWizardState>;
  getDdtDashboard: () => Promise<DdtDashboardDto>;
  listDdtDocuments: (query?: DdtListQuery) => Promise<DdtListResult>;
  getDdtDetail: (id: string) => Promise<DdtDetailDto>;
  importDdtFiles: () => Promise<DdtImportBatchResult>;
  reprocessDdt: (id: string) => Promise<DdtDetailDto>;
  saveDdtReview: (input: DdtDocumentUpdateInput) => Promise<DdtDetailDto>;
  createMissingDdtArticles: (
    input: DdtCreateMissingArticlesInput,
  ) => Promise<DdtDetailDto>;
  reassociateDdtArticles: (id: string) => Promise<DdtDetailDto>;
  registerDdt: (id: string) => Promise<DdtDetailDto>;
  cancelDdt: (id: string) => Promise<DdtDocumentDto>;
  exportDdtArchiveCsv: (query?: DdtListQuery) => Promise<DdtCsvExportResult>;
  exportDdtLinesCsv: (query?: DdtListQuery) => Promise<DdtCsvExportResult>;
  openDdtOriginal: (id: string) => Promise<DdtOpenOriginalResult>;
};

export type {
  AppSettings,
  ArticleCreateInput,
  ArticleDto,
  ArticleListQuery,
  ArticleListResult,
  ArticleStockDto,
  ArticleUpdateInput,
  BusinessSectorConfig,
  BusinessSectorId,
  CompanyLogoSelectResult,
  CompanyProfile,
  CompanyProfileFields,
  DatabaseBackupResult,
  DatabaseRestoreResult,
  PartiesCsvExportResult,
  PartyCreateInput,
  PartyDto,
  PartyExportFilter,
  PartyListQuery,
  PartyListResult,
  PartyUpdateInput,
  PublicModuleInfo,
  PublicPlannedModuleInfo,
  QuoteDto,
  QuoteListQuery,
  QuoteListResult,
  QuotePdfExportResult,
  QuotePrintResult,
  QuoteStatusChangeInput,
  QuoteUpdateInput,
  QuoteWriteInput,
  StockBalanceListQuery,
  StockBalanceListResult,
  StockMovementCreateInput,
  StockMovementDto,
  StockMovementListQuery,
  StockMovementListResult,
  SetupWizardProgressInput,
  SetupWizardState,
  DdtCreateMissingArticlesInput,
  DdtDashboardDto,
  DdtDetailDto,
  DdtDocumentDto,
  DdtDocumentUpdateInput,
  DdtImportBatchResult,
  DdtListQuery,
  DdtListResult,
  DdtCsvExportResult,
  DdtOpenOriginalResult,
  WarehouseSummaryDto,
};
