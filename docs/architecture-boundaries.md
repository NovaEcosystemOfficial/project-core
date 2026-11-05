# Confini architetturali (multi-PC futuro)

ProjectCore / GLITCH Digital Studio resta un’installazione desktop locale.
La sincronizzazione multi-PC **non** è implementata: richiederà identità, conflitti,
autorizzazioni e modello di consistenza dedicati.

Confini da mantenere:

1. **UI (renderer)** — presenta dati e raccoglie input; non apre SQLite e non
   costruisce percorsi locali del database.
2. **Contratti condivisi (`shared/`)** — tipi, validazione payload, registro moduli,
   settore; unica fonte di verità per ID e forme dati.
3. **Servizi applicativi (main)** — regole di dominio, transazioni, errori tipizzati.
4. **Repository (main)** — accesso a SQLite dietro i servizi.
5. **Persistenza** — un database locale per installazione; backup/restore file-based.

Le operazioni di dominio passano sempre da IPC → servizio main → repository.
Non introdurre caricamento dinamico di moduli remoti né un falso supporto cloud.

## Magazzino

L’installazione opera con **un solo magazzino logico per azienda**. Non esistono
tabelle o UI per depositi multipli, trasferimenti tra sedi o ubicazioni fisiche.

Un futuro supporto multi-deposito richiederà una migrazione pianificata
(es. tabella `warehouses` + riferimenti sui movimenti), senza riscrivere il
significato storico dei movimenti già registrati.

### Schema movimenti (v6 — `stock_movements`)

Campi: `id`, `article_id` (FK → `articles`, senza `ON DELETE CASCADE`),
`movement_type`, `quantity_milli`, `movement_date`, `reason`, `notes`, `created_at`.

Tipi: `in`, `out`, `adjustment_in`, `adjustment_out`.

### Quantità in millesimi

Tutte le quantità di magazzino sono interi in millesimi di unità:

- `1` pezzo = `1000`
- `2,500 kg` = `2500`
- `0,750 m` = `750`

Per `pcs` solo quantità intere; per le altre unità fino a 3 decimali.
Nessuna conversione automatica tra unità (`kg` ≠ `g`).

### Formula giacenza

`Giacenza = Σ(in + adjustment_in) − Σ(out + adjustment_out)`

Derivata solo dallo storico. Nessuna quantità stock editabile sulla scheda articolo.

### Scarichi e rettifiche

Nella stessa transazione SQLite: calcolo giacenza corrente + inserimento movimento.
Scarico e rettifica negativa non possono superare la giacenza disponibile.
Causale obbligatoria per le rettifiche. Articoli archiviati: consultabili nello
storico, nessun nuovo movimento.

### Immutabilità

I movimenti registrati non si modificano né si cancellano. Correzioni solo con
movimenti compensativi (quando le regole di giacenza lo consentono).

### Limiti attuali

Niente multi-deposito, lotti, barcode, movimenti automatici da preventivi/vendite,
ordini, sync cloud.

## Navigazione UI (Foundation 1.0)

Sidebar raggruppata:

- **Area operativa** — Dashboard, Anagrafiche, Documenti commerciali (`preventivi`),
  Magazzino (se settore compatibile).
- **Configurazione e sistema** — Azienda (profilo), Impostazioni (settore/aspetto/backup),
  Diagnostica (solo runtime tecnico).

La configurazione settore vive nella procedura guidata iniziale e in Impostazioni.
Non è ripetuta nelle pagine operative. Il profilo aziendale è in Azienda (e nel wizard).

## Setup Wizard 1.0

Stato persistente in `app_settings` (`setupWizardState`): `not_started` |
`in_progress` | `completed`, con `currentStep` 1–5.

**Installazioni esistenti (chiave assente):** se profilo (ragione sociale), settore
configurato, o dati operativi (parties/quotes/articles) sono già presenti, lo stato
viene marcato `completed` con `completionSource: legacy_bootstrap` senza
sovrascrivere profilo, settore o preferenze. Installazioni vuote restano
`not_started` e aprono il wizard. Dati corrotti: errore esplicito, nessun overwrite.

**Anteprima sviluppo:** in Vite `import.meta.env.DEV` Diagnostica espone
“Anteprima Setup Wizard”. Usa lo stesso componente con `mode="preview"`: navigazione
locale sui 5 passaggi, nessuna scrittura IPC/SQLite. Assente nelle build di produzione.

**Dopo `completed`:** `shouldShowSetupOnboardingCues` è false. Dashboard e shell non
mostrano avvisi/badge di onboarding. Azienda e Impostazioni restano pagine operative
normali; cambiare settore o profilo non riapre il wizard.
