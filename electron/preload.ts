import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings } from "../shared/app-settings.ts";
import type {
  DatabaseBackupResult,
  DatabaseRestoreResult,
} from "../shared/database-backup.ts";
import {
  DESKTOP_CHANNELS,
  type ArticleCreateInput,
  type ArticleDto,
  type ArticleListQuery,
  type ArticleListResult,
  type ArticleStockDto,
  type ArticleUpdateInput,
  type StockBalanceListQuery,
  type StockBalanceListResult,
  type StockMovementCreateInput,
  type StockMovementDto,
  type StockMovementListQuery,
  type StockMovementListResult,
  type WarehouseSummaryDto,
  type CompanyLogoSelectResult,
  type CompanyProfile,
  type CompanyProfileFields,
  type DesktopAPI,
  type DesktopAppInfo,
  type DesktopDatabaseStatus,
  type PartiesCsvExportResult,
  type PartyCreateInput,
  type PartyDto,
  type PartyExportFilter,
  type PartyListQuery,
  type PartyListResult,
  type PartyUpdateInput,
  type BusinessSectorConfig,
  type BusinessSectorId,
  type PublicModuleInfo,
  type PublicPlannedModuleInfo,
  type QuoteCustomerOption,
  type QuoteDto,
  type QuoteListQuery,
  type QuoteListResult,
  type QuotePdfExportResult,
  type QuotePrintResult,
  type QuoteStatusChangeInput,
  type QuoteUpdateInput,
  type QuoteWriteInput,
  type SetupWizardProgressInput,
  type SetupWizardState,
  type DdtCsvExportResult,
  type DdtDashboardDto,
  type DdtOpenOriginalResult,
  type DdtCreateMissingArticlesInput,
  type DdtDetailDto,
  type DdtDocumentDto,
  type DdtDocumentUpdateInput,
  type DdtImportBatchResult,
  type DdtListQuery,
  type DdtListResult,
} from "../shared/desktop-api.ts";

const desktopAPI: DesktopAPI = {
  getAppInfo: (): Promise<DesktopAppInfo> =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.getAppInfo) as Promise<DesktopAppInfo>,
  getDatabaseStatus: (): Promise<DesktopDatabaseStatus> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.getDatabaseStatus,
    ) as Promise<DesktopDatabaseStatus>,
  listEnabledModules: (): Promise<PublicModuleInfo[]> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.listEnabledModules,
    ) as Promise<PublicModuleInfo[]>,
  listPlannedModules: (): Promise<PublicPlannedModuleInfo[]> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.listPlannedModules,
    ) as Promise<PublicPlannedModuleInfo[]>,
  getBusinessSectorConfig: (): Promise<BusinessSectorConfig> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.getBusinessSectorConfig,
    ) as Promise<BusinessSectorConfig>,
  saveBusinessSector: (sectorId: BusinessSectorId): Promise<BusinessSectorConfig> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.saveBusinessSector,
      sectorId,
    ) as Promise<BusinessSectorConfig>,
  getAppSettings: (): Promise<AppSettings> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.getAppSettings,
    ) as Promise<AppSettings>,
  saveAppSettings: (settings: AppSettings): Promise<AppSettings> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.saveAppSettings,
      settings,
    ) as Promise<AppSettings>,
  createDatabaseBackup: (): Promise<DatabaseBackupResult> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.createDatabaseBackup,
    ) as Promise<DatabaseBackupResult>,
  restoreDatabaseBackup: (): Promise<DatabaseRestoreResult> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.restoreDatabaseBackup,
    ) as Promise<DatabaseRestoreResult>,
  listParties: (query?: PartyListQuery): Promise<PartyListResult> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.listParties,
      query,
    ) as Promise<PartyListResult>,
  getParty: (id: string): Promise<PartyDto> =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.getParty, id) as Promise<PartyDto>,
  createParty: (input: PartyCreateInput): Promise<PartyDto> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.createParty,
      input,
    ) as Promise<PartyDto>,
  updateParty: (input: PartyUpdateInput): Promise<PartyDto> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.updateParty,
      input,
    ) as Promise<PartyDto>,
  archiveParty: (id: string): Promise<PartyDto> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.archiveParty,
      id,
    ) as Promise<PartyDto>,
  reactivateParty: (id: string): Promise<PartyDto> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.reactivateParty,
      id,
    ) as Promise<PartyDto>,
  exportPartiesCsv: (
    filter: PartyExportFilter,
  ): Promise<PartiesCsvExportResult> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.exportPartiesCsv,
      filter,
    ) as Promise<PartiesCsvExportResult>,
  listQuotes: (query?: QuoteListQuery): Promise<QuoteListResult> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.listQuotes,
      query,
    ) as Promise<QuoteListResult>,
  getQuote: (id: string): Promise<QuoteDto> =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.getQuote, id) as Promise<QuoteDto>,
  createQuote: (input: QuoteWriteInput): Promise<QuoteDto> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.createQuote,
      input,
    ) as Promise<QuoteDto>,
  updateQuote: (input: QuoteUpdateInput): Promise<QuoteDto> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.updateQuote,
      input,
    ) as Promise<QuoteDto>,
  changeQuoteStatus: (input: QuoteStatusChangeInput): Promise<QuoteDto> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.changeQuoteStatus,
      input,
    ) as Promise<QuoteDto>,
  archiveQuote: (id: string): Promise<QuoteDto> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.archiveQuote,
      id,
    ) as Promise<QuoteDto>,
  reactivateQuote: (id: string): Promise<QuoteDto> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.reactivateQuote,
      id,
    ) as Promise<QuoteDto>,
  listQuoteCustomerOptions: (input?: {
    search?: string;
  }): Promise<QuoteCustomerOption[]> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.listQuoteCustomerOptions,
      input,
    ) as Promise<QuoteCustomerOption[]>,
  printQuote: (id: string): Promise<QuotePrintResult> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.printQuote,
      id,
    ) as Promise<QuotePrintResult>,
  exportQuotePdf: (id: string): Promise<QuotePdfExportResult> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.exportQuotePdf,
      id,
    ) as Promise<QuotePdfExportResult>,
  getCompanyProfile: (): Promise<CompanyProfile> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.getCompanyProfile,
    ) as Promise<CompanyProfile>,
  saveCompanyProfile: (
    fields: CompanyProfileFields,
  ): Promise<CompanyProfile> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.saveCompanyProfile,
      fields,
    ) as Promise<CompanyProfile>,
  selectCompanyLogo: (): Promise<CompanyLogoSelectResult> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.selectCompanyLogo,
    ) as Promise<CompanyLogoSelectResult>,
  removeCompanyLogo: (): Promise<CompanyProfile> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.removeCompanyLogo,
    ) as Promise<CompanyProfile>,
  listArticles: (query?: ArticleListQuery): Promise<ArticleListResult> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.listArticles,
      query,
    ) as Promise<ArticleListResult>,
  getArticle: (id: string): Promise<ArticleDto> =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.getArticle, id) as Promise<ArticleDto>,
  createArticle: (input: ArticleCreateInput): Promise<ArticleDto> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.createArticle,
      input,
    ) as Promise<ArticleDto>,
  updateArticle: (input: ArticleUpdateInput): Promise<ArticleDto> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.updateArticle,
      input,
    ) as Promise<ArticleDto>,
  archiveArticle: (id: string): Promise<ArticleDto> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.archiveArticle,
      id,
    ) as Promise<ArticleDto>,
  reactivateArticle: (id: string): Promise<ArticleDto> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.reactivateArticle,
      id,
    ) as Promise<ArticleDto>,
  createStockMovement: (
    input: StockMovementCreateInput,
  ): Promise<StockMovementDto> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.createStockMovement,
      input,
    ) as Promise<StockMovementDto>,
  listStockMovements: (
    query?: StockMovementListQuery,
  ): Promise<StockMovementListResult> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.listStockMovements,
      query,
    ) as Promise<StockMovementListResult>,
  listStockBalances: (
    query?: StockBalanceListQuery,
  ): Promise<StockBalanceListResult> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.listStockBalances,
      query,
    ) as Promise<StockBalanceListResult>,
  getArticleStock: (articleId: string): Promise<ArticleStockDto> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.getArticleStock,
      articleId,
    ) as Promise<ArticleStockDto>,
  getWarehouseSummary: (): Promise<WarehouseSummaryDto> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.getWarehouseSummary,
    ) as Promise<WarehouseSummaryDto>,
  getSetupWizardState: (): Promise<SetupWizardState> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.getSetupWizardState,
    ) as Promise<SetupWizardState>,
  saveSetupWizardProgress: (
    input: SetupWizardProgressInput,
  ): Promise<SetupWizardState> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.saveSetupWizardProgress,
      input,
    ) as Promise<SetupWizardState>,
  completeSetupWizard: (): Promise<SetupWizardState> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.completeSetupWizard,
    ) as Promise<SetupWizardState>,
  getDdtDashboard: (): Promise<DdtDashboardDto> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.getDdtDashboard,
    ) as Promise<DdtDashboardDto>,
  listDdtDocuments: (query?: DdtListQuery): Promise<DdtListResult> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.listDdtDocuments,
      query,
    ) as Promise<DdtListResult>,
  getDdtDetail: (id: string): Promise<DdtDetailDto> =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.getDdtDetail, id) as Promise<DdtDetailDto>,
  importDdtFiles: (): Promise<DdtImportBatchResult> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.importDdtFiles,
    ) as Promise<DdtImportBatchResult>,
  reprocessDdt: (id: string): Promise<DdtDetailDto> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.reprocessDdt,
      id,
    ) as Promise<DdtDetailDto>,
  saveDdtReview: (input: DdtDocumentUpdateInput): Promise<DdtDetailDto> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.saveDdtReview,
      input,
    ) as Promise<DdtDetailDto>,
  createMissingDdtArticles: (
    input: DdtCreateMissingArticlesInput,
  ): Promise<DdtDetailDto> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.createMissingDdtArticles,
      input,
    ) as Promise<DdtDetailDto>,
  reassociateDdtArticles: (id: string): Promise<DdtDetailDto> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.reassociateDdtArticles,
      id,
    ) as Promise<DdtDetailDto>,
  registerDdt: (id: string): Promise<DdtDetailDto> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.registerDdt,
      id,
    ) as Promise<DdtDetailDto>,
  cancelDdt: (id: string): Promise<DdtDocumentDto> =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.cancelDdt, id) as Promise<DdtDocumentDto>,
  exportDdtArchiveCsv: (query?: DdtListQuery): Promise<DdtCsvExportResult> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.exportDdtArchiveCsv,
      query,
    ) as Promise<DdtCsvExportResult>,
  exportDdtLinesCsv: (query?: DdtListQuery): Promise<DdtCsvExportResult> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.exportDdtLinesCsv,
      query,
    ) as Promise<DdtCsvExportResult>,
  openDdtOriginal: (id: string): Promise<DdtOpenOriginalResult> =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.openDdtOriginal,
      id,
    ) as Promise<DdtOpenOriginalResult>,
};

contextBridge.exposeInMainWorld("desktopAPI", desktopAPI);
