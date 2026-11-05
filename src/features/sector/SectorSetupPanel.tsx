import { useState } from "react";
import {
  BUSINESS_SECTORS,
  type BusinessSectorId,
} from "../../../shared/business-sector.ts";
import { PRODUCT_DISPLAY_NAME } from "../../../shared/modules.ts";
import { Button } from "../../ui/Button.tsx";
import { Panel } from "../../ui/Panel.tsx";

type SectorSetupPanelProps = {
  mode: "first-run" | "settings";
  initialSectorId?: BusinessSectorId | null;
  busy?: boolean;
  error?: string | null;
  feedback?: string | null;
  onConfirm: (sectorId: BusinessSectorId) => void | Promise<void>;
  onSkip?: () => void;
  onCancel?: () => void;
};

export function SectorSetupPanel({
  mode,
  initialSectorId = null,
  busy = false,
  error = null,
  feedback = null,
  onConfirm,
  onSkip,
  onCancel,
}: SectorSetupPanelProps) {
  const [selected, setSelected] = useState<BusinessSectorId | null>(
    initialSectorId,
  );

  const title =
    mode === "first-run"
      ? "Configurazione settore"
      : "Modifica settore aziendale";

  return (
    <Panel
      title={title}
      className="sector-setup-panel"
      data-testid={
        mode === "first-run" ? "sector-setup-first-run" : "sector-setup-settings"
      }
    >
      <p className="settings-copy">
        {PRODUCT_DISPLAY_NAME} adatta i moduli disponibili al tipo di attività.
        La scelta non modifica i dati già presenti (anagrafiche, preventivi) e non
        è la ragione sociale dell’azienda: il profilo fiscale resta nelle
        Impostazioni.
      </p>

      {mode === "settings" ? (
        <p className="ui-hint" data-testid="sector-change-warning">
          Cambiare settore aggiorna solo i moduli visibili. Non importa dati
          specifici di un altro settore e non elimina tabelle o record esistenti.
        </p>
      ) : (
        <p className="ui-hint">
          Puoi continuare senza scegliere ora: verrà usata temporaneamente la
          configurazione generale. Potrai completare la scelta in Impostazioni.
        </p>
      )}

      <fieldset className="settings-fieldset sector-options" disabled={busy}>
        <legend>Settore</legend>
        <div className="settings-options sector-options-list">
          {BUSINESS_SECTORS.map((sector) => (
            <label key={sector.id} className="settings-option sector-option">
              <input
                type="radio"
                name="businessSector"
                value={sector.id}
                checked={selected === sector.id}
                disabled={busy}
                onChange={() => setSelected(sector.id)}
              />
              <span className="sector-option-body">
                <strong>{sector.label}</strong>
                <span className="sector-option-desc">{sector.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {error ? (
        <Panel title="Operazione non riuscita" tone="danger">
          <p>{error}</p>
        </Panel>
      ) : null}
      {feedback ? (
        <p className="ui-hint" data-testid="sector-feedback">
          {feedback}
        </p>
      ) : null}

      <div className="settings-actions">
        <Button
          variant="primary"
          disabled={busy || selected === null}
          data-testid="sector-confirm"
          onClick={() => {
            if (selected) {
              void onConfirm(selected);
            }
          }}
        >
          {busy ? "Salvataggio…" : "Conferma settore"}
        </Button>
        {mode === "first-run" && onSkip ? (
          <Button
            variant="ghost"
            disabled={busy}
            data-testid="sector-skip"
            onClick={onSkip}
          >
            Continua senza configurare
          </Button>
        ) : null}
        {mode === "settings" && onCancel ? (
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Annulla
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}
