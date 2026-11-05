import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_COMPANY_PROFILE,
  DEFAULT_COMPANY_PROFILE_FIELDS,
  type CompanyProfile,
  type CompanyProfileFields,
} from "../../../shared/company-profile.ts";
import { PRODUCT_DISPLAY_NAME } from "../../../shared/modules.ts";
import {
  DesktopClientError,
  isDesktopRuntime,
  readCompanyProfile,
  requestRemoveCompanyLogo,
  requestSelectCompanyLogo,
  writeCompanyProfile,
} from "../../desktop/desktopBridge.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { PageHeader } from "../../ui/PageHeader.tsx";
import { Panel } from "../../ui/Panel.tsx";
import { Separator } from "../../ui/Separator.tsx";

type LoadState = "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";

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

export function CompanyPage() {
  const desktop = isDesktopRuntime();
  const [loadState, setLoadState] = useState<LoadState>(() =>
    isDesktopRuntime() ? "loading" : "ready",
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState<CompanyProfile>(DEFAULT_COMPANY_PROFILE);
  const [draft, setDraft] = useState<CompanyProfileFields>(
    DEFAULT_COMPANY_PROFILE_FIELDS,
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(toFields(saved)),
    [draft, saved],
  );
  const busy = saveState === "saving" || logoBusy;

  useEffect(() => {
    if (!desktop) {
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const profile = await readCompanyProfile();
        if (cancelled) {
          return;
        }
        setSaved(profile);
        setDraft(toFields(profile));
        setLoadState("ready");
      } catch (error) {
        if (!cancelled) {
          setLoadState("error");
          setLoadError(
            error instanceof DesktopClientError || error instanceof Error
              ? error.message
              : "Impossibile caricare il profilo aziendale.",
          );
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  const updateDraft = (patch: Partial<CompanyProfileFields>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setSaveState("idle");
    setSaveError(null);
    setFeedback(null);
  };

  const handleSave = async () => {
    if (!dirty || busy) {
      return;
    }
    setSaveState("saving");
    setSaveError(null);
    setFeedback(null);
    try {
      const next = await writeCompanyProfile(draft);
      setSaved(next);
      setDraft(toFields(next));
      setSaveState("saved");
      setFeedback("Profilo aziendale salvato.");
    } catch (error) {
      setSaveState("error");
      setSaveError(
        error instanceof DesktopClientError || error instanceof Error
          ? error.message
          : "Impossibile salvare il profilo aziendale.",
      );
    }
  };

  const handleSelectLogo = async () => {
    setLogoBusy(true);
    setFeedback(null);
    setSaveError(null);
    try {
      const result = await requestSelectCompanyLogo();
      if (result.status === "cancelled") {
        setFeedback("Selezione logo annullata.");
        return;
      }
      setSaved(result.profile);
      setFeedback("Logo aggiornato.");
    } catch (error) {
      setSaveError(
        error instanceof DesktopClientError || error instanceof Error
          ? error.message
          : "Impossibile aggiornare il logo.",
      );
    } finally {
      setLogoBusy(false);
    }
  };

  const handleRemoveLogo = async () => {
    setLogoBusy(true);
    setFeedback(null);
    setSaveError(null);
    try {
      const profile = await requestRemoveCompanyLogo();
      setSaved(profile);
      setFeedback("Logo rimosso.");
    } catch (error) {
      setSaveError(
        error instanceof DesktopClientError || error instanceof Error
          ? error.message
          : "Impossibile rimuovere il logo.",
      );
    } finally {
      setLogoBusy(false);
    }
  };

  return (
    <div className="page page-form page-enter" data-testid="page-company">
      <PageHeader
        eyebrow="Configurazione"
        title="Azienda"
        description={`Dati dell’attività usati nei documenti commerciali. Non usare ${PRODUCT_DISPLAY_NAME} come ragione sociale.`}
        actions={
          <>
            {dirty ? <Badge tone="warning">modifiche non salvate</Badge> : null}
            {saveState === "saved" ? <Badge tone="success">salvato</Badge> : null}
            <Button
              variant="primary"
              disabled={!desktop || busy || !dirty || loadState !== "ready"}
              onClick={() => {
                void handleSave();
              }}
            >
              {saveState === "saving" ? "Salvataggio…" : "Salva profilo"}
            </Button>
          </>
        }
      />

      <Separator />

      {!desktop ? (
        <Panel title="Anteprima browser" tone="muted">
          <p>
            Il profilo aziendale si salva solo nell’app desktop Electron.
          </p>
        </Panel>
      ) : null}

      {loadState === "loading" ? (
        <p className="status-line">Caricamento profilo…</p>
      ) : null}

      {loadState === "error" ? (
        <Panel title="Errore di caricamento" tone="danger">
          <p>{loadError}</p>
        </Panel>
      ) : null}

      {loadState === "ready" ? (
        <>
          {saveError ? (
            <Panel title="Salvataggio non riuscito" tone="danger">
              <p>{saveError}</p>
            </Panel>
          ) : null}
          {feedback ? (
            <p className="ui-hint" data-testid="company-feedback">
              {feedback}
            </p>
          ) : null}

          <Panel title="Identità aziendale" data-testid="company-identity">
            <div className="company-form-grid">
              <label>
                <span>Ragione sociale / nome attività</span>
                <input
                  value={draft.legalName}
                  disabled={busy || !desktop}
                  onChange={(event) =>
                    updateDraft({ legalName: event.target.value })
                  }
                />
              </label>
              <label>
                <span>Nome commerciale</span>
                <input
                  value={draft.tradeName ?? ""}
                  disabled={busy || !desktop}
                  onChange={(event) =>
                    updateDraft({ tradeName: event.target.value || null })
                  }
                />
              </label>
            </div>

            <div className="company-logo-block">
              <p className="settings-copy">
                Logo aziendale (PNG, JPEG, WebP o GIF, max 512 KB)
              </p>
              {saved.hasLogo && saved.logoDataUrl ? (
                <img
                  className="company-logo-preview"
                  src={saved.logoDataUrl}
                  alt="Anteprima logo aziendale"
                />
              ) : (
                <p className="ui-hint">Nessun logo caricato.</p>
              )}
              <div className="settings-actions">
                <Button
                  variant="secondary"
                  disabled={!desktop || busy}
                  onClick={() => {
                    void handleSelectLogo();
                  }}
                >
                  {logoBusy ? "Operazione logo…" : "Seleziona logo…"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={!desktop || busy || !saved.hasLogo}
                  onClick={() => {
                    void handleRemoveLogo();
                  }}
                >
                  Rimuovi logo
                </Button>
              </div>
            </div>
          </Panel>

          <Panel title="Dati fiscali" data-testid="company-fiscal">
            <div className="company-form-grid">
              <label>
                <span>Partita IVA</span>
                <input
                  value={draft.vatNumber ?? ""}
                  disabled={busy || !desktop}
                  onChange={(event) =>
                    updateDraft({ vatNumber: event.target.value || null })
                  }
                />
              </label>
              <label>
                <span>Codice fiscale</span>
                <input
                  value={draft.taxCode ?? ""}
                  disabled={busy || !desktop}
                  onChange={(event) =>
                    updateDraft({ taxCode: event.target.value || null })
                  }
                />
              </label>
            </div>
          </Panel>

          <Panel title="Sede e contatti" data-testid="company-contacts">
            <div className="company-form-grid">
              <label className="company-span-2">
                <span>Indirizzo</span>
                <input
                  value={draft.address ?? ""}
                  disabled={busy || !desktop}
                  onChange={(event) =>
                    updateDraft({ address: event.target.value || null })
                  }
                />
              </label>
            </div>
            <div className="company-form-grid company-form-grid--address">
              <label>
                <span>CAP</span>
                <input
                  value={draft.postalCode ?? ""}
                  disabled={busy || !desktop}
                  onChange={(event) =>
                    updateDraft({ postalCode: event.target.value || null })
                  }
                />
              </label>
              <label>
                <span>Città</span>
                <input
                  value={draft.city ?? ""}
                  disabled={busy || !desktop}
                  onChange={(event) =>
                    updateDraft({ city: event.target.value || null })
                  }
                />
              </label>
              <label>
                <span>Provincia</span>
                <input
                  value={draft.province ?? ""}
                  disabled={busy || !desktop}
                  onChange={(event) =>
                    updateDraft({ province: event.target.value || null })
                  }
                />
              </label>
              <label>
                <span>Paese</span>
                <input
                  value={draft.country}
                  disabled={busy || !desktop}
                  onChange={(event) =>
                    updateDraft({ country: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="company-form-grid">
              <label>
                <span>Email</span>
                <input
                  type="email"
                  value={draft.email ?? ""}
                  disabled={busy || !desktop}
                  onChange={(event) =>
                    updateDraft({ email: event.target.value || null })
                  }
                />
              </label>
              <label>
                <span>Telefono</span>
                <input
                  value={draft.phone ?? ""}
                  disabled={busy || !desktop}
                  onChange={(event) =>
                    updateDraft({ phone: event.target.value || null })
                  }
                />
              </label>
              <label className="company-span-2">
                <span>Sito web</span>
                <input
                  value={draft.website ?? ""}
                  disabled={busy || !desktop}
                  onChange={(event) =>
                    updateDraft({ website: event.target.value || null })
                  }
                />
              </label>
            </div>
          </Panel>

          <Panel title="Documenti commerciali" data-testid="company-terms">
            <div className="company-form-grid">
              <label className="company-span-2">
                <span>Condizioni predefinite dei preventivi</span>
                <textarea
                  rows={4}
                  value={draft.defaultQuoteTerms ?? ""}
                  disabled={busy || !desktop}
                  onChange={(event) =>
                    updateDraft({
                      defaultQuoteTerms: event.target.value || null,
                    })
                  }
                />
              </label>
            </div>
          </Panel>
        </>
      ) : null}
    </div>
  );
}
