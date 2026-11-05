import { useCallback, useEffect, useMemo, useState } from "react";
import {
  emptyQuoteItemInput,
  QUOTE_PAGE_SIZE_DEFAULT,
  QUOTE_VAT_RATE_BPS,
  type QuoteDto,
  type QuoteItemInput,
  type QuoteLifecycleStatus,
  type QuoteListArchiveFilter,
  type QuoteListItemDto,
  type QuoteWriteInput,
} from "../../../shared/quotes.ts";
import { QUOTE_VAT_RATE_LABELS } from "../../../shared/quotes-money.ts";
import type { QuoteCustomerOption } from "../../../shared/desktop-api.ts";
import {
  archiveQuote,
  changeQuoteStatus,
  createQuote,
  DesktopClientError,
  getQuote,
  isDesktopRuntime,
  listQuoteCustomerOptions,
  listQuotes,
  exportQuotePdf,
  printQuote,
  reactivateQuote,
  updateQuote,
} from "../../desktop/desktopBridge.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { PageHeader } from "../../ui/PageHeader.tsx";
import { Panel } from "../../ui/Panel.tsx";
import { Separator } from "../../ui/Separator.tsx";

type ViewMode = "list" | "create" | "edit" | "detail";
type Feedback =
  | { tone: "success" | "info"; message: string }
  | { tone: "danger"; message: string }
  | null;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function lifecycleLabel(status: QuoteLifecycleStatus): string {
  switch (status) {
    case "draft":
      return "Bozza";
    case "sent":
      return "Inviato";
    case "accepted":
      return "Accettato";
    case "rejected":
      return "Rifiutato";
    case "expired":
      return "Scaduto";
    default:
      return status;
  }
}

function lifecycleTone(
  status: QuoteLifecycleStatus,
): "neutral" | "success" | "warning" | "danger" {
  switch (status) {
    case "accepted":
      return "success";
    case "rejected":
    case "expired":
      return "danger";
    case "sent":
      return "warning";
    default:
      return "neutral";
  }
}

function publicErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof DesktopClientError || error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function quoteToWriteInput(quote: QuoteDto): QuoteWriteInput {
  return {
    partyId: quote.partyId,
    issueDate: quote.issueDate,
    dueDate: quote.dueDate,
    notes: quote.notes,
    items: quote.items.map(
      (item): QuoteItemInput => ({
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unitPrice,
        discountPercent: item.discountPercent,
        vatRatePercent: item.vatRatePercent,
      }),
    ),
  };
}

export function PreventiviPage() {
  const desktop = isDesktopRuntime();
  const [view, setView] = useState<ViewMode>("list");
  const [items, setItems] = useState<QuoteListItemDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [archiveFilter, setArchiveFilter] =
    useState<QuoteListArchiveFilter>("active");
  const [lifecycleFilter, setLifecycleFilter] = useState<
    QuoteLifecycleStatus | "all"
  >("all");
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<QuoteDto | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<QuoteWriteInput>({
    partyId: "",
    issueDate: todayIso(),
    dueDate: null,
    notes: null,
    items: [emptyQuoteItemInput()],
  });
  const [customers, setCustomers] = useState<QuoteCustomerOption[]>([]);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);

  const pageSize = QUOTE_PAGE_SIZE_DEFAULT;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canEditDraft =
    view === "create" ||
    (view === "edit" && detail?.lifecycleStatus === "draft" && !detail.archived);

  const reloadList = useCallback(async () => {
    if (!desktop) {
      setItems([]);
      setTotal(0);
      setListLoading(false);
      return;
    }
    setListLoading(true);
    setListError(null);
    try {
      const result = await listQuotes({
        search,
        archive: archiveFilter,
        lifecycleStatus: lifecycleFilter,
        page,
        pageSize,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (error) {
      setListError(
        publicErrorMessage(error, "Impossibile caricare i preventivi."),
      );
    } finally {
      setListLoading(false);
    }
  }, [archiveFilter, desktop, lifecycleFilter, page, pageSize, search]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!desktop) {
        if (!cancelled) {
          setItems([]);
          setTotal(0);
          setListLoading(false);
        }
        return;
      }
      try {
        const result = await listQuotes({
          search,
          archive: archiveFilter,
          lifecycleStatus: lifecycleFilter,
          page,
          pageSize,
        });
        if (cancelled) return;
        setItems(result.items);
        setTotal(result.total);
        setListLoading(false);
        setListError(null);
      } catch (error) {
        if (cancelled) return;
        setListLoading(false);
        setListError(
          publicErrorMessage(error, "Impossibile caricare i preventivi."),
        );
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [archiveFilter, desktop, lifecycleFilter, page, pageSize, search]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = searchInput.trim();
      setSearch((current) => (current === next ? current : next));
      setPage(1);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  const loadCustomers = useCallback(async () => {
    try {
      const options = await listQuoteCustomerOptions({});
      setCustomers(options);
    } catch {
      setCustomers([]);
    }
  }, []);

  const openCreate = async () => {
    setFeedback(null);
    setConfirmArchiveId(null);
    setEditingId(null);
    setDetail(null);
    setDraft({
      partyId: "",
      issueDate: todayIso(),
      dueDate: null,
      notes: null,
      items: [emptyQuoteItemInput()],
    });
    await loadCustomers();
    setView("create");
  };

  const openDetail = async (id: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      const quote = await getQuote(id);
      setDetail(quote);
      setView("detail");
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: publicErrorMessage(error, "Impossibile aprire il preventivo."),
      });
    } finally {
      setBusy(false);
    }
  };

  const openEdit = async (id: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      const quote = await getQuote(id);
      if (quote.lifecycleStatus !== "draft" || quote.archived) {
        setDetail(quote);
        setView("detail");
        setFeedback({
          tone: "info",
          message:
            "Solo le bozze non archiviate sono modificabili. Usa le azioni di stato per eventuali riaperture esplicite.",
        });
        return;
      }
      setDetail(quote);
      setEditingId(quote.id);
      setDraft(quoteToWriteInput(quote));
      await loadCustomers();
      setView("edit");
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: publicErrorMessage(error, "Impossibile aprire l’editor."),
      });
    } finally {
      setBusy(false);
    }
  };

  const updateItem = (index: number, patch: Partial<QuoteItemInput>) => {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    }));
  };

  const moveItem = (index: number, direction: -1 | 1) => {
    setDraft((current) => {
      const next = current.items.slice();
      const target = index + direction;
      if (target < 0 || target >= next.length) {
        return current;
      }
      const tmp = next[index]!;
      next[index] = next[target]!;
      next[target] = tmp;
      return { ...current, items: next };
    });
  };

  const submitDraft = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      if (view === "create") {
        const created = await createQuote(draft);
        setFeedback({
          tone: "success",
          message: `Preventivo ${created.number} creato.`,
        });
        setDetail(created);
        setView("detail");
      } else if (view === "edit" && editingId) {
        const updated = await updateQuote({ id: editingId, ...draft });
        setFeedback({
          tone: "success",
          message: `Preventivo ${updated.number} aggiornato.`,
        });
        setDetail(updated);
        setView("detail");
      }
      await reloadList();
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: publicErrorMessage(error, "Salvataggio non riuscito."),
      });
    } finally {
      setBusy(false);
    }
  };

  const runStatusChange = async (
    id: string,
    lifecycleStatus: QuoteLifecycleStatus,
  ) => {
    setBusy(true);
    setFeedback(null);
    try {
      const updated = await changeQuoteStatus({ id, lifecycleStatus });
      setDetail(updated);
      setFeedback({
        tone: "success",
        message: `Stato aggiornato: ${lifecycleLabel(lifecycleStatus)}.`,
      });
      await reloadList();
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: publicErrorMessage(error, "Cambio stato non riuscito."),
      });
    } finally {
      setBusy(false);
    }
  };

  const runArchive = async (id: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      const updated = await archiveQuote(id);
      setDetail(updated);
      setConfirmArchiveId(null);
      setFeedback({
        tone: "success",
        message: `Preventivo ${updated.number} archiviato.`,
      });
      await reloadList();
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: publicErrorMessage(error, "Archiviazione non riuscita."),
      });
    } finally {
      setBusy(false);
    }
  };

  const runReactivate = async (id: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      const updated = await reactivateQuote(id);
      setDetail(updated);
      setFeedback({
        tone: "success",
        message: `Preventivo ${updated.number} ripristinato.`,
      });
      await reloadList();
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: publicErrorMessage(error, "Ripristino non riuscito."),
      });
    } finally {
      setBusy(false);
    }
  };

  const runPrint = async (id: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await printQuote(id);
      if (result.status === "completed") {
        setFeedback({
          tone: "success",
          message: "Stampa inviata al sistema.",
        });
      } else {
        setFeedback({
          tone: "info",
          message: "Stampa annullata.",
        });
      }
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: publicErrorMessage(error, "Stampa non riuscita."),
      });
    } finally {
      setBusy(false);
    }
  };

  const runExportPdf = async (id: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await exportQuotePdf(id);
      if (result.status === "completed") {
        setFeedback({
          tone: "success",
          message: `PDF salvato come “${result.fileName}”.`,
        });
      } else {
        setFeedback({
          tone: "info",
          message: "Esportazione PDF annullata.",
        });
      }
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: publicErrorMessage(error, "Esportazione PDF non riuscita."),
      });
    } finally {
      setBusy(false);
    }
  };

  const rangeLabel = useMemo(() => {
    if (total === 0) return "Nessun risultato";
    const from = (page - 1) * pageSize + 1;
    const to = Math.min(page * pageSize, total);
    return `${from}–${to} di ${total}`;
  }, [page, pageSize, total]);

  if (!desktop) {
    return (
      <div className="page page-enter" data-testid="page-preventivi">
        <PageHeader
          eyebrow="Documenti commerciali"
          title="Preventivi"
          description="I preventivi sono disponibili nell’app desktop."
        />
        <Panel title="Anteprima browser" tone="muted">
          <p>Apri ProjectCore come applicazione Electron per gestire i preventivi locali.</p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="page page-enter" data-testid="page-preventivi">
      <PageHeader
        eyebrow="Documenti commerciali"
        title="Preventivi"
        description="Modulo attuale: preventivi collegati ai clienti. Solo le bozze sono modificabili; gli stati successivi richiedono azioni esplicite."
      />
      <Separator />

      {feedback ? (
        <Panel
          title={feedback.tone === "danger" ? "Attenzione" : "Esito"}
          tone={feedback.tone === "danger" ? "danger" : "muted"}
          data-testid="quotes-feedback"
        >
          <p>{feedback.message}</p>
        </Panel>
      ) : null}

      {view === "list" ? (
        <Panel title="Elenco" data-testid="quotes-list-panel">
          <div className="parties-toolbar">
            <label className="parties-search">
              <span className="sr-only">Cerca preventivi</span>
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Cerca per numero o cliente"
                disabled={busy}
              />
            </label>
            <label className="parties-filter">
              <span>Archivio</span>
              <select
                value={archiveFilter}
                onChange={(event) => {
                  setArchiveFilter(event.target.value as QuoteListArchiveFilter);
                  setPage(1);
                }}
                disabled={busy}
              >
                <option value="active">Attivi</option>
                <option value="archived">Archiviati</option>
                <option value="all">Tutti</option>
              </select>
            </label>
            <label className="parties-filter">
              <span>Stato</span>
              <select
                value={lifecycleFilter}
                onChange={(event) => {
                  setLifecycleFilter(
                    event.target.value as QuoteLifecycleStatus | "all",
                  );
                  setPage(1);
                }}
                disabled={busy}
              >
                <option value="all">Tutti</option>
                <option value="draft">Bozza</option>
                <option value="sent">Inviato</option>
                <option value="accepted">Accettato</option>
                <option value="rejected">Rifiutato</option>
                <option value="expired">Scaduto</option>
              </select>
            </label>
            <Button variant="primary" onClick={() => void openCreate()} disabled={busy}>
              Nuovo preventivo
            </Button>
          </div>

          {listLoading ? <p className="parties-status">Caricamento…</p> : null}
          {listError ? (
            <Panel title="Errore" tone="danger">
              <p>{listError}</p>
              <Button variant="secondary" onClick={() => void reloadList()}>
                Riprova
              </Button>
            </Panel>
          ) : null}
          {!listLoading && !listError && items.length === 0 ? (
            <p className="parties-empty" data-testid="quotes-empty">
              Nessun preventivo in questo elenco.
            </p>
          ) : null}
          {!listLoading && items.length > 0 ? (
            <div className="parties-table-wrap">
              <table className="parties-table">
                <thead>
                  <tr>
                    <th>Numero</th>
                    <th>Cliente</th>
                    <th>Data</th>
                    <th>Stato</th>
                    <th>Totale</th>
                    <th>
                      <span className="sr-only">Azioni</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((quote) => (
                    <tr key={quote.id}>
                      <td>
                        <button
                          type="button"
                          className="parties-name-link"
                          onClick={() => void openDetail(quote.id)}
                          disabled={busy}
                        >
                          {quote.number}
                        </button>
                      </td>
                      <td>{quote.customerName}</td>
                      <td>{quote.issueDate}</td>
                      <td>
                        <Badge tone={lifecycleTone(quote.lifecycleStatus)}>
                          {lifecycleLabel(quote.lifecycleStatus)}
                          {quote.archived ? " · arch." : ""}
                        </Badge>
                      </td>
                      <td>€ {quote.total}</td>
                      <td className="parties-row-actions">
                        <Button
                          variant="ghost"
                          onClick={() => void openDetail(quote.id)}
                          disabled={busy}
                        >
                          Apri
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="parties-pagination">
            <span>{rangeLabel}</span>
            <div className="parties-pagination-actions">
              <Button
                variant="secondary"
                disabled={busy || page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Precedente
              </Button>
              <span>
                Pagina {page} / {totalPages}
              </span>
              <Button
                variant="secondary"
                disabled={busy || page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Successiva
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}

      {(view === "create" || view === "edit") && canEditDraft ? (
        <Panel
          title={view === "create" ? "Nuovo preventivo" : `Modifica ${detail?.number ?? ""}`}
          data-testid="quotes-editor"
        >
          <form
            className="parties-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submitDraft();
            }}
          >
            <div className="parties-form-grid">
              <label>
                <span>Cliente *</span>
                <select
                  required
                  value={draft.partyId}
                  disabled={busy}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      partyId: event.target.value,
                    }))
                  }
                >
                  <option value="">Seleziona cliente…</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Data emissione *</span>
                <input
                  type="date"
                  required
                  value={draft.issueDate}
                  disabled={busy}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      issueDate: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>Data scadenza</span>
                <input
                  type="date"
                  value={draft.dueDate ?? ""}
                  disabled={busy}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      dueDate: event.target.value || null,
                    }))
                  }
                />
              </label>
            </div>

            <div className="quotes-items">
              <div className="quotes-items-head">
                <h3>Righe</h3>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      items: [...current.items, emptyQuoteItemInput()],
                    }))
                  }
                >
                  Aggiungi riga
                </Button>
              </div>
              {draft.items.map((item, index) => (
                <div className="quotes-item-row" key={`item-${index}`}>
                  <label className="quotes-item-desc">
                    <span>Descrizione *</span>
                    <input
                      required
                      value={item.description}
                      disabled={busy}
                      onChange={(event) =>
                        updateItem(index, { description: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    <span>Qtà</span>
                    <input
                      required
                      value={item.quantity}
                      disabled={busy}
                      onChange={(event) =>
                        updateItem(index, { quantity: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    <span>UdM</span>
                    <input
                      value={item.unit ?? ""}
                      disabled={busy}
                      onChange={(event) =>
                        updateItem(index, {
                          unit: event.target.value || null,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Prezzo</span>
                    <input
                      required
                      value={item.unitPrice}
                      disabled={busy}
                      onChange={(event) =>
                        updateItem(index, { unitPrice: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    <span>Sconto %</span>
                    <input
                      required
                      value={item.discountPercent}
                      disabled={busy}
                      onChange={(event) =>
                        updateItem(index, {
                          discountPercent: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>IVA</span>
                    <select
                      value={item.vatRatePercent}
                      disabled={busy}
                      onChange={(event) =>
                        updateItem(index, {
                          vatRatePercent: event.target.value,
                        })
                      }
                    >
                      {QUOTE_VAT_RATE_BPS.map((bps) => (
                        <option key={bps} value={String(bps / 100)}>
                          {QUOTE_VAT_RATE_LABELS[bps]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="quotes-item-actions">
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy || index === 0}
                      onClick={() => moveItem(index, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy || index === draft.items.length - 1}
                      onClick={() => moveItem(index, 1)}
                    >
                      ↓
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy || draft.items.length <= 1}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          items: current.items.filter((_, i) => i !== index),
                        }))
                      }
                    >
                      Rimuovi
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <label>
              <span>Note / condizioni</span>
              <textarea
                rows={3}
                value={draft.notes ?? ""}
                disabled={busy}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    notes: event.target.value || null,
                  }))
                }
              />
            </label>

            <p className="ui-hint">
              I totali vengono ricalcolati in modo sicuro nel processo principale
              al salvataggio (importi in centesimi, arrotondamento half-up).
            </p>

            <div className="parties-form-actions">
              <Button type="submit" variant="primary" disabled={busy}>
                {view === "create" ? "Crea preventivo" : "Salva modifiche"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setView(detail ? "detail" : "list");
                }}
              >
                Annulla
              </Button>
            </div>
          </form>
        </Panel>
      ) : null}

      {view === "detail" && detail ? (
        <Panel title={`Preventivo ${detail.number}`} data-testid="quotes-detail">
          <div className="quotes-detail-grid">
            <div>
              <p className="ui-hint">Cliente (fotografia documento)</p>
              <p>
                <strong>{detail.customer.name}</strong>
              </p>
              {detail.customer.address ? <p>{detail.customer.address}</p> : null}
              {detail.customer.taxCode ? <p>CF: {detail.customer.taxCode}</p> : null}
              {detail.customer.vatNumber ? (
                <p>P.IVA: {detail.customer.vatNumber}</p>
              ) : null}
            </div>
            <div>
              <p>Data: {detail.issueDate}</p>
              <p>Scadenza: {detail.dueDate ?? "—"}</p>
              <p>
                Stato:{" "}
                <Badge tone={lifecycleTone(detail.lifecycleStatus)}>
                  {lifecycleLabel(detail.lifecycleStatus)}
                  {detail.archived ? " · archiviato" : ""}
                </Badge>
              </p>
            </div>
          </div>

          <div className="parties-table-wrap" style={{ marginTop: "1rem" }}>
            <table className="parties-table">
              <thead>
                <tr>
                  <th>Descrizione</th>
                  <th>Qtà</th>
                  <th>Prezzo</th>
                  <th>Sconto</th>
                  <th>IVA</th>
                  <th>Totale</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.description}</td>
                    <td>
                      {item.quantity}
                      {item.unit ? ` ${item.unit}` : ""}
                    </td>
                    <td>€ {item.unitPrice}</td>
                    <td>{item.discountPercent}%</td>
                    <td>{item.vatRatePercent}%</td>
                    <td>€ {item.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="quotes-totals">
            <div>
              <span>Imponibile</span>
              <strong>€ {detail.taxable}</strong>
            </div>
            <div>
              <span>IVA</span>
              <strong>€ {detail.vat}</strong>
            </div>
            <div>
              <span>Totale</span>
              <strong>€ {detail.total}</strong>
            </div>
          </div>

          {detail.notes ? (
            <p className="quotes-notes">
              <strong>Note:</strong> {detail.notes}
            </p>
          ) : null}

          <div className="parties-form-actions" style={{ marginTop: "1rem" }}>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setView("list")}
            >
              Torna all’elenco
            </Button>
            {detail.lifecycleStatus === "draft" && !detail.archived ? (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void openEdit(detail.id)}
              >
                Modifica
              </Button>
            ) : null}
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void runExportPdf(detail.id)}
              data-testid="quotes-export-pdf"
            >
              Esporta PDF
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void runPrint(detail.id)}
            >
              Anteprima di stampa
            </Button>
            {detail.lifecycleStatus === "draft" && !detail.archived ? (
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => void runStatusChange(detail.id, "sent")}
              >
                Segna come inviato
              </Button>
            ) : null}
            {detail.lifecycleStatus === "sent" && !detail.archived ? (
              <>
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => void runStatusChange(detail.id, "accepted")}
                >
                  Accetta
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void runStatusChange(detail.id, "rejected")}
                >
                  Rifiuta
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void runStatusChange(detail.id, "draft")}
                >
                  Riapri in bozza
                </Button>
              </>
            ) : null}
            {(detail.lifecycleStatus === "rejected" ||
              detail.lifecycleStatus === "expired") &&
            !detail.archived ? (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void runStatusChange(detail.id, "draft")}
              >
                Riapri in bozza
              </Button>
            ) : null}
            {!detail.archived ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setConfirmArchiveId(detail.id)}
              >
                Archivia
              </Button>
            ) : (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void runReactivate(detail.id)}
              >
                Ripristina
              </Button>
            )}
          </div>
        </Panel>
      ) : null}

      {confirmArchiveId ? (
        <Panel title="Conferma archiviazione" tone="muted">
          <p>
            Il preventivo resterà consultabile tra gli archiviati. Continuare?
          </p>
          <div className="parties-form-actions">
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void runArchive(confirmArchiveId)}
            >
              Conferma
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setConfirmArchiveId(null)}
            >
              Annulla
            </Button>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
