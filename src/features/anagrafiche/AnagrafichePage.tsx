import { useCallback, useEffect, useMemo, useState } from "react";
import {
  emptyPartyWriteFields,
  PARTY_PAGE_SIZE_DEFAULT,
  type PartyDto,
  type PartyListStatusFilter,
  type PartyWriteFields,
} from "../../../shared/parties.ts";
import {
  archiveParty,
  createParty,
  DesktopClientError,
  exportPartiesCsv,
  getParty,
  isDesktopRuntime,
  listParties,
  reactivateParty,
  updateParty,
} from "../../desktop/desktopBridge.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { PageHeader } from "../../ui/PageHeader.tsx";
import { Panel } from "../../ui/Panel.tsx";
import { Separator } from "../../ui/Separator.tsx";

type ListState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

type Feedback =
  | { tone: "success" | "info"; message: string }
  | { tone: "danger"; message: string }
  | null;

type EditorMode = "closed" | "create" | "edit";

function rolesLabel(party: PartyDto): string {
  if (party.isCustomer && party.isSupplier) {
    return "Cliente e fornitore";
  }
  if (party.isCustomer) {
    return "Cliente";
  }
  if (party.isSupplier) {
    return "Fornitore";
  }
  return "—";
}

function toWriteFields(party: PartyDto): PartyWriteFields {
  return {
    displayName: party.displayName,
    isCustomer: party.isCustomer,
    isSupplier: party.isSupplier,
    email: party.email,
    phone: party.phone,
    address: party.address,
    taxCode: party.taxCode,
    vatNumber: party.vatNumber,
    notes: party.notes,
  };
}

function publicErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof DesktopClientError || error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export function AnagrafichePage() {
  const desktop = isDesktopRuntime();
  const [listState, setListState] = useState<ListState>({ status: "loading" });
  const [items, setItems] = useState<PartyDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<PartyListStatusFilter>("active");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("closed");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PartyWriteFields>(emptyPartyWriteFields);
  const [saving, setSaving] = useState(false);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PartyDto | null>(null);
  const [exporting, setExporting] = useState(false);

  const pageSize = PARTY_PAGE_SIZE_DEFAULT;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const busy = saving || exporting;

  const reloadList = useCallback(async () => {
    if (!desktop) {
      setItems([]);
      setTotal(0);
      setListState({ status: "ready" });
      return;
    }
    try {
      const result = await listParties({
        search,
        status: statusFilter,
        page,
        pageSize,
      });
      setItems(result.items);
      setTotal(result.total);
      setListState({ status: "ready" });
    } catch (error) {
      setListState({
        status: "error",
        message: publicErrorMessage(
          error,
          "Impossibile caricare le anagrafiche.",
        ),
      });
    }
  }, [desktop, page, pageSize, search, statusFilter]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!desktop) {
        if (!cancelled) {
          setItems([]);
          setTotal(0);
          setListState({ status: "ready" });
        }
        return;
      }
      try {
        const result = await listParties({
          search,
          status: statusFilter,
          page,
          pageSize,
        });
        if (cancelled) {
          return;
        }
        setItems(result.items);
        setTotal(result.total);
        setListState({ status: "ready" });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setListState({
          status: "error",
          message: publicErrorMessage(
            error,
            "Impossibile caricare le anagrafiche.",
          ),
        });
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [desktop, page, pageSize, search, statusFilter]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = searchInput.trim();
      setSearch((current) => {
        if (current === next) {
          return current;
        }
        return next;
      });
      setPage(1);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  const closeEditor = () => {
    setEditorMode("closed");
    setEditingId(null);
    setDraft(emptyPartyWriteFields());
  };

  const openCreate = () => {
    setFeedback(null);
    setConfirmArchiveId(null);
    setDetail(null);
    setEditingId(null);
    setDraft(emptyPartyWriteFields());
    setEditorMode("create");
  };

  const openEdit = async (id: string) => {
    setFeedback(null);
    setConfirmArchiveId(null);
    setSaving(true);
    try {
      const party = await getParty(id);
      setDetail(party);
      setEditingId(party.id);
      setDraft(toWriteFields(party));
      setEditorMode("edit");
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: publicErrorMessage(error, "Impossibile aprire la scheda."),
      });
    } finally {
      setSaving(false);
    }
  };

  const submitEditor = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      if (editorMode === "create") {
        const created = await createParty(draft);
        setFeedback({
          tone: "success",
          message: `Anagrafica “${created.displayName}” creata.`,
        });
      } else if (editorMode === "edit" && editingId) {
        const updated = await updateParty({ id: editingId, ...draft });
        setFeedback({
          tone: "success",
          message: `Anagrafica “${updated.displayName}” aggiornata.`,
        });
        setDetail(updated);
      }
      closeEditor();
      await reloadList();
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: publicErrorMessage(error, "Operazione non riuscita."),
      });
    } finally {
      setSaving(false);
    }
  };

  const runArchive = async (id: string) => {
    setSaving(true);
    setFeedback(null);
    try {
      const archived = await archiveParty(id);
      setFeedback({
        tone: "success",
        message: `“${archived.displayName}” archiviata.`,
      });
      setConfirmArchiveId(null);
      if (detail?.id === id) {
        setDetail(archived);
      }
      if (editingId === id) {
        closeEditor();
      }
      await reloadList();
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: publicErrorMessage(error, "Archiviazione non riuscita."),
      });
    } finally {
      setSaving(false);
    }
  };

  const runReactivate = async (id: string) => {
    setSaving(true);
    setFeedback(null);
    try {
      const active = await reactivateParty(id);
      setFeedback({
        tone: "success",
        message: `“${active.displayName}” riattivata.`,
      });
      if (detail?.id === id) {
        setDetail(active);
      }
      await reloadList();
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: publicErrorMessage(error, "Riattivazione non riuscita."),
      });
    } finally {
      setSaving(false);
    }
  };

  const runExportCsv = async () => {
    setExporting(true);
    setFeedback(null);
    try {
      const result = await exportPartiesCsv({
        search,
        status: statusFilter,
      });
      if (result.status === "completed") {
        setFeedback({
          tone: "success",
          message: `Esportate ${result.rowCount} anagrafiche in “${result.fileName}”.`,
        });
      } else if (result.status === "cancelled") {
        setFeedback({
          tone: "info",
          message: "Esportazione annullata.",
        });
      } else {
        setFeedback({
          tone: "info",
          message:
            "Nessuna anagrafica da esportare con i filtri attuali. Nessun file creato.",
        });
      }
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: publicErrorMessage(error, "Esportazione non riuscita."),
      });
    } finally {
      setExporting(false);
    }
  };

  const rangeLabel = useMemo(() => {
    if (total === 0) {
      return "Nessun risultato";
    }
    const from = (page - 1) * pageSize + 1;
    const to = Math.min(page * pageSize, total);
    return `${from}–${to} di ${total}`;
  }, [page, pageSize, total]);

  if (!desktop) {
    return (
      <div className="page page-enter" data-testid="page-anagrafiche">
        <PageHeader
          eyebrow="Anagrafiche"
          title="Clienti e fornitori"
          description="Le anagrafiche sono disponibili nell’app desktop."
        />
        <Panel title="Anteprima browser" tone="muted">
          <p>Apri ProjectCore come applicazione Electron per gestire i dati locali.</p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="page page-enter" data-testid="page-anagrafiche">
      <PageHeader
        eyebrow="Anagrafiche"
        title="Clienti e fornitori"
        description="Gestisci le schede anagrafiche locali. Puoi assegnare il ruolo di cliente, fornitore o entrambi."
      />

      <Separator />

      {feedback ? (
        <Panel
          title={feedback.tone === "danger" ? "Attenzione" : "Esito"}
          tone={feedback.tone === "danger" ? "danger" : "muted"}
          data-testid="parties-feedback"
        >
          <p>{feedback.message}</p>
        </Panel>
      ) : null}

      <Panel title="Elenco" data-testid="parties-list-panel">
        <div className="parties-toolbar">
          <label className="parties-search">
            <span className="sr-only">Cerca anagrafiche</span>
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Cerca per nome, email, telefono, CF o P.IVA"
              aria-label="Cerca anagrafiche"
              disabled={busy}
            />
          </label>

          <label className="parties-filter">
            <span>Stato</span>
            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as PartyListStatusFilter);
                setPage(1);
              }}
              disabled={busy}
            >
              <option value="active">Attive</option>
              <option value="archived">Archiviate</option>
              <option value="all">Tutte</option>
            </select>
          </label>

          <Button
            variant="secondary"
            onClick={() => void runExportCsv()}
            disabled={busy}
            data-testid="parties-export-csv"
          >
            {exporting ? "Esportazione…" : "Esporta CSV"}
          </Button>

          <Button variant="primary" onClick={openCreate} disabled={busy}>
            Nuova anagrafica
          </Button>
        </div>

        {listState.status === "loading" ? (
          <p className="parties-status" role="status">
            Caricamento…
          </p>
        ) : null}

        {listState.status === "error" ? (
          <Panel title="Errore di caricamento" tone="danger">
            <p>{listState.message}</p>
            <Button variant="secondary" onClick={() => void reloadList()}>
              Riprova
            </Button>
          </Panel>
        ) : null}

        {listState.status === "ready" && items.length === 0 ? (
          <p className="parties-empty" data-testid="parties-empty">
            Nessuna anagrafica in questo elenco. Crea la prima scheda oppure
            modifica i filtri di ricerca.
          </p>
        ) : null}

        {listState.status === "ready" && items.length > 0 ? (
          <div className="parties-table-wrap" role="region" aria-label="Risultati">
            <table className="parties-table">
              <thead>
                <tr>
                  <th scope="col">Nome</th>
                  <th scope="col">Ruoli</th>
                  <th scope="col">Contatti</th>
                  <th scope="col">Stato</th>
                  <th scope="col">
                    <span className="sr-only">Azioni</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((party) => (
                  <tr key={party.id}>
                    <td>
                      <button
                        type="button"
                        className="parties-name-link"
                        onClick={() => void openEdit(party.id)}
                        disabled={saving}
                      >
                        {party.displayName}
                      </button>
                    </td>
                    <td>{rolesLabel(party)}</td>
                    <td className="parties-contacts">
                      {party.email ?? "—"}
                      {party.phone ? (
                        <>
                          <br />
                          {party.phone}
                        </>
                      ) : null}
                    </td>
                    <td>
                      <Badge
                        tone={party.status === "active" ? "success" : "neutral"}
                      >
                        {party.status === "active" ? "Attiva" : "Archiviata"}
                      </Badge>
                    </td>
                    <td className="parties-row-actions">
                      <Button
                        variant="ghost"
                        onClick={() => void openEdit(party.id)}
                        disabled={saving}
                      >
                        Apri
                      </Button>
                      {party.status === "active" ? (
                        <Button
                          variant="ghost"
                          onClick={() => setConfirmArchiveId(party.id)}
                          disabled={saving}
                        >
                          Archivia
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          onClick={() => void runReactivate(party.id)}
                          disabled={saving}
                        >
                          Riattiva
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="parties-pagination" aria-live="polite">
          <span>{rangeLabel}</span>
          <div className="parties-pagination-actions">
            <Button
              variant="secondary"
              disabled={busy || page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Precedente
            </Button>
            <span>
              Pagina {page} / {totalPages}
            </span>
            <Button
              variant="secondary"
              disabled={busy || page >= totalPages}
              onClick={() =>
                setPage((current) => Math.min(totalPages, current + 1))
              }
            >
              Successiva
            </Button>
          </div>
        </div>
      </Panel>

      {confirmArchiveId ? (
        <Panel title="Conferma archiviazione" tone="muted" data-testid="parties-archive-confirm">
          <p>
            L’anagrafica resterà disponibile nell’elenco archiviate e potrà essere
            riattivata in seguito. Continuare?
          </p>
          <div className="parties-form-actions">
            <Button
              variant="primary"
              disabled={saving}
              onClick={() => void runArchive(confirmArchiveId)}
            >
              Conferma archiviazione
            </Button>
            <Button
              variant="secondary"
              disabled={saving}
              onClick={() => setConfirmArchiveId(null)}
            >
              Annulla
            </Button>
          </div>
        </Panel>
      ) : null}

      {editorMode !== "closed" ? (
        <Panel
          title={editorMode === "create" ? "Nuova anagrafica" : "Modifica anagrafica"}
          data-testid="parties-editor"
        >
          <form
            className="parties-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submitEditor();
            }}
          >
            <label>
              <span>Nome / ragione sociale *</span>
              <input
                required
                value={draft.displayName}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    displayName: event.target.value,
                  }))
                }
                disabled={saving}
                autoFocus
              />
            </label>

            <fieldset className="parties-roles" disabled={saving}>
              <legend>Ruoli *</legend>
              <label className="settings-option">
                <input
                  type="checkbox"
                  checked={draft.isCustomer}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      isCustomer: event.target.checked,
                    }))
                  }
                />
                Cliente
              </label>
              <label className="settings-option">
                <input
                  type="checkbox"
                  checked={draft.isSupplier}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      isSupplier: event.target.checked,
                    }))
                  }
                />
                Fornitore
              </label>
            </fieldset>

            <div className="parties-form-grid">
              <label>
                <span>Email</span>
                <input
                  type="email"
                  value={draft.email ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      email: event.target.value || null,
                    }))
                  }
                  disabled={saving}
                />
              </label>
              <label>
                <span>Telefono</span>
                <input
                  value={draft.phone ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      phone: event.target.value || null,
                    }))
                  }
                  disabled={saving}
                />
              </label>
              <label>
                <span>Codice fiscale</span>
                <input
                  value={draft.taxCode ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      taxCode: event.target.value || null,
                    }))
                  }
                  disabled={saving}
                />
              </label>
              <label>
                <span>Partita IVA</span>
                <input
                  value={draft.vatNumber ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      vatNumber: event.target.value || null,
                    }))
                  }
                  disabled={saving}
                />
              </label>
            </div>

            <label>
              <span>Indirizzo</span>
              <input
                value={draft.address ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    address: event.target.value || null,
                  }))
                }
                disabled={saving}
              />
            </label>

            <label>
              <span>Note</span>
              <textarea
                rows={3}
                value={draft.notes ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    notes: event.target.value || null,
                  }))
                }
                disabled={saving}
              />
            </label>

            <div className="parties-form-actions">
              <Button type="submit" variant="primary" disabled={saving}>
                {editorMode === "create" ? "Crea" : "Salva modifiche"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={saving}
                onClick={closeEditor}
              >
                Annulla
              </Button>
            </div>
          </form>
        </Panel>
      ) : null}
    </div>
  );
}
