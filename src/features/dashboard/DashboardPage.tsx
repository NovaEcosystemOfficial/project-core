import { useEffect, useState } from "react";
import type { BusinessSectorConfig } from "../../../shared/business-sector.ts";
import {
  getBusinessSectorDefinition,
} from "../../../shared/business-sector.ts";
import type { PublicModuleInfo } from "../../../shared/desktop-api.ts";
import { PRODUCT_DISPLAY_NAME } from "../../../shared/modules.ts";
import {
  isDesktopRuntime,
  listParties,
  listQuotes,
  readCompanyProfile,
} from "../../desktop/desktopBridge.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { PageHeader } from "../../ui/PageHeader.tsx";
import { Panel } from "../../ui/Panel.tsx";
import { Separator } from "../../ui/Separator.tsx";

type DashboardPageProps = {
  modules: PublicModuleInfo[];
  sectorConfig: BusinessSectorConfig;
  /** True while setup wizard is unfinished — drives residual onboarding cues. */
  showOnboardingCues: boolean;
  sectorNotice: string | null;
  onOpenModule: (id: PublicModuleInfo["id"]) => void;
  onOpenSectorSetup: () => void;
};

type SnapshotState =
  | { status: "idle" | "loading" }
  | {
      status: "ready";
      companyName: string;
      companyComplete: boolean;
      partiesTotal: number;
      quotesTotal: number;
    }
  | { status: "error"; message: string };

export function DashboardPage({
  modules,
  sectorConfig,
  showOnboardingCues,
  sectorNotice,
  onOpenModule,
  onOpenSectorSetup,
}: DashboardPageProps) {
  const [snapshot, setSnapshot] = useState<SnapshotState>(() =>
    isDesktopRuntime() ? { status: "loading" } : { status: "idle" },
  );
  const desktop = isDesktopRuntime();

  const quickAccess = modules.filter((module) =>
    ["anagrafiche", "preventivi", "magazzino", "company"].includes(module.id),
  );

  const showSectorOnboardingAlert =
    showOnboardingCues && !sectorConfig.configured;

  useEffect(() => {
    if (!desktop) {
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const [profile, parties, quotes] = await Promise.all([
          readCompanyProfile(),
          listParties({ search: "", status: "active", page: 1, pageSize: 1 }),
          listQuotes({
            search: "",
            lifecycleStatus: "all",
            archive: "active",
            page: 1,
            pageSize: 1,
          }),
        ]);
        if (cancelled) {
          return;
        }
        const companyComplete = profile.legalName.trim().length > 0;
        setSnapshot({
          status: "ready",
          companyName:
            profile.legalName.trim() || profile.tradeName?.trim() || "",
          companyComplete,
          partiesTotal: parties.total,
          quotesTotal: quotes.total,
        });
      } catch (error) {
        if (!cancelled) {
          setSnapshot({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Impossibile caricare il riepilogo.",
          });
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [desktop, sectorConfig.configured, sectorConfig.sectorId]);

  return (
    <div className="page page-wide page-enter" data-testid="page-dashboard">
      <PageHeader
        eyebrow={PRODUCT_DISPLAY_NAME}
        title="Dashboard"
        description="Riepilogo operativo e accessi rapidi ai moduli disponibili per questa installazione."
        actions={
          sectorConfig.configured && sectorConfig.sectorId ? (
            <Badge tone="neutral" data-testid="dashboard-sector-badge">
              {getBusinessSectorDefinition(sectorConfig.sectorId).label}
            </Badge>
          ) : showOnboardingCues ? (
            <Badge tone="warning" data-testid="dashboard-sector-badge">
              settore non configurato
            </Badge>
          ) : null
        }
      />

      <Separator />

      {sectorNotice ? (
        <p className="ui-hint" data-testid="sector-shell-feedback">
          {sectorNotice}
        </p>
      ) : null}

      {showSectorOnboardingAlert ? (
        <div
          className="dashboard-alert"
          data-testid="dashboard-sector-status"
          role="status"
        >
          <div>
            <p className="dashboard-alert-title">Settore non configurato</p>
            <p className="dashboard-alert-copy">
              Completa la configurazione iniziale o scegli un settore in
              Impostazioni. I moduli comuni restano disponibili.
            </p>
          </div>
          <Button
            variant="secondary"
            data-testid="dashboard-configure-sector"
            onClick={onOpenSectorSetup}
          >
            Configura settore
          </Button>
        </div>
      ) : null}

      <section className="page-section" aria-label="Riepilogo operativo">
        <h3 className="page-section-title">Riepilogo operativo</h3>
        {!desktop ? (
          <Panel tone="muted">
            <p>Il riepilogo dati è disponibile nell’app desktop.</p>
          </Panel>
        ) : null}
        {snapshot.status === "loading" ? (
          <p className="status-line">Caricamento riepilogo…</p>
        ) : null}
        {snapshot.status === "error" ? (
          <Panel title="Riepilogo non disponibile" tone="danger">
            <p>{snapshot.message}</p>
          </Panel>
        ) : null}
        {snapshot.status === "ready" ? (
          <div className="summary-grid">
            <Panel
              tone="muted"
              as="article"
              className="summary-card"
              data-testid="summary-parties"
            >
              <p className="summary-label">Anagrafiche attive</p>
              <p className="summary-value">{snapshot.partiesTotal}</p>
              <p className="summary-meta">
                {snapshot.partiesTotal === 0
                  ? "Nessuna scheda attiva."
                  : "Clienti e fornitori attivi."}
              </p>
              <Button variant="ghost" onClick={() => onOpenModule("anagrafiche")}>
                Apri Anagrafiche
              </Button>
            </Panel>
            <Panel
              tone="muted"
              as="article"
              className="summary-card"
              data-testid="summary-quotes"
            >
              <p className="summary-label">Preventivi attivi</p>
              <p className="summary-value">{snapshot.quotesTotal}</p>
              <p className="summary-meta">
                {snapshot.quotesTotal === 0
                  ? "Nessun documento attivo."
                  : "Documenti commerciali non archiviati."}
              </p>
              <Button variant="ghost" onClick={() => onOpenModule("preventivi")}>
                Apri Documenti commerciali
              </Button>
            </Panel>
            <Panel
              tone="muted"
              as="article"
              className="summary-card"
              data-testid="summary-company"
            >
              <div className="module-card-top">
                <p className="summary-label">Profilo aziendale</p>
                {snapshot.companyComplete ? (
                  <Badge tone="neutral">impostato</Badge>
                ) : showOnboardingCues ? (
                  <Badge tone="warning">da completare</Badge>
                ) : (
                  <Badge tone="neutral">non impostato</Badge>
                )}
              </div>
              <p className="summary-value summary-value-text">
                {snapshot.companyComplete ? snapshot.companyName : "—"}
              </p>
              <p className="summary-meta">
                {snapshot.companyComplete
                  ? "Ragione sociale disponibile per i documenti."
                  : showOnboardingCues
                    ? "Inserisci i dati in Azienda quando sei pronto."
                    : "Modificabile dalla pagina Azienda."}
              </p>
              <Button variant="ghost" onClick={() => onOpenModule("company")}>
                Apri Azienda
              </Button>
            </Panel>
          </div>
        ) : null}
      </section>

      <section className="page-section" aria-label="Accessi rapidi">
        <h3 className="page-section-title">Accessi rapidi</h3>
        {quickAccess.length === 0 ? (
          <Panel tone="muted">
            <p>Nessun modulo operativo disponibile per il settore attuale.</p>
          </Panel>
        ) : (
          <div className="module-grid">
            {quickAccess.map((module) => (
              <Panel
                key={module.id}
                as="article"
                className="module-card"
                tone="muted"
              >
                <h3 className="module-card-title">{module.label}</h3>
                <p className="module-card-copy">{module.description}</p>
                <Button variant="ghost" onClick={() => onOpenModule(module.id)}>
                  Apri {module.label}
                </Button>
              </Panel>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
