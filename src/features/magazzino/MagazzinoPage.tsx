import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ARTICLE_PAGE_SIZE_DEFAULT,
  ARTICLE_UNITS,
  emptyArticleWriteFields,
  getArticleUnitLabel,
  type ArticleDto,
  type ArticleListStatusFilter,
  type ArticleUnitId,
  type ArticleWriteFields,
} from "../../../shared/articles.ts";
import {
  formatQuantityItalian,
  STOCK_MOVEMENT_TYPE_LABELS,
  STOCK_MOVEMENT_TYPES,
  STOCK_PAGE_SIZE_DEFAULT,
  type StockBalanceDto,
  type StockBalanceListQuery,
  type StockMovementDto,
  type StockMovementType,
  type WarehouseSummaryDto,
} from "../../../shared/stock-movements.ts";
import {
  archiveArticle,
  createArticle,
  createStockMovement,
  DesktopClientError,
  getArticle,
  getWarehouseSummary,
  isDesktopRuntime,
  listArticles,
  listStockBalances,
  listStockMovements,
  reactivateArticle,
  updateArticle,
} from "../../desktop/desktopBridge.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { PageHeader } from "../../ui/PageHeader.tsx";
import { Panel } from "../../ui/Panel.tsx";
import { Separator } from "../../ui/Separator.tsx";

type Section = "overview" | "catalog" | "stock" | "movement" | "history";

type ListState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

type Feedback =
  | { tone: "success" | "info"; message: string }
  | { tone: "danger"; message: string }
  | null;

type EditorMode = "closed" | "create" | "edit";

function toWriteFields(article: ArticleDto): ArticleWriteFields {
  return {
    code: article.code,
    description: article.description,
    category: article.category,
    unit: article.unit,
    minStock: article.minStock,
    notes: article.notes,
  };
}

function publicErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof DesktopClientError || error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function todayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatMinStock(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return String(value).replace(".", ",");
}

export function MagazzinoPage() {
  const desktop = isDesktopRuntime();
  const [section, setSection] = useState<Section>("overview");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [summary, setSummary] = useState<WarehouseSummaryDto | null>(null);
  const [summaryState, setSummaryState] = useState<ListState>(() =>
    desktop ? { status: "loading" } : { status: "ready" },
  );

  // Catalog state
  const [listState, setListState] = useState<ListState>(() =>
    desktop ? { status: "loading" } : { status: "ready" },
  );
  const [items, setItems] = useState<ArticleDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<ArticleListStatusFilter>("active");
  const [editorMode, setEditorMode] = useState<EditorMode>("closed");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ArticleWriteFields>(emptyArticleWriteFields);
  const [minStockInput, setMinStockInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);

  // Stock balances
  const [balances, setBalances] = useState<StockBalanceDto[]>([]);
  const [balanceTotal, setBalanceTotal] = useState(0);
  const [balancePage, setBalancePage] = useState(1);
  const [balanceSearchInput, setBalanceSearchInput] = useState("");
  const [balanceSearch, setBalanceSearch] = useState("");
  const [balanceFilter, setBalanceFilter] =
    useState<StockBalanceListQuery["filter"]>("active");
  const [balanceState, setBalanceState] = useState<ListState>(() =>
    desktop ? { status: "loading" } : { status: "ready" },
  );

  // Movement form
  const [activeArticles, setActiveArticles] = useState<ArticleDto[]>([]);
  const [movArticleId, setMovArticleId] = useState("");
  const [movType, setMovType] = useState<StockMovementType>("in");
  const [movQty, setMovQty] = useState("");
  const [movDate, setMovDate] = useState(todayIsoDate);
  const [movReason, setMovReason] = useState("");
  const [movNotes, setMovNotes] = useState("");
  const [movSaving, setMovSaving] = useState(false);

  // History
  const [history, setHistory] = useState<StockMovementDto[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historySearchInput, setHistorySearchInput] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyType, setHistoryType] = useState<StockMovementType | "all">(
    "all",
  );
  const [historyState, setHistoryState] = useState<ListState>(() =>
    desktop ? { status: "loading" } : { status: "ready" },
  );

  const pageSize = ARTICLE_PAGE_SIZE_DEFAULT;
  const stockPageSize = STOCK_PAGE_SIZE_DEFAULT;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const balancePages = Math.max(1, Math.ceil(balanceTotal / stockPageSize));
  const historyPages = Math.max(1, Math.ceil(historyTotal / stockPageSize));
  const busy = saving || movSaving;

  const refreshSummary = useCallback(async () => {
    if (!desktop) {
      return;
    }
    try {
      const next = await getWarehouseSummary();
      setSummary(next);
      setSummaryState({ status: "ready" });
    } catch (error) {
      setSummaryState({
        status: "error",
        message: publicErrorMessage(error, "Impossibile caricare il riepilogo."),
      });
    }
  }, [desktop]);

  const reloadCatalog = useCallback(async () => {
    if (!desktop) {
      return;
    }
    try {
      const result = await listArticles({
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
        message: publicErrorMessage(error, "Impossibile caricare gli articoli."),
      });
    }
  }, [desktop, page, pageSize, search, statusFilter]);

  const reloadBalances = useCallback(async () => {
    if (!desktop) {
      return;
    }
    try {
      const result = await listStockBalances({
        search: balanceSearch,
        filter: balanceFilter,
        page: balancePage,
        pageSize: stockPageSize,
      });
      setBalances(result.items);
      setBalanceTotal(result.total);
      setBalanceState({ status: "ready" });
    } catch (error) {
      setBalanceState({
        status: "error",
        message: publicErrorMessage(error, "Impossibile caricare le giacenze."),
      });
    }
  }, [balanceFilter, balancePage, balanceSearch, desktop, stockPageSize]);

  const reloadHistory = useCallback(async () => {
    if (!desktop) {
      return;
    }
    try {
      const result = await listStockMovements({
        search: historySearch,
        articleId: null,
        movementType: historyType,
        dateFrom: null,
        dateTo: null,
        page: historyPage,
        pageSize: stockPageSize,
      });
      setHistory(result.items);
      setHistoryTotal(result.total);
      setHistoryState({ status: "ready" });
    } catch (error) {
      setHistoryState({
        status: "error",
        message: publicErrorMessage(error, "Impossibile caricare lo storico."),
      });
    }
  }, [desktop, historyPage, historySearch, historyType, stockPageSize]);

  const refreshAfterMovement = useCallback(async () => {
    await Promise.all([
      refreshSummary(),
      reloadBalances(),
      reloadHistory(),
    ]);
  }, [refreshSummary, reloadBalances, reloadHistory]);

  useEffect(() => {
    if (!desktop) {
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const next = await getWarehouseSummary();
        if (!cancelled) {
          setSummary(next);
          setSummaryState({ status: "ready" });
        }
      } catch (error) {
        if (!cancelled) {
          setSummaryState({
            status: "error",
            message: publicErrorMessage(
              error,
              "Impossibile caricare il riepilogo.",
            ),
          });
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  useEffect(() => {
    if (!desktop) {
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const result = await listArticles({
          search,
          status: statusFilter,
          page,
          pageSize,
        });
        if (!cancelled) {
          setItems(result.items);
          setTotal(result.total);
          setListState({ status: "ready" });
        }
      } catch (error) {
        if (!cancelled) {
          setListState({
            status: "error",
            message: publicErrorMessage(
              error,
              "Impossibile caricare gli articoli.",
            ),
          });
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [desktop, page, pageSize, search, statusFilter]);

  useEffect(() => {
    if (!desktop || (section !== "stock" && section !== "overview")) {
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const result = await listStockBalances({
          search: balanceSearch,
          filter: balanceFilter,
          page: balancePage,
          pageSize: stockPageSize,
        });
        if (!cancelled) {
          setBalances(result.items);
          setBalanceTotal(result.total);
          setBalanceState({ status: "ready" });
        }
      } catch (error) {
        if (!cancelled) {
          setBalanceState({
            status: "error",
            message: publicErrorMessage(
              error,
              "Impossibile caricare le giacenze.",
            ),
          });
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    balanceFilter,
    balancePage,
    balanceSearch,
    desktop,
    section,
    stockPageSize,
  ]);

  useEffect(() => {
    if (!desktop || (section !== "history" && section !== "overview")) {
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const result = await listStockMovements({
          search: historySearch,
          articleId: null,
          movementType: historyType,
          dateFrom: null,
          dateTo: null,
          page: historyPage,
          pageSize: stockPageSize,
        });
        if (!cancelled) {
          setHistory(result.items);
          setHistoryTotal(result.total);
          setHistoryState({ status: "ready" });
        }
      } catch (error) {
        if (!cancelled) {
          setHistoryState({
            status: "error",
            message: publicErrorMessage(
              error,
              "Impossibile caricare lo storico.",
            ),
          });
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [desktop, historyPage, historySearch, historyType, section, stockPageSize]);

  useEffect(() => {
    if (!desktop || section !== "movement") {
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const result = await listArticles({
          search: "",
          status: "active",
          page: 1,
          pageSize: 100,
        });
        if (cancelled) {
          return;
        }
        setActiveArticles(result.items);
        setMovArticleId((current) => current || result.items[0]?.id || "");
      } catch (error) {
        if (!cancelled) {
          setFeedback({
            tone: "danger",
            message: publicErrorMessage(
              error,
              "Impossibile caricare gli articoli attivi.",
            ),
          });
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [desktop, section]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setBalanceSearch(balanceSearchInput.trim());
      setBalancePage(1);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [balanceSearchInput]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setHistorySearch(historySearchInput.trim());
      setHistoryPage(1);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [historySearchInput]);

  const closeEditor = () => {
    setEditorMode("closed");
    setEditingId(null);
    setDraft(emptyArticleWriteFields());
    setMinStockInput("");
  };

  const openCreate = () => {
    setFeedback(null);
    setConfirmArchiveId(null);
    setEditingId(null);
    setDraft(emptyArticleWriteFields());
    setMinStockInput("");
    setEditorMode("create");
    setSection("catalog");
  };

  const openEdit = async (id: string) => {
    setFeedback(null);
    setConfirmArchiveId(null);
    setSaving(true);
    try {
      const article = await getArticle(id);
      setEditingId(article.id);
      setDraft(toWriteFields(article));
      setMinStockInput(
        article.minStock === null ? "" : String(article.minStock),
      );
      setEditorMode("edit");
      setSection("catalog");
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: publicErrorMessage(error, "Impossibile aprire l’articolo."),
      });
    } finally {
      setSaving(false);
    }
  };

  const parseMinStockFromInput = (): number | null | "invalid" => {
    const raw = minStockInput.trim();
    if (raw === "") {
      return null;
    }
    const value = Number(raw.replace(",", "."));
    if (!Number.isFinite(value) || value < 0) {
      return "invalid";
    }
    return value;
  };

  const submitEditor = async () => {
    const minStock = parseMinStockFromInput();
    if (minStock === "invalid") {
      setFeedback({
        tone: "danger",
        message: "La soglia minima deve essere un numero non negativo.",
      });
      return;
    }
    setSaving(true);
    setFeedback(null);
    const payload: ArticleWriteFields = { ...draft, minStock };
    try {
      if (editorMode === "create") {
        const created = await createArticle(payload);
        setFeedback({
          tone: "success",
          message: `Articolo “${created.code}” creato.`,
        });
      } else if (editorMode === "edit" && editingId) {
        const updated = await updateArticle({ id: editingId, ...payload });
        setFeedback({
          tone: "success",
          message: `Articolo “${updated.code}” aggiornato.`,
        });
      }
      closeEditor();
      await reloadCatalog();
      await refreshSummary();
      await reloadBalances();
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
      const archived = await archiveArticle(id);
      setFeedback({
        tone: "success",
        message: `Articolo “${archived.code}” archiviato.`,
      });
      setConfirmArchiveId(null);
      if (editingId === id) {
        closeEditor();
      }
      await reloadCatalog();
      await refreshSummary();
      await reloadBalances();
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
      const active = await reactivateArticle(id);
      setFeedback({
        tone: "success",
        message: `Articolo “${active.code}” riattivato.`,
      });
      await reloadCatalog();
      await refreshSummary();
      await reloadBalances();
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: publicErrorMessage(error, "Riattivazione non riuscita."),
      });
    } finally {
      setSaving(false);
    }
  };

  const submitMovement = async () => {
    if (!movArticleId) {
      setFeedback({
        tone: "danger",
        message: "Seleziona un articolo attivo.",
      });
      return;
    }
    setMovSaving(true);
    setFeedback(null);
    try {
      const created = await createStockMovement({
        articleId: movArticleId,
        movementType: movType,
        quantity: movQty.trim().replace(",", "."),
        movementDate: movDate,
        reason: movReason.trim() ? movReason.trim() : null,
        notes: movNotes.trim() ? movNotes.trim() : null,
      });
      setFeedback({
        tone: "success",
        message: `Movimento registrato: ${STOCK_MOVEMENT_TYPE_LABELS[created.movementType]} ${formatQuantityItalian(created.quantityMilli)} (${created.articleCode}).`,
      });
      setMovQty("");
      setMovReason("");
      setMovNotes("");
      await refreshAfterMovement();
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: publicErrorMessage(error, "Registrazione non riuscita."),
      });
    } finally {
      setMovSaving(false);
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
      <div className="page page-enter" data-testid="page-magazzino">
        <PageHeader
          eyebrow="Magazzino"
          title="Catalogo e giacenze"
          description="Il magazzino è disponibile nell’app desktop."
        />
        <Panel title="Anteprima browser" tone="muted">
          <p>Apri ProjectCore come applicazione Electron per gestire i dati locali.</p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="page page-enter" data-testid="page-magazzino">
      <PageHeader
        eyebrow="Magazzino"
        title="Catalogo, giacenze e movimenti"
        description="Un solo magazzino logico. La giacenza deriva esclusivamente dallo storico dei movimenti (immutabile)."
      />

      <Separator />

      <div className="parties-toolbar magazzino-nav" role="tablist" aria-label="Sezioni magazzino">
        {(
          [
            ["overview", "Riepilogo"],
            ["catalog", "Catalogo"],
            ["stock", "Giacenze"],
            ["movement", "Registra movimento"],
            ["history", "Storico"],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            variant={section === id ? "primary" : "ghost"}
            data-testid={`magazzino-tab-${id}`}
            onClick={() => setSection(id)}
          >
            {label}
          </Button>
        ))}
      </div>

      {feedback ? (
        <Panel
          title={feedback.tone === "danger" ? "Attenzione" : "Esito"}
          tone={feedback.tone === "danger" ? "danger" : "muted"}
          data-testid="magazzino-feedback"
        >
          <p>{feedback.message}</p>
        </Panel>
      ) : null}

      {section === "overview" ? (
        <>
          <Panel title="Riepilogo" data-testid="warehouse-summary">
            {summaryState.status === "loading" ? (
              <p className="parties-status">Caricamento…</p>
            ) : null}
            {summaryState.status === "error" ? (
              <p>{summaryState.message}</p>
            ) : null}
            {summaryState.status === "ready" && summary ? (
              <div className="quotes-detail-grid">
                <div>
                  <strong>Articoli attivi</strong>
                  <p>{summary.activeArticles}</p>
                </div>
                <div>
                  <strong>Sotto scorta minima</strong>
                  <p data-testid="below-min-count">{summary.belowMinStockCount}</p>
                </div>
                <div>
                  <strong>Movimenti registrati</strong>
                  <p>{summary.movementCount}</p>
                </div>
              </div>
            ) : null}
            <div className="parties-form-actions">
              <Button
                variant="secondary"
                onClick={() => {
                  setMovType("in");
                  setSection("movement");
                }}
              >
                Nuovo carico
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setMovType("out");
                  setSection("movement");
                }}
              >
                Nuovo scarico
              </Button>
              <Button variant="ghost" onClick={() => setSection("stock")}>
                Vedi giacenze
              </Button>
            </div>
          </Panel>

          {summary && summary.belowMinStockCount > 0 ? (
            <Panel title="Allerta scorta" tone="muted" data-testid="low-stock-preview">
              <p>
                Ci sono articoli con giacenza minore o uguale alla soglia minima.
                Apri Giacenze e filtra “Sotto scorta”.
              </p>
            </Panel>
          ) : null}
        </>
      ) : null}

      {section === "catalog" ? (
        <>
          <Panel title="Catalogo articoli" data-testid="articles-list-panel">
            <div className="parties-toolbar">
              <label className="parties-search">
                <span className="sr-only">Cerca articoli</span>
                <input
                  type="search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Cerca per codice, descrizione o categoria"
                  disabled={busy}
                />
              </label>
              <label className="parties-filter">
                <span>Stato</span>
                <select
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value as ArticleListStatusFilter);
                    setPage(1);
                  }}
                  disabled={busy}
                >
                  <option value="active">Attivi</option>
                  <option value="archived">Archiviati</option>
                  <option value="all">Tutti</option>
                </select>
              </label>
              <Button variant="primary" disabled={busy} onClick={openCreate}>
                Nuovo articolo
              </Button>
            </div>

            {listState.status === "loading" ? (
              <p className="parties-status">Caricamento…</p>
            ) : null}
            {listState.status === "error" ? (
              <Panel title="Errore elenco" tone="danger">
                <p>{listState.message}</p>
              </Panel>
            ) : null}
            {listState.status === "ready" && items.length === 0 ? (
              <p className="parties-empty" data-testid="articles-empty">
                Nessun articolo con i filtri attuali.
              </p>
            ) : null}
            {listState.status === "ready" && items.length > 0 ? (
              <div className="parties-table-wrap">
                <table className="parties-table">
                  <thead>
                    <tr>
                      <th>Codice</th>
                      <th>Descrizione</th>
                      <th>Unità</th>
                      <th>Soglia min.</th>
                      <th>Stato</th>
                      <th>Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((article) => (
                      <tr key={article.id}>
                        <td>
                          <button
                            type="button"
                            className="parties-name-link"
                            disabled={busy}
                            onClick={() => {
                              void openEdit(article.id);
                            }}
                          >
                            {article.code}
                          </button>
                        </td>
                        <td>
                          {article.description}
                          {article.category ? (
                            <div className="parties-contacts">{article.category}</div>
                          ) : null}
                        </td>
                        <td>{getArticleUnitLabel(article.unit)}</td>
                        <td>{formatMinStock(article.minStock)}</td>
                        <td>
                          <Badge
                            tone={
                              article.status === "active" ? "success" : "neutral"
                            }
                          >
                            {article.status === "active" ? "attivo" : "archiviato"}
                          </Badge>
                        </td>
                        <td>
                          <div className="parties-row-actions">
                            <Button
                              variant="ghost"
                              disabled={busy}
                              onClick={() => {
                                void openEdit(article.id);
                              }}
                            >
                              Modifica
                            </Button>
                            {article.status === "active" ? (
                              <Button
                                variant="ghost"
                                disabled={busy}
                                onClick={() => setConfirmArchiveId(article.id)}
                              >
                                Archivia
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                disabled={busy}
                                onClick={() => {
                                  void runReactivate(article.id);
                                }}
                              >
                                Riattiva
                              </Button>
                            )}
                          </div>
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
                  variant="ghost"
                  disabled={busy || page <= 1}
                  onClick={() => setPage((c) => Math.max(1, c - 1))}
                >
                  Precedente
                </Button>
                <span>
                  Pagina {page} / {totalPages}
                </span>
                <Button
                  variant="ghost"
                  disabled={busy || page >= totalPages}
                  onClick={() => setPage((c) => Math.min(totalPages, c + 1))}
                >
                  Successiva
                </Button>
              </div>
            </div>
          </Panel>

          {confirmArchiveId ? (
            <Panel title="Conferma archiviazione" tone="muted">
              <p>
                L’articolo resta nello storico movimenti ma non potrà ricevere
                nuovi movimenti finché resta archiviato.
              </p>
              <div className="parties-form-actions">
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => {
                    void runArchive(confirmArchiveId);
                  }}
                >
                  Conferma archiviazione
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setConfirmArchiveId(null)}
                >
                  Annulla
                </Button>
              </div>
            </Panel>
          ) : null}

          {editorMode !== "closed" ? (
            <Panel
              title={
                editorMode === "create" ? "Nuovo articolo" : "Modifica articolo"
              }
              data-testid="articles-editor"
            >
              <div className="parties-form">
                <div className="parties-form-grid">
                  <label>
                    <span>Codice</span>
                    <input
                      value={draft.code}
                      disabled={busy}
                      onChange={(event) =>
                        setDraft((c) => ({ ...c, code: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    <span>Unità di misura</span>
                    <select
                      value={draft.unit}
                      disabled={busy}
                      onChange={(event) =>
                        setDraft((c) => ({
                          ...c,
                          unit: event.target.value as ArticleUnitId,
                        }))
                      }
                    >
                      {ARTICLE_UNITS.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="company-span-2">
                    <span>Descrizione</span>
                    <input
                      value={draft.description}
                      disabled={busy}
                      onChange={(event) =>
                        setDraft((c) => ({
                          ...c,
                          description: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Categoria (facoltativa)</span>
                    <input
                      value={draft.category ?? ""}
                      disabled={busy}
                      onChange={(event) =>
                        setDraft((c) => ({
                          ...c,
                          category: event.target.value || null,
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Soglia minima (facoltativa)</span>
                    <input
                      inputMode="decimal"
                      value={minStockInput}
                      disabled={busy}
                      placeholder="Nessuna"
                      onChange={(event) => setMinStockInput(event.target.value)}
                    />
                  </label>
                  <label className="company-span-2">
                    <span>Note</span>
                    <textarea
                      rows={3}
                      value={draft.notes ?? ""}
                      disabled={busy}
                      onChange={(event) =>
                        setDraft((c) => ({
                          ...c,
                          notes: event.target.value || null,
                        }))
                      }
                    />
                  </label>
                </div>
                <div className="parties-form-actions">
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => {
                      void submitEditor();
                    }}
                  >
                    {saving ? "Salvataggio…" : "Salva"}
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={closeEditor}>
                    Annulla
                  </Button>
                </div>
              </div>
            </Panel>
          ) : null}
        </>
      ) : null}

      {section === "stock" ? (
        <Panel title="Giacenze" data-testid="stock-balances-panel">
          <div className="parties-toolbar">
            <label className="parties-search">
              <span className="sr-only">Cerca giacenze</span>
              <input
                type="search"
                value={balanceSearchInput}
                onChange={(event) => setBalanceSearchInput(event.target.value)}
                placeholder="Cerca per codice o descrizione"
                disabled={busy}
              />
            </label>
            <label className="parties-filter">
              <span>Filtro</span>
              <select
                value={balanceFilter}
                onChange={(event) => {
                  setBalanceFilter(
                    event.target.value as StockBalanceListQuery["filter"],
                  );
                  setBalancePage(1);
                }}
              >
                <option value="active">Tutti gli attivi</option>
                <option value="below_min">Sotto scorta</option>
              </select>
            </label>
          </div>
          {balanceState.status === "loading" ? (
            <p className="parties-status">Caricamento…</p>
          ) : null}
          {balanceState.status === "error" ? <p>{balanceState.message}</p> : null}
          {balanceState.status === "ready" && balances.length === 0 ? (
            <p className="parties-empty">Nessuna giacenza da mostrare.</p>
          ) : null}
          {balances.length > 0 ? (
            <div className="parties-table-wrap">
              <table className="parties-table">
                <thead>
                  <tr>
                    <th>Codice</th>
                    <th>Descrizione</th>
                    <th>Unità</th>
                    <th>Giacenza</th>
                    <th>Soglia min.</th>
                    <th>Stato scorta</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((row) => (
                    <tr key={row.articleId}>
                      <td>{row.code}</td>
                      <td>{row.description}</td>
                      <td>{getArticleUnitLabel(row.unit)}</td>
                      <td>{formatQuantityItalian(row.stockMilli)}</td>
                      <td>{formatMinStock(row.minStock)}</td>
                      <td>
                        {row.belowMinStock ? (
                          <Badge tone="warning">sotto scorta</Badge>
                        ) : (
                          <Badge tone="success">ok</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="parties-pagination">
            <span>
              {balanceTotal === 0
                ? "Nessun risultato"
                : `${(balancePage - 1) * stockPageSize + 1}–${Math.min(balancePage * stockPageSize, balanceTotal)} di ${balanceTotal}`}
            </span>
            <div className="parties-pagination-actions">
              <Button
                variant="ghost"
                disabled={balancePage <= 1}
                onClick={() => setBalancePage((c) => Math.max(1, c - 1))}
              >
                Precedente
              </Button>
              <span>
                Pagina {balancePage} / {balancePages}
              </span>
              <Button
                variant="ghost"
                disabled={balancePage >= balancePages}
                onClick={() =>
                  setBalancePage((c) => Math.min(balancePages, c + 1))
                }
              >
                Successiva
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}

      {section === "movement" ? (
        <Panel title="Registra movimento" data-testid="stock-movement-form">
          <p className="settings-copy">
            Carichi, scarichi e rettifiche. Lo scarico e la rettifica negativa non
            possono portare la giacenza sotto zero. I movimenti registrati non si
            modificano né si cancellano.
          </p>
          <div className="parties-form">
            <div className="parties-form-grid">
              <label className="company-span-2">
                <span>Articolo attivo</span>
                <select
                  value={movArticleId}
                  disabled={movSaving}
                  onChange={(event) => setMovArticleId(event.target.value)}
                >
                  {activeArticles.length === 0 ? (
                    <option value="">Nessun articolo attivo</option>
                  ) : null}
                  {activeArticles.map((article) => (
                    <option key={article.id} value={article.id}>
                      {article.code} — {article.description} (
                      {getArticleUnitLabel(article.unit)})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Tipo</span>
                <select
                  value={movType}
                  disabled={movSaving}
                  onChange={(event) =>
                    setMovType(event.target.value as StockMovementType)
                  }
                >
                  {STOCK_MOVEMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {STOCK_MOVEMENT_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Quantità</span>
                <input
                  value={movQty}
                  disabled={movSaving}
                  placeholder="es. 1 oppure 2,5"
                  onChange={(event) => setMovQty(event.target.value)}
                />
              </label>
              <label>
                <span>Data movimento</span>
                <input
                  type="date"
                  value={movDate}
                  disabled={movSaving}
                  onChange={(event) => setMovDate(event.target.value)}
                />
              </label>
              <label>
                <span>
                  Causale
                  {movType === "adjustment_in" || movType === "adjustment_out"
                    ? " (obbligatoria)"
                    : " (facoltativa)"}
                </span>
                <input
                  value={movReason}
                  disabled={movSaving}
                  onChange={(event) => setMovReason(event.target.value)}
                />
              </label>
              <label className="company-span-2">
                <span>Note (facoltative)</span>
                <textarea
                  rows={3}
                  value={movNotes}
                  disabled={movSaving}
                  onChange={(event) => setMovNotes(event.target.value)}
                />
              </label>
            </div>
            <div className="parties-form-actions">
              <Button
                variant="primary"
                disabled={movSaving || activeArticles.length === 0}
                onClick={() => {
                  void submitMovement();
                }}
              >
                {movSaving ? "Registrazione…" : "Registra movimento"}
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}

      {section === "history" ? (
        <Panel title="Storico movimenti" data-testid="stock-history-panel">
          <div className="parties-toolbar">
            <label className="parties-search">
              <span className="sr-only">Cerca movimenti</span>
              <input
                type="search"
                value={historySearchInput}
                onChange={(event) => setHistorySearchInput(event.target.value)}
                placeholder="Cerca codice, descrizione o causale"
              />
            </label>
            <label className="parties-filter">
              <span>Tipo</span>
              <select
                value={historyType}
                onChange={(event) => {
                  setHistoryType(
                    event.target.value as StockMovementType | "all",
                  );
                  setHistoryPage(1);
                }}
              >
                <option value="all">Tutti</option>
                {STOCK_MOVEMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {STOCK_MOVEMENT_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {historyState.status === "loading" ? (
            <p className="parties-status">Caricamento…</p>
          ) : null}
          {historyState.status === "error" ? <p>{historyState.message}</p> : null}
          {historyState.status === "ready" && history.length === 0 ? (
            <p className="parties-empty">Nessun movimento registrato.</p>
          ) : null}
          {history.length > 0 ? (
            <div className="parties-table-wrap">
              <table className="parties-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Articolo</th>
                    <th>Tipo</th>
                    <th>Quantità</th>
                    <th>Causale</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.id}>
                      <td>{row.movementDate}</td>
                      <td>
                        {row.articleCode}
                        <div className="parties-contacts">
                          {row.articleDescription}
                        </div>
                      </td>
                      <td>{STOCK_MOVEMENT_TYPE_LABELS[row.movementType]}</td>
                      <td>
                        {formatQuantityItalian(row.quantityMilli)}{" "}
                        {getArticleUnitLabel(row.articleUnit)}
                      </td>
                      <td>{row.reason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="parties-pagination">
            <span>
              {historyTotal === 0
                ? "Nessun risultato"
                : `${(historyPage - 1) * stockPageSize + 1}–${Math.min(historyPage * stockPageSize, historyTotal)} di ${historyTotal}`}
            </span>
            <div className="parties-pagination-actions">
              <Button
                variant="ghost"
                disabled={historyPage <= 1}
                onClick={() => setHistoryPage((c) => Math.max(1, c - 1))}
              >
                Precedente
              </Button>
              <span>
                Pagina {historyPage} / {historyPages}
              </span>
              <Button
                variant="ghost"
                disabled={historyPage >= historyPages}
                onClick={() =>
                  setHistoryPage((c) => Math.min(historyPages, c + 1))
                }
              >
                Successiva
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
