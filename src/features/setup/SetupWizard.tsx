import { useCallback, useEffect, useMemo, useState } from "react";
import {
  APP_ACCENT_COLORS,
  APP_APPEARANCES,
  DEFAULT_APP_SETTINGS,
  settingsEqual,
  type AppAccentColor,
  type AppAppearance,
  type AppSettings,
} from "../../../shared/app-settings.ts";
import {
  BUSINESS_SECTORS,
  DEFAULT_BUSINESS_SECTOR_CONFIG,
  getBusinessSectorDefinition,
  type BusinessSectorConfig,
  type BusinessSectorId,
} from "../../../shared/business-sector.ts";
import {
  DEFAULT_COMPANY_PROFILE,
  DEFAULT_COMPANY_PROFILE_FIELDS,
  type CompanyProfile,
  type CompanyProfileFields,
} from "../../../shared/company-profile.ts";
import {
  APP_TECHNICAL_NAME,
  PRODUCT_DISPLAY_NAME,
} from "../../../shared/modules.ts";
import {
  SETUP_WIZARD_STEP_LABELS,
  moveSetupWizardStep,
  shouldPersistSetupWizardWrites,
  type SetupWizardMode,
  type SetupWizardState,
  type SetupWizardStep,
} from "../../../shared/setup-wizard.ts";
import { applyAppSettingsToDocument } from "../../app/applyAppSettings.ts";
import {
  DesktopClientError,
  completeSetupWizardState,
  isDesktopRuntime,
  readAppSettings,
  readBusinessSectorConfig,
  readCompanyProfile,
  requestRemoveCompanyLogo,
  requestSelectCompanyLogo,
  writeAppSettings,
  writeBusinessSector,
  writeCompanyProfile,
  writeSetupWizardProgress,
} from "../../desktop/desktopBridge.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { Panel } from "../../ui/Panel.tsx";

const ACCENT_LABELS: Record<AppAccentColor, string> = {
  teal: "Teal",
  slate: "Ardesia",
  amber: "Ambra",
  indigo: "Indaco",
  rose: "Rosa",
};

type SetupWizardProps = {
  initialState: SetupWizardState;
  /** `preview` = development walkthrough; never writes to SQLite. Default `live`. */
  mode?: SetupWizardMode;
  onCompleted: (payload: {
    settings: AppSettings;
    sector: BusinessSectorConfig;
  }) => void | Promise<void>;
  onDeferred: () => void;
  onSettingsPreview: (settings: AppSettings) => void;
};

function toFields(profile: CompanyProfile): CompanyProfileFields {
  return {
    legalName: profile.legalName,
    tradeName: profile.tradeName,
    address: profile.address,
    postalCode: profile.postalCode,
    city: profile.city,
    province: profile.province,
    country: profile.country,
    vatNumber: profile.vatNumber,
    taxCode: profile.taxCode,
    email: profile.email,
    phone: profile.phone,
    website: profile.website,
    defaultQuoteTerms: profile.defaultQuoteTerms,
  };
}

function companyCompleteness(
  profile: CompanyProfileFields,
  hasLogo: boolean,
): "compilato" | "parziale" | "da completare" {
  const hasName = profile.legalName.trim().length > 0;
  const hasExtra = Boolean(
    profile.vatNumber ||
      profile.taxCode ||
      profile.address ||
      profile.city ||
      profile.email ||
      profile.phone ||
      hasLogo,
  );
  if (hasName && hasExtra) {
    return "compilato";
  }
  if (hasName || hasExtra) {
    return "parziale";
  }
  return "da completare";
}

export function SetupWizard({
  initialState,
  mode = "live",
  onCompleted,
  onDeferred,
  onSettingsPreview,
}: SetupWizardProps) {
  const desktop = isDesktopRuntime();
  const persist = shouldPersistSetupWizardWrites(mode);
  const isPreview = mode === "preview";
  const [step, setStep] = useState<SetupWizardStep>(() => {
    if (isPreview) {
      return 1;
    }
    return initialState.status === "in_progress" ? initialState.currentStep : 1;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  const [companyDraft, setCompanyDraft] = useState<CompanyProfileFields>(
    DEFAULT_COMPANY_PROFILE_FIELDS,
  );
  const [companySaved, setCompanySaved] = useState<CompanyProfile>(
    DEFAULT_COMPANY_PROFILE,
  );
  const [sectorId, setSectorId] = useState<BusinessSectorId | null>(null);
  const [sectorConfigured, setSectorConfigured] = useState(false);
  const [settingsDraft, setSettingsDraft] =
    useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [settingsSaved, setSettingsSaved] =
    useState<AppSettings>(DEFAULT_APP_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!desktop) {
        setLoadState("ready");
        return;
      }
      try {
        const [profile, sector, settings] = await Promise.all([
          readCompanyProfile(),
          readBusinessSectorConfig(),
          readAppSettings(),
        ]);
        if (cancelled) {
          return;
        }
        setCompanySaved(profile);
        setCompanyDraft(toFields(profile));
        setSectorConfigured(sector.configured);
        setSectorId(sector.sectorId);
        setSettingsSaved(settings);
        setSettingsDraft(settings);
        applyAppSettingsToDocument(settings);
        onSettingsPreview(settings);
        setLoadState("ready");
      } catch (err) {
        if (!cancelled) {
          setLoadState("error");
          setError(
            err instanceof Error
              ? err.message
              : "Impossibile caricare i dati di configurazione.",
          );
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [desktop, onSettingsPreview]);

  const goToStep = useCallback(
    async (nextStep: SetupWizardStep) => {
      if (!persist) {
        setStep(nextStep);
        return;
      }
      const state = await writeSetupWizardProgress({
        status: "in_progress",
        currentStep: nextStep,
      });
      setStep(state.currentStep);
    },
    [persist],
  );

  const updateCompany = (patch: Partial<CompanyProfileFields>) => {
    setCompanyDraft((current) => ({ ...current, ...patch }));
    setError(null);
  };

  const updateSettings = (patch: Partial<AppSettings>) => {
    setSettingsDraft((current) => {
      const next = { ...current, ...patch };
      // Visual-only in preview; AppShell restores real settings on close.
      applyAppSettingsToDocument(next);
      onSettingsPreview(next);
      return next;
    });
    setError(null);
  };

  const handleStart = async () => {
    setBusy(true);
    setError(null);
    try {
      await goToStep(2);
    } catch (err) {
      setError(
        err instanceof DesktopClientError || err instanceof Error
          ? err.message
          : "Impossibile avviare la configurazione.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleCompanyContinue = async () => {
    setBusy(true);
    setError(null);
    try {
      if (persist) {
        const saved = await writeCompanyProfile(companyDraft);
        setCompanySaved(saved);
        setCompanyDraft(toFields(saved));
      } else {
        setCompanySaved((current) => ({ ...current, ...companyDraft }));
      }
      await goToStep(3);
    } catch (err) {
      setError(
        err instanceof DesktopClientError || err instanceof Error
          ? err.message
          : "Impossibile salvare il profilo aziendale.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSectorContinue = async () => {
    setBusy(true);
    setError(null);
    try {
      if (persist && sectorId) {
        const saved = await writeBusinessSector(sectorId);
        setSectorConfigured(saved.configured);
        setSectorId(saved.sectorId);
      } else if (!persist && sectorId) {
        setSectorConfigured(true);
      }
      await goToStep(4);
    } catch (err) {
      setError(
        err instanceof DesktopClientError || err instanceof Error
          ? err.message
          : "Impossibile salvare il settore.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handlePreferencesContinue = async () => {
    setBusy(true);
    setError(null);
    try {
      if (persist && !settingsEqual(settingsDraft, settingsSaved)) {
        const saved = await writeAppSettings(settingsDraft);
        setSettingsSaved(saved);
        setSettingsDraft(saved);
        applyAppSettingsToDocument(saved);
        onSettingsPreview(saved);
      }
      await goToStep(5);
    } catch (err) {
      setError(
        err instanceof DesktopClientError || err instanceof Error
          ? err.message
          : "Impossibile salvare le preferenze.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleComplete = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!persist) {
        const sector: BusinessSectorConfig = sectorId
          ? { configured: true, sectorId }
          : { ...DEFAULT_BUSINESS_SECTOR_CONFIG };
        await onCompleted({ settings: settingsDraft, sector });
        return;
      }

      const company = await writeCompanyProfile(companyDraft);
      setCompanySaved(company);
      setCompanyDraft(toFields(company));

      let sector: BusinessSectorConfig = {
        ...DEFAULT_BUSINESS_SECTOR_CONFIG,
        configured: sectorConfigured,
        sectorId,
      };
      if (sectorId) {
        sector = await writeBusinessSector(sectorId);
        setSectorConfigured(sector.configured);
        setSectorId(sector.sectorId);
      } else {
        sector = await readBusinessSectorConfig();
      }

      const settings = await writeAppSettings(settingsDraft);
      setSettingsSaved(settings);
      applyAppSettingsToDocument(settings);
      onSettingsPreview(settings);

      await completeSetupWizardState();
      await onCompleted({ settings, sector });
    } catch (err) {
      setError(
        err instanceof DesktopClientError || err instanceof Error
          ? err.message
          : "Impossibile completare la configurazione.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleBack = async () => {
    if (step <= 1 || busy) {
      return;
    }
    const prev = moveSetupWizardStep(step, "back");
    setBusy(true);
    setError(null);
    try {
      await goToStep(prev);
    } catch (err) {
      setError(
        err instanceof DesktopClientError || err instanceof Error
          ? err.message
          : "Impossibile aggiornare il passaggio.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleLogoSelect = async () => {
    if (!persist) {
      setError("In anteprima il logo non viene modificato sul database.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await requestSelectCompanyLogo();
      if (result.status === "completed") {
        setCompanySaved(result.profile);
      }
    } catch (err) {
      setError(
        err instanceof DesktopClientError || err instanceof Error
          ? err.message
          : "Impossibile aggiornare il logo.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleLogoRemove = async () => {
    if (!persist) {
      setError("In anteprima il logo non viene modificato sul database.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const profile = await requestRemoveCompanyLogo();
      setCompanySaved(profile);
    } catch (err) {
      setError(
        err instanceof DesktopClientError || err instanceof Error
          ? err.message
          : "Impossibile rimuovere il logo.",
      );
    } finally {
      setBusy(false);
    }
  };

  const completeness = useMemo(
    () => companyCompleteness(companyDraft, companySaved.hasLogo),
    [companyDraft, companySaved.hasLogo],
  );

  return (
    <div
      className="setup-wizard"
      data-testid="setup-wizard"
      data-wizard-mode={mode}
      role="dialog"
      aria-modal="true"
      aria-labelledby="setup-wizard-title"
    >
      <div className="setup-wizard-card">
        <header className="setup-wizard-header">
          <div className="setup-wizard-brand">
            <span className="brand-mark" aria-hidden="true" />
            <div>
              <p className="brand-kicker">{APP_TECHNICAL_NAME}</p>
              <p className="brand-name">{PRODUCT_DISPLAY_NAME}</p>
            </div>
          </div>
          <nav className="setup-wizard-steps" aria-label="Avanzamento">
            {([1, 2, 3, 4, 5] as SetupWizardStep[]).map((item) => (
              <span
                key={item}
                className={
                  item === step
                    ? "setup-step-pip is-current"
                    : item < step
                      ? "setup-step-pip is-done"
                      : "setup-step-pip"
                }
                data-testid={`setup-step-${item}`}
                aria-current={item === step ? "step" : undefined}
              >
                <span className="setup-step-index">{item}</span>
                <span className="setup-step-label">
                  {SETUP_WIZARD_STEP_LABELS[item]}
                </span>
              </span>
            ))}
          </nav>
        </header>

        {isPreview ? (
          <Panel tone="muted" data-testid="setup-wizard-preview-banner">
            <p>
              Anteprima sviluppo: puoi scorrere tutti i passaggi. Nessuna scrittura
              su settore, profilo, preferenze o stato wizard nel database.
            </p>
          </Panel>
        ) : null}

        {error ? (
          <Panel title="Operazione non riuscita" tone="danger">
            <p>{error}</p>
          </Panel>
        ) : null}

        {loadState === "loading" ? (
          <p className="status-line">Caricamento configurazione…</p>
        ) : null}

        {loadState === "error" ? (
          <Panel title="Configurazione non leggibile" tone="danger">
            <p>
              Non è stato possibile leggere lo stato iniziale. I dati esistenti
              non sono stati cancellati. Chiudi e riprova, oppure continua senza
              completare ora.
            </p>
            <div className="settings-actions">
              <Button variant="secondary" onClick={onDeferred}>
                Continua senza completare ora
              </Button>
            </div>
          </Panel>
        ) : null}

        {loadState === "ready" && step === 1 ? (
          <section className="setup-wizard-body" data-testid="setup-step-welcome">
            <h2 id="setup-wizard-title">Configuriamo la tua azienda</h2>
            <p className="setup-wizard-lead">
              In pochi passaggi imposti il profilo aziendale, il settore
              operativo e l’aspetto dell’interfaccia. Potrai modificare tutto in
              seguito da Azienda e Impostazioni.
            </p>
            <ul className="setup-wizard-list">
              <li>Dati aziendali e logo (facoltativi oltre alla ragione sociale)</li>
              <li>Settore per i moduli compatibili</li>
              <li>Tema e colore d’accento</li>
            </ul>
            <div className="setup-wizard-actions">
              <Button
                variant="primary"
                disabled={busy || !desktop}
                data-testid="setup-start"
                onClick={() => {
                  void handleStart();
                }}
              >
                {busy ? "Avvio…" : "Inizia configurazione"}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                data-testid="setup-defer"
                onClick={onDeferred}
              >
                {isPreview ? "Chiudi anteprima" : "Continua senza completare ora"}
              </Button>
            </div>
          </section>
        ) : null}

        {loadState === "ready" && step === 2 ? (
          <section className="setup-wizard-body" data-testid="setup-step-company">
            <h2 id="setup-wizard-title">Dati aziendali</h2>
            <p className="setup-wizard-lead">
              Usa i dati reali dell’attività. I campi vuoti restano vuoti: nessun
              valore inventato. Puoi proseguire anche con una compilazione
              parziale.
            </p>

            <Panel title="Identità aziendale" tone="muted">
              <div className="company-form-grid">
                <label>
                  <span>Ragione sociale / nome attività</span>
                  <input
                    value={companyDraft.legalName}
                    disabled={busy}
                    onChange={(event) =>
                      updateCompany({ legalName: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>Nome commerciale</span>
                  <input
                    value={companyDraft.tradeName ?? ""}
                    disabled={busy}
                    onChange={(event) =>
                      updateCompany({
                        tradeName: event.target.value || null,
                      })
                    }
                  />
                </label>
              </div>
              <div className="company-logo-block">
                <p className="settings-copy">
                  Logo (PNG, JPEG, WebP o GIF, max 512 KB)
                </p>
                {companySaved.hasLogo && companySaved.logoDataUrl ? (
                  <img
                    className="company-logo-preview"
                    src={companySaved.logoDataUrl}
                    alt="Anteprima logo aziendale"
                  />
                ) : (
                  <p className="ui-hint">Nessun logo caricato.</p>
                )}
                <div className="settings-actions">
                  <Button
                    variant="secondary"
                    disabled={busy || isPreview}
                    onClick={() => {
                      void handleLogoSelect();
                    }}
                  >
                    Seleziona logo…
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy || isPreview || !companySaved.hasLogo}
                    onClick={() => {
                      void handleLogoRemove();
                    }}
                  >
                    Rimuovi logo
                  </Button>
                </div>
                {isPreview ? (
                  <p className="ui-hint">
                    Logo disabilitato in anteprima (sola lettura).
                  </p>
                ) : null}
              </div>
            </Panel>

            <Panel title="Dati fiscali" tone="muted">
              <div className="company-form-grid">
                <label>
                  <span>Partita IVA</span>
                  <input
                    value={companyDraft.vatNumber ?? ""}
                    disabled={busy}
                    onChange={(event) =>
                      updateCompany({
                        vatNumber: event.target.value || null,
                      })
                    }
                  />
                </label>
                <label>
                  <span>Codice fiscale</span>
                  <input
                    value={companyDraft.taxCode ?? ""}
                    disabled={busy}
                    onChange={(event) =>
                      updateCompany({
                        taxCode: event.target.value || null,
                      })
                    }
                  />
                </label>
              </div>
            </Panel>

            <Panel title="Sede e contatti" tone="muted">
              <div className="company-form-grid">
                <label className="company-span-2">
                  <span>Indirizzo</span>
                  <input
                    value={companyDraft.address ?? ""}
                    disabled={busy}
                    onChange={(event) =>
                      updateCompany({
                        address: event.target.value || null,
                      })
                    }
                  />
                </label>
              </div>
              <div className="company-form-grid company-form-grid--address">
                <label>
                  <span>CAP</span>
                  <input
                    value={companyDraft.postalCode ?? ""}
                    disabled={busy}
                    onChange={(event) =>
                      updateCompany({
                        postalCode: event.target.value || null,
                      })
                    }
                  />
                </label>
                <label>
                  <span>Città</span>
                  <input
                    value={companyDraft.city ?? ""}
                    disabled={busy}
                    onChange={(event) =>
                      updateCompany({ city: event.target.value || null })
                    }
                  />
                </label>
                <label>
                  <span>Provincia</span>
                  <input
                    value={companyDraft.province ?? ""}
                    disabled={busy}
                    onChange={(event) =>
                      updateCompany({
                        province: event.target.value || null,
                      })
                    }
                  />
                </label>
                <label>
                  <span>Paese</span>
                  <input
                    value={companyDraft.country}
                    disabled={busy}
                    onChange={(event) =>
                      updateCompany({ country: event.target.value })
                    }
                  />
                </label>
              </div>
              <div className="company-form-grid">
                <label>
                  <span>Email</span>
                  <input
                    type="email"
                    value={companyDraft.email ?? ""}
                    disabled={busy}
                    onChange={(event) =>
                      updateCompany({ email: event.target.value || null })
                    }
                  />
                </label>
                <label>
                  <span>Telefono</span>
                  <input
                    value={companyDraft.phone ?? ""}
                    disabled={busy}
                    onChange={(event) =>
                      updateCompany({ phone: event.target.value || null })
                    }
                  />
                </label>
              </div>
            </Panel>

            <div className="setup-wizard-actions">
              <Button variant="ghost" disabled={busy} onClick={() => void handleBack()}>
                Indietro
              </Button>
              <Button
                variant="primary"
                disabled={busy}
                data-testid="setup-company-continue"
                onClick={() => {
                  void handleCompanyContinue();
                }}
              >
                {busy
                  ? isPreview
                    ? "Avanti…"
                    : "Salvataggio…"
                  : isPreview
                    ? "Continua"
                    : "Salva e continua"}
              </Button>
            </div>
          </section>
        ) : null}

        {loadState === "ready" && step === 3 ? (
          <section className="setup-wizard-body" data-testid="setup-step-sector">
            <h2 id="setup-wizard-title">Settore aziendale</h2>
            <p className="setup-wizard-lead">
              Determina i moduli disponibili. Non cancella anagrafiche,
              preventivi o magazzino già presenti.
              {sectorConfigured && sectorId
                ? ` Selezione attuale: ${getBusinessSectorDefinition(sectorId).label}.`
                : " Puoi proseguire senza scegliere ora (nessun settore permanente verrà salvato)."}
            </p>
            <fieldset className="settings-fieldset sector-options" disabled={busy}>
              <legend>Settore</legend>
              <div className="settings-options sector-options-list">
                {BUSINESS_SECTORS.map((sector) => (
                  <label key={sector.id} className="settings-option sector-option">
                    <input
                      type="radio"
                      name="setupBusinessSector"
                      value={sector.id}
                      checked={sectorId === sector.id}
                      disabled={busy}
                      onChange={() => setSectorId(sector.id)}
                    />
                    <span className="sector-option-body">
                      <strong>{sector.label}</strong>
                      <span className="sector-option-desc">
                        {sector.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="setup-wizard-actions">
              <Button variant="ghost" disabled={busy} onClick={() => void handleBack()}>
                Indietro
              </Button>
              <Button
                variant="primary"
                disabled={busy}
                data-testid="setup-sector-continue"
                onClick={() => {
                  void handleSectorContinue();
                }}
              >
                {busy ? "Salvataggio…" : "Continua"}
              </Button>
            </div>
          </section>
        ) : null}

        {loadState === "ready" && step === 4 ? (
          <section
            className="setup-wizard-body"
            data-testid="setup-step-preferences"
          >
            <h2 id="setup-wizard-title">Preferenze</h2>
            <p className="setup-wizard-lead">
              Tema e colore d’accento. L’anteprima si aggiorna subito; il
              salvataggio avviene quando continui.
            </p>
            <fieldset className="settings-fieldset" disabled={busy}>
              <legend>Tema</legend>
              <div className="settings-options">
                {APP_APPEARANCES.map((appearance) => (
                  <label key={appearance} className="settings-option">
                    <input
                      type="radio"
                      name="setupAppearance"
                      checked={settingsDraft.appearance === appearance}
                      onChange={() =>
                        updateSettings({
                          appearance: appearance as AppAppearance,
                        })
                      }
                    />
                    {appearance === "dark" ? "Scuro" : "Chiaro"}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="settings-fieldset settings-accents" disabled={busy}>
              <legend>Colore d’accento</legend>
              <div className="settings-options">
                {APP_ACCENT_COLORS.map((accent) => (
                  <label key={accent} className="settings-option">
                    <input
                      type="radio"
                      name="setupAccent"
                      checked={settingsDraft.accentColor === accent}
                      onChange={() =>
                        updateSettings({
                          accentColor: accent as AppAccentColor,
                        })
                      }
                    />
                    <span
                      className="accent-swatch"
                      data-accent-preview={accent}
                      aria-hidden="true"
                    />
                    {ACCENT_LABELS[accent]}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="settings-fieldset" disabled={busy}>
              <legend>Densità</legend>
              <label className="settings-option settings-checkbox">
                <input
                  type="checkbox"
                  checked={settingsDraft.compactMode}
                  onChange={(event) =>
                    updateSettings({ compactMode: event.target.checked })
                  }
                />
                Modalità compatta
              </label>
            </fieldset>
            <div className="setup-wizard-actions">
              <Button variant="ghost" disabled={busy} onClick={() => void handleBack()}>
                Indietro
              </Button>
              <Button
                variant="primary"
                disabled={busy}
                data-testid="setup-preferences-continue"
                onClick={() => {
                  void handlePreferencesContinue();
                }}
              >
                {busy ? "Salvataggio…" : "Continua"}
              </Button>
            </div>
          </section>
        ) : null}

        {loadState === "ready" && step === 5 ? (
          <section className="setup-wizard-body" data-testid="setup-step-summary">
            <h2 id="setup-wizard-title">Riepilogo</h2>
            <p className="setup-wizard-lead">
              Controlla le scelte. Puoi tornare indietro per correggerle. I campi
              fiscali facoltativi non bloccano il completamento.
            </p>
            <div className="summary-grid">
              <Panel tone="muted" as="article" className="summary-card">
                <div className="module-card-top">
                  <p className="summary-label">Profilo aziendale</p>
                  <Badge
                    tone={
                      completeness === "compilato"
                        ? "success"
                        : completeness === "parziale"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {completeness}
                  </Badge>
                </div>
                <p className="summary-value summary-value-text">
                  {companyDraft.legalName.trim() || "—"}
                </p>
              </Panel>
              <Panel tone="muted" as="article" className="summary-card">
                <p className="summary-label">Settore</p>
                <p className="summary-value summary-value-text">
                  {sectorId
                    ? getBusinessSectorDefinition(sectorId).label
                    : "Non configurato"}
                </p>
              </Panel>
              <Panel tone="muted" as="article" className="summary-card">
                <p className="summary-label">Preferenze</p>
                <p className="summary-meta">
                  Tema {settingsDraft.appearance === "dark" ? "scuro" : "chiaro"}
                  , accento {ACCENT_LABELS[settingsDraft.accentColor]}
                  {settingsDraft.compactMode ? ", compatta" : ""}
                </p>
              </Panel>
            </div>
            <div className="setup-wizard-actions">
              <Button variant="ghost" disabled={busy} onClick={() => void handleBack()}>
                Indietro
              </Button>
              <Button
                variant="primary"
                disabled={busy}
                data-testid="setup-complete"
                onClick={() => {
                  void handleComplete();
                }}
              >
                {busy
                  ? isPreview
                    ? "Chiusura…"
                    : "Completamento…"
                  : isPreview
                    ? "Chiudi anteprima"
                    : "Completa configurazione"}
              </Button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
