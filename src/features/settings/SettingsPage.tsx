import { useEffect, useMemo, useRef, useState } from "react";
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
  DEFAULT_BUSINESS_SECTOR_CONFIG,
  getBusinessSectorDefinition,
  type BusinessSectorConfig,
  type BusinessSectorId,
} from "../../../shared/business-sector.ts";
import { APP_TECHNICAL_NAME } from "../../../shared/modules.ts";
import { applyAppSettingsToDocument } from "../../app/applyAppSettings.ts";
import {
  DesktopClientError,
  isDesktopRuntime,
  readAppSettings,
  readBusinessSectorConfig,
  requestDatabaseBackup,
  requestDatabaseRestore,
  writeAppSettings,
  writeBusinessSector,
} from "../../desktop/desktopBridge.ts";
import { SectorSetupPanel } from "../sector/SectorSetupPanel.tsx";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { PageHeader } from "../../ui/PageHeader.tsx";
import { Panel } from "../../ui/Panel.tsx";
import { Separator } from "../../ui/Separator.tsx";

type LoadState = "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";
type SettingsSection = "sector" | "appearance" | "backup";
type BackupUiState =
  | { status: "idle" }
  | { status: "running"; kind: "backup" | "restore" }
  | { status: "completed"; kind: "backup" | "restore"; detail: string }
  | { status: "cancelled"; kind: "backup" | "restore" }
  | { status: "error"; kind: "backup" | "restore"; message: string };

const ACCENT_LABELS: Record<AppAccentColor, string> = {
  teal: "Teal",
  slate: "Ardesia",
  amber: "Ambra",
  indigo: "Indaco",
  rose: "Rosa",
};

type SettingsPageProps = {
  onSettingsApplied?: (settings: AppSettings) => void;
  onSectorChanged?: (config: BusinessSectorConfig) => void | Promise<void>;
  /** Open sector editor immediately (e.g. from Dashboard CTA). */
  focusSector?: boolean;
};

export function SettingsPage({
  onSettingsApplied,
  onSectorChanged,
  focusSector = false,
}: SettingsPageProps) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [draft, setDraft] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [backupUi, setBackupUi] = useState<BackupUiState>({ status: "idle" });
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [section, setSection] = useState<SettingsSection>("sector");
  const [sectorConfig, setSectorConfig] = useState<BusinessSectorConfig>(
    DEFAULT_BUSINESS_SECTOR_CONFIG,
  );
  const [sectorEditing, setSectorEditing] = useState(focusSector);
  const [sectorConfirming, setSectorConfirming] = useState(false);
  const [pendingSectorId, setPendingSectorId] = useState<BusinessSectorId | null>(
    null,
  );
  const [sectorBusy, setSectorBusy] = useState(false);
  const [sectorError, setSectorError] = useState<string | null>(null);
  const [sectorFeedback, setSectorFeedback] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const loadTokenRef = useRef(0);

  const dirty = useMemo(() => !settingsEqual(draft, saved), [draft, saved]);
  const busy =
    backupUi.status === "running" ||
    saveState === "saving" ||
    sectorBusy;

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    let cancelled = false;
    const token = ++loadTokenRef.current;
    const shouldFocusSector = focusSector;

    const load = async () => {
      setLoadState("loading");
      setLoadError(null);
      try {
        const settings = await readAppSettings();
        if (cancelled || token !== loadTokenRef.current) {
          return;
        }
        if (!dirtyRef.current) {
          setSaved(settings);
          setDraft(settings);
          applyAppSettingsToDocument(settings);
          onSettingsApplied?.(settings);
        }

        try {
          const sector = await readBusinessSectorConfig();
          if (cancelled || token !== loadTokenRef.current) {
            return;
          }
          setSectorConfig(sector);
          // Only open the sector editor when explicitly requested (e.g. Dashboard CTA).
          // After wizard completion, Impostazioni stays a normal settings page.
          if (shouldFocusSector) {
            setSectorEditing(true);
            setSection("sector");
          }
        } catch {
          setSectorConfig({ ...DEFAULT_BUSINESS_SECTOR_CONFIG });
        }

        setLoadState("ready");
      } catch (error) {
        if (cancelled || token !== loadTokenRef.current) {
          return;
        }
        setLoadState("error");
        setLoadError(
          error instanceof DesktopClientError || error instanceof Error
            ? error.message
            : "Impossibile caricare le impostazioni.",
        );
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [focusSector, onSettingsApplied]);

  const updateDraft = (patch: Partial<AppSettings>) => {
    setDraft((current) => {
      const next = { ...current, ...patch };
      applyAppSettingsToDocument(next);
      onSettingsApplied?.(next);
      return next;
    });
    setSaveState("idle");
    setSaveError(null);
  };

  const applySectorSelection = async (sectorId: BusinessSectorId) => {
    setSectorBusy(true);
    setSectorError(null);
    setSectorFeedback(null);
    try {
      const savedSector = await writeBusinessSector(sectorId);
      setSectorConfig(savedSector);
      setSectorEditing(false);
      setSectorConfirming(false);
      setPendingSectorId(null);
      setSectorFeedback(
        `Settore aggiornato: ${getBusinessSectorDefinition(sectorId).label}. I dati esistenti sono conservati.`,
      );
      await onSectorChanged?.(savedSector);
    } catch (error) {
      setSectorError(
        error instanceof DesktopClientError || error instanceof Error
          ? error.message
          : "Impossibile salvare il settore.",
      );
    } finally {
      setSectorBusy(false);
    }
  };

  const handleSectorConfirmRequest = async (sectorId: BusinessSectorId) => {
    if (
      sectorConfig.configured &&
      sectorConfig.sectorId &&
      sectorConfig.sectorId !== sectorId
    ) {
      setPendingSectorId(sectorId);
      setSectorConfirming(true);
      return;
    }
    await applySectorSelection(sectorId);
  };

  const handleSave = async () => {
    if (!dirty || saveState === "saving") {
      return;
    }
    setSaveState("saving");
    setSaveError(null);
    try {
      const persisted = await writeAppSettings(draft);
      setSaved(persisted);
      setDraft(persisted);
      applyAppSettingsToDocument(persisted);
      onSettingsApplied?.(persisted);
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      setSaveError(
        error instanceof DesktopClientError || error instanceof Error
          ? error.message
          : "Salvataggio non riuscito.",
      );
    }
  };

  const handleResetDraft = () => {
    setDraft(saved);
    applyAppSettingsToDocument(saved);
    onSettingsApplied?.(saved);
    setSaveState("idle");
    setSaveError(null);
  };

  const handleBackup = async () => {
    if (busy) {
      return;
    }
    setBackupUi({ status: "running", kind: "backup" });
    try {
      const result = await requestDatabaseBackup();
      if (result.status === "cancelled") {
        setBackupUi({ status: "cancelled", kind: "backup" });
        return;
      }
      setBackupUi({
        status: "completed",
        kind: "backup",
        detail: `Backup creato: ${result.fileName}`,
      });
    } catch (error) {
      setBackupUi({
        status: "error",
        kind: "backup",
        message:
          error instanceof DesktopClientError || error instanceof Error
            ? error.message
            : "Backup non riuscito.",
      });
    }
  };

  const handleRestore = async () => {
    if (busy) {
      return;
    }
    setBackupUi({ status: "running", kind: "restore" });
    try {
      const result = await requestDatabaseRestore();
      if (result.status === "cancelled") {
        setBackupUi({ status: "cancelled", kind: "restore" });
        setConfirmRestore(false);
        return;
      }

      const settings = await readAppSettings();
      setSaved(settings);
      setDraft(settings);
      applyAppSettingsToDocument(settings);
      onSettingsApplied?.(settings);

      const sector = await readBusinessSectorConfig();
      setSectorConfig(sector);

      setBackupUi({
        status: "completed",
        kind: "restore",
        detail: `Ripristino completato (schema v${result.schemaVersion}).`,
      });
      setConfirmRestore(false);
    } catch (error) {
      setBackupUi({
        status: "error",
        kind: "restore",
        message:
          error instanceof DesktopClientError || error instanceof Error
            ? error.message
            : "Ripristino non riuscito.",
      });
    }
  };

  return (
    <div className="page page-form page-enter" data-testid="page-settings">
      <PageHeader
        eyebrow="Configurazione"
        title="Impostazioni"
        description={`Preferenze di ${APP_TECHNICAL_NAME}: settore, aspetto e protezione dati. Il profilo fiscale si gestisce in Azienda.`}
        actions={
          section === "appearance" ? (
            <>
              <Button
                variant="secondary"
                disabled={!dirty || busy || loadState !== "ready"}
                onClick={handleResetDraft}
              >
                Annulla modifiche
              </Button>
              <Button
                variant="primary"
                disabled={!dirty || busy || loadState !== "ready"}
                onClick={() => {
                  void handleSave();
                }}
              >
                {saveState === "saving" ? "Salvataggio…" : "Salva aspetto"}
              </Button>
            </>
          ) : null
        }
      />

      <Separator />

      <div className="settings-section-nav" role="tablist" aria-label="Sezioni impostazioni">
        {(
          [
            ["sector", "Settore"],
            ["appearance", "Aspetto"],
            ["backup", "Backup"],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            variant={section === id ? "primary" : "ghost"}
            data-testid={`settings-tab-${id}`}
            onClick={() => setSection(id)}
          >
            {label}
          </Button>
        ))}
      </div>

      {!isDesktopRuntime() ? (
        <Panel title="Anteprima browser" tone="muted">
          <p>
            Senza bridge desktop le preferenze restano in memoria. Avvia con{" "}
            <code>npm run dev:desktop</code> per la persistenza SQLite.
          </p>
        </Panel>
      ) : null}

      {loadState === "loading" ? (
        <p className="status-line">Caricamento impostazioni…</p>
      ) : null}

      {loadState === "error" ? (
        <Panel title="Errore di caricamento" tone="danger">
          <p>{loadError}</p>
        </Panel>
      ) : null}

      {loadState === "ready" && section === "sector" ? (
        <Panel title="Settore aziendale" data-testid="settings-business-sector">
          <p className="settings-copy">
            Determina i moduli settoriali disponibili. Non coincide con il profilo
            fiscale e non modifica anagrafiche, preventivi o movimenti già salvati.
          </p>
          {sectorConfig.configured && sectorConfig.sectorId ? (
            <p data-testid="settings-sector-current">
              Settore configurato:{" "}
              <strong>
                {getBusinessSectorDefinition(sectorConfig.sectorId).label}
              </strong>
            </p>
          ) : (
            <p data-testid="settings-sector-unconfigured">
              Nessun settore salvato. Restano disponibili i moduli comuni
              (configurazione generale effettiva). Puoi sceglierne uno quando
              vuoi.
            </p>
          )}
          {sectorFeedback ? (
            <p className="ui-hint" data-testid="settings-sector-feedback">
              {sectorFeedback}
            </p>
          ) : null}
          {!sectorEditing ? (
            <Button
              variant="secondary"
              disabled={busy || !isDesktopRuntime()}
              data-testid="settings-sector-edit"
              onClick={() => {
                setSectorEditing(true);
                setSectorError(null);
                setSectorConfirming(false);
                setPendingSectorId(null);
              }}
            >
              {sectorConfig.configured ? "Cambia settore" : "Scegli settore"}
            </Button>
          ) : (
            <SectorSetupPanel
              mode="settings"
              initialSectorId={sectorConfig.sectorId}
              busy={sectorBusy}
              error={sectorError}
              onConfirm={handleSectorConfirmRequest}
              onCancel={() => {
                setSectorEditing(false);
                setSectorConfirming(false);
                setPendingSectorId(null);
                setSectorError(null);
              }}
            />
          )}
          {sectorConfirming && pendingSectorId ? (
            <Panel
              title="Conferma cambio settore"
              tone="muted"
              data-testid="settings-sector-confirm"
            >
              <p>
                Passare a{" "}
                <strong>
                  {getBusinessSectorDefinition(pendingSectorId).label}
                </strong>
                ? I dati esistenti restano nel database. Il cambio non importa
                automaticamente dati di un altro settore.
              </p>
              <div className="settings-actions">
                <Button
                  variant="primary"
                  disabled={sectorBusy}
                  data-testid="settings-sector-confirm-yes"
                  onClick={() => {
                    void applySectorSelection(pendingSectorId);
                  }}
                >
                  Conferma cambio
                </Button>
                <Button
                  variant="ghost"
                  disabled={sectorBusy}
                  onClick={() => {
                    setSectorConfirming(false);
                    setPendingSectorId(null);
                  }}
                >
                  Annulla
                </Button>
              </div>
            </Panel>
          ) : null}
        </Panel>
      ) : null}

      {loadState === "ready" && section === "appearance" ? (
        <>
          <div className="settings-status-row">
            <Badge tone={dirty ? "warning" : "success"}>
              {dirty ? "modifiche non salvate" : "sincronizzato"}
            </Badge>
            {saveState === "saved" ? <Badge tone="success">salvato</Badge> : null}
            {saveState === "error" ? (
              <Badge tone="danger">errore salvataggio</Badge>
            ) : null}
          </div>
          {saveError ? (
            <Panel title="Salvataggio non riuscito" tone="danger">
              <p>{saveError}</p>
            </Panel>
          ) : null}
          <Panel title="Aspetto" tone="muted" data-testid="settings-appearance">
            <fieldset className="settings-fieldset">
              <legend>Tema</legend>
              <div className="settings-options">
                {APP_APPEARANCES.map((appearance) => (
                  <label key={appearance} className="settings-option">
                    <input
                      type="radio"
                      name="appearance"
                      value={appearance}
                      checked={draft.appearance === appearance}
                      disabled={busy}
                      onChange={() =>
                        updateDraft({ appearance: appearance as AppAppearance })
                      }
                    />
                    <span>{appearance === "dark" ? "Scuro" : "Chiaro"}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="settings-fieldset">
              <legend>Colore accento</legend>
              <div className="settings-options settings-accents">
                {APP_ACCENT_COLORS.map((accent) => (
                  <label key={accent} className="settings-option">
                    <input
                      type="radio"
                      name="accentColor"
                      value={accent}
                      checked={draft.accentColor === accent}
                      disabled={busy}
                      onChange={() =>
                        updateDraft({ accentColor: accent as AppAccentColor })
                      }
                    />
                    <span
                      className="accent-swatch"
                      data-accent-preview={accent}
                      aria-hidden="true"
                    />
                    <span>{ACCENT_LABELS[accent]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="settings-option settings-checkbox">
              <input
                type="checkbox"
                checked={draft.compactMode}
                disabled={busy}
                onChange={(event) =>
                  updateDraft({ compactMode: event.target.checked })
                }
              />
              <span>Modalità compatta (densità UI ridotta)</span>
            </label>
          </Panel>
        </>
      ) : null}

      {loadState === "ready" && section === "backup" ? (
        <Panel title="Backup e ripristino" data-testid="settings-backup">
          <p className="settings-copy">
            Copia coerente del database locale o ripristino da backup validato. Il
            ripristino sostituisce i dati correnti dopo conferma. Include profilo
            aziendale, anagrafiche, preventivi e magazzino.
          </p>
          <div className="settings-actions">
            <Button
              variant="secondary"
              disabled={!isDesktopRuntime() || busy}
              onClick={() => {
                void handleBackup();
              }}
            >
              {backupUi.status === "running" && backupUi.kind === "backup"
                ? "Backup in corso…"
                : "Crea backup"}
            </Button>
            <Button
              variant="secondary"
              disabled={!isDesktopRuntime() || busy}
              onClick={() => {
                setConfirmRestore(true);
                setBackupUi({ status: "idle" });
              }}
            >
              Ripristina da backup…
            </Button>
          </div>
          {confirmRestore ? (
            <div
              className="settings-confirm"
              role="group"
              aria-label="Conferma ripristino"
            >
              <p>
                Il ripristino sostituirà il database attuale. Verrà creato un backup
                di sicurezza automatico. Continuare?
              </p>
              <div className="settings-actions">
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => {
                    void handleRestore();
                  }}
                >
                  {backupUi.status === "running" && backupUi.kind === "restore"
                    ? "Ripristino in corso…"
                    : "Conferma ripristino"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setConfirmRestore(false)}
                >
                  Annulla
                </Button>
              </div>
            </div>
          ) : null}
          {backupUi.status === "completed" ? (
            <p className="ui-hint" data-testid="backup-status-ok">
              {backupUi.detail}
            </p>
          ) : null}
          {backupUi.status === "cancelled" ? (
            <p className="ui-hint">
              Operazione di {backupUi.kind === "backup" ? "backup" : "ripristino"}{" "}
              annullata.
            </p>
          ) : null}
          {backupUi.status === "error" ? (
            <Panel title="Operazione non riuscita" tone="danger">
              <p>{backupUi.message}</p>
            </Panel>
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}
