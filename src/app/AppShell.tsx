import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "../../shared/app-settings.ts";
import {
  DEFAULT_BUSINESS_SECTOR_CONFIG,
  type BusinessSectorConfig,
} from "../../shared/business-sector.ts";
import {
  APP_TECHNICAL_NAME,
  getNavGroupForModule,
  listEnabledModules,
  NAV_GROUP_LABELS,
  PRODUCT_DISPLAY_NAME,
  type ModuleId,
  type NavGroupId,
  type PublicModuleInfo,
} from "../../shared/modules.ts";
import {
  DEFAULT_SETUP_WIZARD_STATE,
  SETUP_WIZARD_PREVIEW_INITIAL_STATE,
  shouldShowSetupOnboardingCues,
  shouldShowSetupWizard,
  type SetupWizardState,
} from "../../shared/setup-wizard.ts";
import {
  DesktopClientError,
  readAppSettings,
  readBusinessSectorConfig,
  readEnabledModules,
  readSetupWizardState,
} from "../desktop/desktopBridge.ts";
import { AnagrafichePage } from "../features/anagrafiche/AnagrafichePage.tsx";
import { CompanyPage } from "../features/company/CompanyPage.tsx";
import { DashboardPage } from "../features/dashboard/DashboardPage.tsx";
import { DiagnosticsPage } from "../features/diagnostics/DiagnosticsPage.tsx";
import { DdtPage } from "../features/ddt/DdtPage.tsx";
import { MagazzinoPage } from "../features/magazzino/MagazzinoPage.tsx";
import { PreventiviPage } from "../features/preventivi/PreventiviPage.tsx";
import { SettingsPage } from "../features/settings/SettingsPage.tsx";
import { SetupWizard } from "../features/setup/SetupWizard.tsx";
import { Panel } from "../ui/Panel.tsx";
import {
  IconAnagrafiche,
  IconCompany,
  IconDashboard,
  IconDdt,
  IconDiagnostics,
  IconMagazzino,
  IconPreventivi,
  IconSettings,
} from "../ui/icons.tsx";
import { applyAppSettingsToDocument } from "./applyAppSettings.ts";
import { isRendererDevBuild } from "./devFlags.ts";

const ICONS: Record<ModuleId, typeof IconDashboard> = {
  dashboard: IconDashboard,
  anagrafiche: IconAnagrafiche,
  preventivi: IconPreventivi,
  magazzino: IconMagazzino,
  ddt: IconDdt,
  company: IconCompany,
  diagnostics: IconDiagnostics,
  settings: IconSettings,
};

const NAV_GROUP_ORDER: NavGroupId[] = ["operations", "system"];

export function AppShell() {
  const [modules, setModules] = useState<PublicModuleInfo[]>(() =>
    listEnabledModules(),
  );
  const [activeModule, setActiveModule] = useState<ModuleId>("dashboard");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [sectorConfig, setSectorConfig] = useState<BusinessSectorConfig>(
    DEFAULT_BUSINESS_SECTOR_CONFIG,
  );
  const [focusSettingsSector, setFocusSettingsSector] = useState(false);
  const [sectorNotice, setSectorNotice] = useState<string | null>(null);
  const [wizardState, setWizardState] = useState<SetupWizardState | null>(null);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [wizardDeferred, setWizardDeferred] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [wizardPreviewOpen, setWizardPreviewOpen] = useState(false);
  const devBuild = isRendererDevBuild();

  const handleSettingsApplied = useCallback((settings: AppSettings) => {
    setAppSettings(settings);
  }, []);

  /** Preview may tweak document theme visually without committing React state. */
  const handlePreviewThemeOnly = useCallback((settings: AppSettings) => {
    applyAppSettingsToDocument(settings);
  }, []);

  const refreshModules = useCallback(async () => {
    const enabled = await readEnabledModules();
    setModules(enabled);
    setActiveModule((current) =>
      enabled.some((module) => module.id === current)
        ? current
        : (enabled[0]?.id ?? current),
    );
  }, []);

  const handleSectorSaved = useCallback(
    async (config: BusinessSectorConfig) => {
      setSectorConfig(config);
      setFocusSettingsSector(false);
      setSectorNotice(
        config.configured
          ? "Settore salvato. La navigazione è aggiornata in base alla configurazione."
          : null,
      );
      await refreshModules();
    },
    [refreshModules],
  );

  const openSectorSettings = useCallback(() => {
    setFocusSettingsSector(true);
    setActiveModule("settings");
    setSectorNotice(null);
  }, []);

  const showWizard =
    bootstrapped &&
    !wizardPreviewOpen &&
    !wizardDeferred &&
    !wizardError &&
    wizardState !== null &&
    shouldShowSetupWizard(wizardState);

  const showOnboardingCues = shouldShowSetupOnboardingCues(wizardState);

  const openWizardPreview = useCallback(() => {
    if (!devBuild) {
      return;
    }
    setWizardPreviewOpen(true);
  }, [devBuild]);

  const closeWizardPreview = useCallback(() => {
    setWizardPreviewOpen(false);
    applyAppSettingsToDocument(appSettings);
  }, [appSettings]);

  useEffect(() => {
    applyAppSettingsToDocument(DEFAULT_APP_SETTINGS);

    let cancelled = false;

    const load = async () => {
      try {
        const enabled = await readEnabledModules();
        if (cancelled) {
          return;
        }
        setModules(enabled);
        setLoadError(null);
        setActiveModule((current) =>
          enabled.some((module) => module.id === current)
            ? current
            : (enabled[0]?.id ?? current),
        );
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : "Impossibile leggere i moduli",
          );
        }
        return;
      }

      try {
        const settings = await readAppSettings();
        if (cancelled) {
          return;
        }
        setAppSettings(settings);
        applyAppSettingsToDocument(settings);
      } catch {
        // Keep defaults.
      }

      try {
        const sector = await readBusinessSectorConfig();
        if (cancelled) {
          return;
        }
        setSectorConfig(sector);
      } catch {
        setSectorConfig({ ...DEFAULT_BUSINESS_SECTOR_CONFIG });
      }

      try {
        const wizard = await readSetupWizardState();
        if (cancelled) {
          return;
        }
        setWizardState(wizard);
        setWizardError(null);
      } catch (error) {
        if (!cancelled) {
          setWizardState({ ...DEFAULT_SETUP_WIZARD_STATE });
          setWizardError(
            error instanceof DesktopClientError || error instanceof Error
              ? error.message
              : "Stato della configurazione iniziale non leggibile.",
          );
        }
      } finally {
        if (!cancelled) {
          setBootstrapped(true);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sectorNotice) {
      return;
    }
    const timer = window.setTimeout(() => setSectorNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [sectorNotice]);

  const handleWizardCompleted = useCallback(
    async (payload: {
      settings: AppSettings;
      sector: BusinessSectorConfig;
    }) => {
      setAppSettings(payload.settings);
      applyAppSettingsToDocument(payload.settings);
      setSectorConfig(payload.sector);
      setWizardState({
        status: "completed",
        currentStep: 5,
        completionSource: "user",
        updatedAt: new Date().toISOString(),
      });
      setWizardDeferred(false);
      setActiveModule("dashboard");
      await refreshModules();
    },
    [refreshModules],
  );

  const handleWizardDeferred = useCallback(() => {
    setWizardDeferred(true);
    setActiveModule("dashboard");
  }, []);

  const activeMeta = useMemo(
    () => modules.find((module) => module.id === activeModule),
    [modules, activeModule],
  );

  const groupedModules = useMemo(() => {
    return NAV_GROUP_ORDER.map((groupId) => ({
      groupId,
      label: NAV_GROUP_LABELS[groupId],
      items: modules.filter((module) => getNavGroupForModule(module.id) === groupId),
    })).filter((group) => group.items.length > 0);
  }, [modules]);

  const navigate = useCallback((id: ModuleId) => {
    if (id !== "settings") {
      setFocusSettingsSector(false);
    }
    setActiveModule(id);
  }, []);

  return (
    <div
      className="app-shell"
      data-testid="app-shell"
      data-appearance={appSettings.appearance}
      data-compact={appSettings.compactMode ? "true" : "false"}
      data-sector-configured={sectorConfig.configured ? "true" : "false"}
      data-setup-wizard={showWizard ? "open" : "closed"}
    >
      <aside className="sidebar" aria-label="Navigazione principale">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <p className="brand-kicker">{APP_TECHNICAL_NAME}</p>
            <p className="brand-name">{PRODUCT_DISPLAY_NAME}</p>
          </div>
        </div>

        <nav className="side-nav">
          {groupedModules.map((group) => (
            <div key={group.groupId} className="nav-group">
              <p className="nav-group-label">{group.label}</p>
              {group.items.map((module) => {
                const Icon = ICONS[module.id];
                const selected = module.id === activeModule;
                return (
                  <button
                    key={module.id}
                    type="button"
                    className={selected ? "nav-item is-active" : "nav-item"}
                    data-testid={`nav-${module.id}`}
                    aria-current={selected ? "page" : undefined}
                    onClick={() => navigate(module.id)}
                  >
                    <Icon className="nav-icon" />
                    <span>{module.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <p className="sidebar-note">
          {sectorConfig.configured
            ? "Navigazione filtrata per il settore configurato"
            : showOnboardingCues
              ? "Configurazione iniziale incompleta · moduli comuni disponibili"
              : "Moduli disponibili per questa installazione"}
        </p>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <p className="topbar-kicker">Area attiva</p>
            <h1>{activeMeta?.label ?? "Caricamento…"}</h1>
          </div>
          {activeMeta ? <p className="topbar-desc">{activeMeta.description}</p> : null}
        </header>

        <main className="content">
          {wizardError ? (
            <Panel title="Configurazione iniziale" tone="danger">
              <p>{wizardError}</p>
              <p className="ui-hint">
                I dati aziendali e le impostazioni esistenti non sono stati
                modificati. Puoi continuare a usare l’applicazione; la procedura
                guidata non è disponibile finché lo stato non torna leggibile.
              </p>
            </Panel>
          ) : null}

          {loadError ? (
            <Panel title="Errore moduli" tone="danger">
              <p>{loadError}</p>
            </Panel>
          ) : null}

          {!loadError && activeModule === "dashboard" ? (
            <DashboardPage
              modules={modules}
              sectorConfig={sectorConfig}
              showOnboardingCues={showOnboardingCues}
              sectorNotice={sectorNotice}
              onOpenModule={navigate}
              onOpenSectorSetup={openSectorSettings}
            />
          ) : null}
          {!loadError && activeModule === "anagrafiche" ? (
            <AnagrafichePage />
          ) : null}
          {!loadError && activeModule === "preventivi" ? (
            <PreventiviPage />
          ) : null}
          {!loadError && activeModule === "magazzino" ? <MagazzinoPage /> : null}
          {!loadError && activeModule === "ddt" ? <DdtPage /> : null}
          {!loadError && activeModule === "company" ? <CompanyPage /> : null}
          {!loadError && activeModule === "diagnostics" ? (
            <DiagnosticsPage
              onOpenSetupWizardPreview={
                devBuild ? openWizardPreview : undefined
              }
            />
          ) : null}
          {!loadError && activeModule === "settings" ? (
            <SettingsPage
              key={focusSettingsSector ? "settings-sector" : "settings"}
              onSettingsApplied={handleSettingsApplied}
              onSectorChanged={handleSectorSaved}
              focusSector={focusSettingsSector}
            />
          ) : null}
        </main>
      </div>

      {showWizard && wizardState ? (
        <SetupWizard
          mode="live"
          initialState={wizardState}
          onCompleted={handleWizardCompleted}
          onDeferred={handleWizardDeferred}
          onSettingsPreview={handleSettingsApplied}
        />
      ) : null}

      {wizardPreviewOpen && devBuild ? (
        <SetupWizard
          mode="preview"
          initialState={SETUP_WIZARD_PREVIEW_INITIAL_STATE}
          onCompleted={async () => {
            closeWizardPreview();
          }}
          onDeferred={closeWizardPreview}
          onSettingsPreview={handlePreviewThemeOnly}
        />
      ) : null}
    </div>
  );
}
