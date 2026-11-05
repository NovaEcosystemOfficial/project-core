import type { AppSettings } from "../../shared/app-settings.ts";
import { DEFAULT_APP_SETTINGS } from "../../shared/app-settings.ts";
import type {
  DatabaseBackupResult,
  DatabaseRestoreResult,
} from "../../shared/database-backup.ts";
import type {
  ArticleCreateInput,
  ArticleDto,
  ArticleListQuery,
  ArticleListResult,
  ArticleStockDto,
  ArticleUpdateInput,
  StockBalanceListQuery,
  StockBalanceListResult,
  StockMovementCreateInput,
  StockMovementDto,
  StockMovementListQuery,
  StockMovementListResult,
  WarehouseSummaryDto,
  CompanyLogoSelectResult,
  CompanyProfile,
  CompanyProfileFields,
  DesktopAPI,
  SetupWizardProgressInput,
  SetupWizardState,
  DdtCreateMissingArticlesInput,
  DdtCsvExportResult,
  DdtDashboardDto,
  DdtDetailDto,
  DdtDocumentDto,
  DdtDocumentUpdateInput,
  DdtImportBatchResult,
  DdtListQuery,
  DdtListResult,
  DdtOpenOriginalResult,
  DesktopAppInfo,
  DesktopDatabaseStatus,
  PartiesCsvExportResult,
  PartyCreateInput,
  PartyDto,
  PartyExportFilter,
  PartyListQuery,
  PartyListResult,
  PartyUpdateInput,
  BusinessSectorConfig,
  BusinessSectorId,
  PublicModuleInfo,
  PublicPlannedModuleInfo,
  QuoteCustomerOption,
  QuoteDto,
  QuoteListQuery,
  QuoteListResult,
  QuotePdfExportResult,
  QuotePrintResult,
  QuoteStatusChangeInput,
  QuoteUpdateInput,
  QuoteWriteInput,
} from "../../shared/desktop-api.ts";
import { DEFAULT_COMPANY_PROFILE } from "../../shared/company-profile.ts";
import {
  tryParseDesktopErrorPayload,
  type DesktopErrorCode,
  type DesktopErrorPayload,
} from "../../shared/errors.ts";
import {
  DEFAULT_BUSINESS_SECTOR_CONFIG,
} from "../../shared/business-sector.ts";
import { listEnabledModules as listStaticEnabledModules } from "../../shared/modules.ts";
import { DEFAULT_SETUP_WIZARD_STATE } from "../../shared/setup-wizard.ts";

/** Renderer-side error reconstructed from an explicitly encoded IPC Error.message. */
export class DesktopClientError extends Error {
  readonly code: DesktopErrorCode;

  constructor(payload: DesktopErrorPayload) {
    super(payload.message);
    this.name = "DesktopClientError";
    this.code = payload.code;
  }
}

/**
 * Re-throws a typed DesktopClientError when the main process encoded a public payload.
 * Otherwise rethrows the original failure unchanged.
 */
export function rethrowDesktopInvokeError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const payload = tryParseDesktopErrorPayload(message);
  if (payload) {
    throw new DesktopClientError(payload);
  }
  throw error instanceof Error ? error : new Error(String(error));
}

/** Returns the preload bridge when running inside Electron; otherwise undefined. */
export function getDesktopApi(): DesktopAPI | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.desktopAPI;
}

export function isDesktopRuntime(): boolean {
  return getDesktopApi() !== undefined;
}

/** Reads non-sensitive app info via the controlled bridge, or null in a plain browser. */
export async function readDesktopAppInfo(): Promise<DesktopAppInfo | null> {
  const api = getDesktopApi();
  if (!api) {
    return null;
  }
  return api.getAppInfo();
}

/** Safe DB health snapshot, or null when the bridge is absent. */
export async function readDesktopDatabaseStatus(): Promise<DesktopDatabaseStatus | null> {
  const api = getDesktopApi();
  if (!api) {
    return null;
  }
  return api.getDatabaseStatus();
}

/**
 * Enabled modules for navigation and dashboard.
 * Uses IPC in Electron; falls back to the static shared registry in browser preview.
 */
export async function readEnabledModules(): Promise<PublicModuleInfo[]> {
  const api = getDesktopApi();
  if (!api) {
    return listStaticEnabledModules();
  }
  return api.listEnabledModules();
}

export async function readPlannedModules(): Promise<PublicPlannedModuleInfo[]> {
  const api = getDesktopApi();
  if (!api) {
    return [];
  }
  return api.listPlannedModules();
}

export async function readBusinessSectorConfig(): Promise<BusinessSectorConfig> {
  const api = getDesktopApi();
  if (!api) {
    return { ...DEFAULT_BUSINESS_SECTOR_CONFIG };
  }
  try {
    return await api.getBusinessSectorConfig();
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function writeBusinessSector(
  sectorId: BusinessSectorId,
): Promise<BusinessSectorConfig> {
  try {
    return await requireDesktopApi().saveBusinessSector(sectorId);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function readAppSettings(): Promise<AppSettings> {
  const api = getDesktopApi();
  if (!api) {
    return { ...DEFAULT_APP_SETTINGS };
  }
  try {
    return await api.getAppSettings();
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function writeAppSettings(
  settings: AppSettings,
): Promise<AppSettings> {
  const api = getDesktopApi();
  if (!api) {
    throw new DesktopClientError({
      code: "INTERNAL_ERROR",
      message: "Bridge desktop non disponibile.",
    });
  }
  try {
    return await api.saveAppSettings(settings);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function requestDatabaseBackup(): Promise<DatabaseBackupResult> {
  const api = getDesktopApi();
  if (!api) {
    throw new DesktopClientError({
      code: "INTERNAL_ERROR",
      message: "Bridge desktop non disponibile.",
    });
  }
  try {
    return await api.createDatabaseBackup();
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function requestDatabaseRestore(): Promise<DatabaseRestoreResult> {
  const api = getDesktopApi();
  if (!api) {
    throw new DesktopClientError({
      code: "INTERNAL_ERROR",
      message: "Bridge desktop non disponibile.",
    });
  }
  try {
    return await api.restoreDatabaseBackup();
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

function requireDesktopApi(): DesktopAPI {
  const api = getDesktopApi();
  if (!api) {
    throw new DesktopClientError({
      code: "INTERNAL_ERROR",
      message: "Bridge desktop non disponibile.",
    });
  }
  return api;
}

export async function listParties(
  query?: PartyListQuery,
): Promise<PartyListResult> {
  try {
    return await requireDesktopApi().listParties(query);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function getParty(id: string): Promise<PartyDto> {
  try {
    return await requireDesktopApi().getParty(id);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function createParty(
  input: PartyCreateInput,
): Promise<PartyDto> {
  try {
    return await requireDesktopApi().createParty(input);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function updateParty(
  input: PartyUpdateInput,
): Promise<PartyDto> {
  try {
    return await requireDesktopApi().updateParty(input);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function archiveParty(id: string): Promise<PartyDto> {
  try {
    return await requireDesktopApi().archiveParty(id);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function reactivateParty(id: string): Promise<PartyDto> {
  try {
    return await requireDesktopApi().reactivateParty(id);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function exportPartiesCsv(
  filter: PartyExportFilter,
): Promise<PartiesCsvExportResult> {
  try {
    return await requireDesktopApi().exportPartiesCsv(filter);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function listQuotes(
  query?: QuoteListQuery,
): Promise<QuoteListResult> {
  try {
    return await requireDesktopApi().listQuotes(query);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function getQuote(id: string): Promise<QuoteDto> {
  try {
    return await requireDesktopApi().getQuote(id);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function createQuote(input: QuoteWriteInput): Promise<QuoteDto> {
  try {
    return await requireDesktopApi().createQuote(input);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function updateQuote(input: QuoteUpdateInput): Promise<QuoteDto> {
  try {
    return await requireDesktopApi().updateQuote(input);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function changeQuoteStatus(
  input: QuoteStatusChangeInput,
): Promise<QuoteDto> {
  try {
    return await requireDesktopApi().changeQuoteStatus(input);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function archiveQuote(id: string): Promise<QuoteDto> {
  try {
    return await requireDesktopApi().archiveQuote(id);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function reactivateQuote(id: string): Promise<QuoteDto> {
  try {
    return await requireDesktopApi().reactivateQuote(id);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function listQuoteCustomerOptions(input?: {
  search?: string;
}): Promise<QuoteCustomerOption[]> {
  try {
    return await requireDesktopApi().listQuoteCustomerOptions(input);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function printQuote(id: string): Promise<QuotePrintResult> {
  try {
    return await requireDesktopApi().printQuote(id);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function exportQuotePdf(
  id: string,
): Promise<QuotePdfExportResult> {
  try {
    return await requireDesktopApi().exportQuotePdf(id);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function readCompanyProfile(): Promise<CompanyProfile> {
  const api = getDesktopApi();
  if (!api) {
    return { ...DEFAULT_COMPANY_PROFILE };
  }
  try {
    return await api.getCompanyProfile();
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function writeCompanyProfile(
  fields: CompanyProfileFields,
): Promise<CompanyProfile> {
  try {
    return await requireDesktopApi().saveCompanyProfile(fields);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function requestSelectCompanyLogo(): Promise<CompanyLogoSelectResult> {
  try {
    return await requireDesktopApi().selectCompanyLogo();
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function requestRemoveCompanyLogo(): Promise<CompanyProfile> {
  try {
    return await requireDesktopApi().removeCompanyLogo();
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function listArticles(
  query?: ArticleListQuery,
): Promise<ArticleListResult> {
  try {
    return await requireDesktopApi().listArticles(query);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function getArticle(id: string): Promise<ArticleDto> {
  try {
    return await requireDesktopApi().getArticle(id);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function createArticle(
  input: ArticleCreateInput,
): Promise<ArticleDto> {
  try {
    return await requireDesktopApi().createArticle(input);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function updateArticle(
  input: ArticleUpdateInput,
): Promise<ArticleDto> {
  try {
    return await requireDesktopApi().updateArticle(input);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function archiveArticle(id: string): Promise<ArticleDto> {
  try {
    return await requireDesktopApi().archiveArticle(id);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function reactivateArticle(id: string): Promise<ArticleDto> {
  try {
    return await requireDesktopApi().reactivateArticle(id);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function createStockMovement(
  input: StockMovementCreateInput,
): Promise<StockMovementDto> {
  try {
    return await requireDesktopApi().createStockMovement(input);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function listStockMovements(
  query?: StockMovementListQuery,
): Promise<StockMovementListResult> {
  try {
    return await requireDesktopApi().listStockMovements(query);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function listStockBalances(
  query?: StockBalanceListQuery,
): Promise<StockBalanceListResult> {
  try {
    return await requireDesktopApi().listStockBalances(query);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function getArticleStock(
  articleId: string,
): Promise<ArticleStockDto> {
  try {
    return await requireDesktopApi().getArticleStock(articleId);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function getWarehouseSummary(): Promise<WarehouseSummaryDto> {
  try {
    return await requireDesktopApi().getWarehouseSummary();
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function readSetupWizardState(): Promise<SetupWizardState> {
  const api = getDesktopApi();
  if (!api) {
    return { ...DEFAULT_SETUP_WIZARD_STATE, status: "completed" };
  }
  try {
    return await api.getSetupWizardState();
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function writeSetupWizardProgress(
  input: SetupWizardProgressInput,
): Promise<SetupWizardState> {
  try {
    return await requireDesktopApi().saveSetupWizardProgress(input);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function completeSetupWizardState(): Promise<SetupWizardState> {
  try {
    return await requireDesktopApi().completeSetupWizard();
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function readDdtDashboard(): Promise<DdtDashboardDto> {
  try {
    return await requireDesktopApi().getDdtDashboard();
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function listDdtDocuments(
  query?: DdtListQuery,
): Promise<DdtListResult> {
  try {
    return await requireDesktopApi().listDdtDocuments(query);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function readDdtDetail(id: string): Promise<DdtDetailDto> {
  try {
    return await requireDesktopApi().getDdtDetail(id);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function requestImportDdtFiles(): Promise<DdtImportBatchResult> {
  try {
    return await requireDesktopApi().importDdtFiles();
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function requestReprocessDdt(id: string): Promise<DdtDetailDto> {
  try {
    return await requireDesktopApi().reprocessDdt(id);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function saveDdtReview(
  input: DdtDocumentUpdateInput,
): Promise<DdtDetailDto> {
  try {
    return await requireDesktopApi().saveDdtReview(input);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function createMissingDdtArticles(
  input: DdtCreateMissingArticlesInput,
): Promise<DdtDetailDto> {
  try {
    return await requireDesktopApi().createMissingDdtArticles(input);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function reassociateDdtArticles(
  id: string,
): Promise<DdtDetailDto> {
  try {
    return await requireDesktopApi().reassociateDdtArticles(id);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function requestRegisterDdt(id: string): Promise<DdtDetailDto> {
  try {
    return await requireDesktopApi().registerDdt(id);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function requestCancelDdt(id: string): Promise<DdtDocumentDto> {
  try {
    return await requireDesktopApi().cancelDdt(id);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function exportDdtArchiveCsv(
  query?: DdtListQuery,
): Promise<DdtCsvExportResult> {
  try {
    return await requireDesktopApi().exportDdtArchiveCsv(query);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function exportDdtLinesCsv(
  query?: DdtListQuery,
): Promise<DdtCsvExportResult> {
  try {
    return await requireDesktopApi().exportDdtLinesCsv(query);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}

export async function openDdtOriginal(
  id: string,
): Promise<DdtOpenOriginalResult> {
  try {
    return await requireDesktopApi().openDdtOriginal(id);
  } catch (error) {
    rethrowDesktopInvokeError(error);
  }
}
