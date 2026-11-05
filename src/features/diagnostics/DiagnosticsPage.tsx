import { useEffect, useState } from "react";
import type {
  DesktopAppInfo,
  DesktopDatabaseStatus,
} from "../../../shared/desktop-api.ts";
import {
  isDesktopRuntime,
  readDesktopAppInfo,
  readDesktopDatabaseStatus,
} from "../../desktop/desktopBridge.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { PageHeader } from "../../ui/PageHeader.tsx";
import { Panel } from "../../ui/Panel.tsx";
import { Separator } from "../../ui/Separator.tsx";
import { StatusList } from "../../ui/StatusList.tsx";

type DiagnosticsState =
  | { status: "loading" }
  | { status: "browser" }
  | {
      status: "ready";
      info: DesktopAppInfo;
      database: DesktopDatabaseStatus;
    }
  | { status: "error"; message: string };

type DiagnosticsPageProps = {
  /** Development-only: open Setup Wizard preview without SQLite writes. */
  onOpenSetupWizardPreview?: () => void;
};

export function DiagnosticsPage({
  onOpenSetupWizardPreview,
}: DiagnosticsPageProps) {
  const [state, setState] = useState<DiagnosticsState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!isDesktopRuntime()) {
        if (!cancelled) {
          setState({ status: "browser" });
        }
        return;
      }

      try {
        const [info, database] = await Promise.all([
          readDesktopAppInfo(),
          readDesktopDatabaseStatus(),
        ]);
        if (cancelled) {
          return;
        }
        if (!info || !database) {
          setState({
            status: "error",
            message: "Bridge presente ma i dati desktop/database non sono disponibili.",
          });
          return;
        }
        setState({ status: "ready", info, database });
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Errore bridge desktop",
          });
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page page-enter" data-testid="page-diagnostics">
      <PageHeader
        eyebrow="Sistema"
        title="Diagnostica"
        description="Solo informazioni tecniche: bridge desktop, schema SQLite e runtime. Nessuna impostazione grafica o settore. Il percorso del database non è esposto al renderer."
      />

      <Separator />

      {state.status === "loading" ? (
        <p className="status-line" data-testid="bridge-loading">
          Lettura bridge in corso…
        </p>
      ) : null}

      {state.status === "browser" ? (
        <Panel title="Modalità browser" tone="muted" data-testid="bridge-absent">
          <p>
            <code>window.desktopAPI</code> non è disponibile. Avvia con{" "}
            <code>npm run dev:desktop</code> o <code>npm run start:desktop</code>{" "}
            per verificare bridge e SQLite.
          </p>
        </Panel>
      ) : null}

      {state.status === "error" ? (
        <Panel title="Errore bridge" tone="danger" data-testid="bridge-error">
          <p>{state.message}</p>
        </Panel>
      ) : null}

      {state.status === "ready" ? (
        <div className="panel-stack">
          <Panel title="Bridge desktop" data-testid="bridge-ready">
            <StatusList
              items={[
                { label: "App", value: state.info.appName },
                { label: "Versione", value: state.info.version },
                { label: "Piattaforma", value: state.info.platform },
                {
                  label: "Runtime",
                  value: (
                    <Badge tone={state.info.isDesktop ? "success" : "warning"}>
                      {state.info.isDesktop ? "desktop" : "n/d"}
                    </Badge>
                  ),
                },
              ]}
            />
          </Panel>

          <Panel title="SQLite" data-testid="database-status">
            <StatusList
              items={[
                {
                  label: "Inizializzato",
                  value: (
                    <Badge tone={state.database.initialized ? "success" : "warning"}>
                      {state.database.initialized ? "sì" : "no"}
                    </Badge>
                  ),
                },
                {
                  label: "Schema",
                  value: `v${state.database.schemaVersion}`,
                },
                {
                  label: "Stato",
                  value: (
                    <Badge tone={state.database.healthy ? "success" : "danger"}>
                      {state.database.healthy ? "ok" : "non disponibile"}
                    </Badge>
                  ),
                },
              ]}
            />
            <p className="ui-hint">
              Schema v6: anagrafiche, preventivi, catalogo articoli e movimenti
              di magazzino (<code>stock_movements</code>). Giacenze derivate dallo
              storico; un solo magazzino logico. Niente multi-deposito né
              fatturazione fiscale in questa build.
            </p>
          </Panel>

          {onOpenSetupWizardPreview ? (
            <Panel
              title="Sviluppo"
              tone="muted"
              data-testid="diagnostics-dev-tools"
            >
              <p className="settings-copy">
                Anteprima della procedura guidata (solo build di sviluppo). Non
                modifica stato wizard, settore, profilo o preferenze nel database.
              </p>
              <Button
                variant="secondary"
                data-testid="diagnostics-open-wizard-preview"
                onClick={onOpenSetupWizardPreview}
              >
                Anteprima Setup Wizard
              </Button>
            </Panel>
          ) : null}
        </div>
      ) : null}

      {state.status !== "ready" && onOpenSetupWizardPreview ? (
        <Panel
          title="Sviluppo"
          tone="muted"
          data-testid="diagnostics-dev-tools"
        >
          <p className="settings-copy">
            Anteprima Setup Wizard disponibile in development anche senza bridge
            desktop completo.
          </p>
          <Button
            variant="secondary"
            data-testid="diagnostics-open-wizard-preview"
            onClick={onOpenSetupWizardPreview}
          >
            Anteprima Setup Wizard
          </Button>
        </Panel>
      ) : null}
    </div>
  );
}
