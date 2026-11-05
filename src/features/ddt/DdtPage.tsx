import { useCallback, useEffect, useState } from "react";
import {
  ARTICLE_UNITS,
  type ArticleDto,
  type ArticleUnitId,
} from "../../../shared/articles.ts";
import {
  collectDdtRegistrationIssues,
  DDT_DOCUMENT_TYPE_LABELS,
  DDT_STATUS_LABELS,
  DDT_STATUSES,
  buildMissingArticleDrafts,
  ddtLineAssociationLabel,
  summarizeDdtAssociation,
  type DdtDashboardDto,
  type DdtDetailDto,
  type DdtDocumentType,
  type DdtLineDto,
  type DdtMissingArticleDraft,
  type DdtStatus,
} from "../../../shared/ddt.ts";
import {
  createArticle,
  createMissingDdtArticles,
  DesktopClientError,
  exportDdtArchiveCsv,
  exportDdtLinesCsv,
  isDesktopRuntime,
  listArticles,
  listDdtDocuments,
  openDdtOriginal,
  readDdtDashboard,
  readDdtDetail,
  reassociateDdtArticles,
  requestCancelDdt,
  requestImportDdtFiles,
  requestRegisterDdt,
  requestReprocessDdt,
  saveDdtReview,
} from "../../desktop/desktopBridge.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { PageHeader } from "../../ui/PageHeader.tsx";
import { Panel } from "../../ui/Panel.tsx";
import { Separator } from "../../ui/Separator.tsx";

type View = "dashboard" | "archive" | "detail";

export function DdtPage() {
  const desktop = isDesktopRuntime();
  const [view, setView] = useState<View>("dashboard");
  const [dashboard, setDashboard] = useState<DdtDashboardDto | null>(null);
  const [statusFilter, setStatusFilter] = useState<DdtStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [listItems, setListItems] = useState<DdtDetailDto["document"][]>([]);
  const [listTotal, setListTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<DdtDetailDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lineSearch, setLineSearch] = useState<Record<string, string>>({});
  const [lineSuggestions, setLineSuggestions] = useState<
    Record<string, ArticleDto[]>
  >({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [missingDrafts, setMissingDrafts] = useState<
    DdtMissingArticleDraft[] | null
  >(null);
  const [blockersExpanded, setBlockersExpanded] = useState(false);

  const refreshDashboard = useCallback(async () => {
    if (!desktop) {
      return;
    }
    const data = await readDdtDashboard();
    setDashboard(data);
  }, [desktop]);

  const refreshList = useCallback(async () => {
    if (!desktop) {
      return;
    }
    const result = await listDdtDocuments({
      search,
      status: statusFilter,
      documentType: "all",
      dateFrom: null,
      dateTo: null,
      page,
      pageSize: 25,
    });
    setListItems(result.items);
    setListTotal(result.total);
  }, [desktop, search, statusFilter, page]);

  const openDetail = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const data = await readDdtDetail(id);
      setDetail(data);
      setView("detail");
    } catch (err) {
      setError(
        err instanceof DesktopClientError || err instanceof Error
          ? err.message
          : "Impossibile aprire il documento.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!desktop) {
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        await refreshDashboard();
        if (!cancelled) {
          await refreshList();
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Errore caricamento DDT.",
          );
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [desktop, refreshDashboard, refreshList]);

  const handleImport = async () => {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const batch = await requestImportDdtFiles();
      const imported = batch.results.filter((r) => r.status === "imported").length;
      const duplicates = batch.results.filter((r) => r.status === "duplicate").length;
      setFeedback(
        `Importazione: ${imported} nuovi, ${duplicates} duplicati (hash).`,
      );
      await refreshDashboard();
      await refreshList();
      const first = batch.results.find(
        (r) => r.status === "imported" || r.status === "duplicate",
      );
      if (first) {
        await openDetail(first.document.id);
      }
    } catch (err) {
      setError(
        err instanceof DesktopClientError || err instanceof Error
          ? err.message
          : "Importazione non riuscita.",
      );
    } finally {
      setBusy(false);
    }
  };

  const updateDetailLine = (lineId: string, patch: Partial<DdtLineDto>) => {
    setDetail((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        lines: current.lines.map((line) =>
          line.id === lineId ? { ...line, ...patch } : line,
        ),
      };
    });
  };

  const searchArticlesForLine = async (lineId: string, query: string) => {
    setLineSearch((current) => ({ ...current, [lineId]: query }));
    if (!desktop || query.trim().length < 1) {
      setLineSuggestions((current) => ({ ...current, [lineId]: [] }));
      return;
    }
    try {
      const result = await listArticles({
        search: query.trim(),
        status: "active",
        page: 1,
        pageSize: 8,
      });
      setLineSuggestions((current) => ({
        ...current,
        [lineId]: result.items,
      }));
    } catch {
      setLineSuggestions((current) => ({ ...current, [lineId]: [] }));
    }
  };

  const linkArticleToLine = (lineId: string, article: ArticleDto) => {
    updateDetailLine(lineId, {
      articleId: article.id,
      articleCode: article.code,
      articleDescription: article.description,
      articleUnit: article.unit,
      unitNormalized: article.unit,
      validationStatus: "ok",
      warnings: [],
    });
    setLineSuggestions((current) => ({ ...current, [lineId]: [] }));
    setLineSearch((current) => ({ ...current, [lineId]: "" }));
    setFeedback(`Articolo ${article.code} associato.`);
  };

  const createArticleForLine = async (line: DdtLineDto) => {
    if (!line.originalCode) {
      setError("Imposta un codice riga prima di creare l'articolo.");
      return;
    }
    if (!line.unitNormalized) {
      setError("Imposta l'unità di misura prima di creare l'articolo.");
      return;
    }
    if (
      !window.confirm(
        `Creare l'articolo ${line.originalCode} nel magazzino e associarlo a questa riga?`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createArticle({
        code: line.originalCode,
        description:
          line.originalDescription?.trim() ||
          `Articolo DDT ${line.originalCode}`,
        category: null,
        unit: line.unitNormalized,
        minStock: null,
        notes: "Creato da revisione DDT",
      });
      linkArticleToLine(line.id, created);
      setFeedback(`Creato e associato ${created.code}. Salva la revisione.`);
    } catch (err) {
      setError(
        err instanceof DesktopClientError || err instanceof Error
          ? err.message
          : "Creazione articolo non riuscita.",
      );
    } finally {
      setBusy(false);
    }
  };

  const registrationBlockers = detail
    ? collectDdtRegistrationIssues(detail.document, detail.lines).blocking
    : [];
  const associationSummary = detail
    ? summarizeDdtAssociation(detail.lines)
    : null;
  const canRegister =
    detail?.document.status === "ready" && registrationBlockers.length === 0;

  const openMissingArticlesPreview = () => {
    if (!detail) {
      return;
    }
    const drafts = buildMissingArticleDrafts(detail.lines);
    if (drafts.length === 0) {
      setError(
        "Nessun articolo creabile: le righe non associate devono avere codice e unità.",
      );
      return;
    }
    setMissingDrafts(drafts);
    setError(null);
  };

  const handleCreateMissingArticles = async () => {
    if (!detail || !missingDrafts || missingDrafts.length === 0) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await createMissingDdtArticles({
        id: detail.document.id,
        drafts: missingDrafts,
      });
      setDetail(saved);
      setMissingDrafts(null);
      setFeedback(
        `Creati/associati gli articoli mancanti (${summarizeDdtAssociation(saved.lines).linked}/${saved.lines.length} righe associate).`,
      );
      await refreshDashboard();
      await refreshList();
    } catch (err) {
      setError(
        err instanceof DesktopClientError || err instanceof Error
          ? err.message
          : "Creazione massiva non riuscita.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleReassociate = async () => {
    if (!detail) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await reassociateDdtArticles(detail.document.id);
      setDetail(saved);
      const summary = summarizeDdtAssociation(saved.lines);
      setFeedback(
        `Associazioni rieseguite: ${summary.linked} associate, ${summary.missing} mancanti.`,
      );
    } catch (err) {
      setError(
        err instanceof DesktopClientError || err instanceof Error
          ? err.message
          : "Riesecuzione associazioni non riuscita.",
      );
    } finally {
      setBusy(false);
    }
  };

  const updateDetailDoc = (
    patch: Partial<DdtDetailDto["document"]>,
  ) => {
    setDetail((current) =>
      current ? { ...current, document: { ...current.document, ...patch } } : current,
    );
  };

  const handleSaveReview = async () => {
    if (!detail) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await saveDdtReview({
        id: detail.document.id,
        documentType: detail.document.documentType,
        documentNumber: detail.document.documentNumber,
        documentDate: detail.document.documentDate,
        counterpartyName: detail.document.counterpartyName,
        counterpartyPartyId: detail.document.counterpartyPartyId,
        orderReference: detail.document.orderReference,
        notes: detail.document.notes,
        lines: detail.lines.map((line) => ({
          id: line.id,
          originalCode: line.originalCode,
          originalDescription: line.originalDescription,
          articleId: line.articleId,
          quantityRaw: line.quantityRaw,
          unitNormalized: line.unitNormalized,
        })),
      });
      setDetail(saved);
      setFeedback("Revisione salvata.");
      await refreshDashboard();
      await refreshList();
    } catch (err) {
      setError(
        err instanceof DesktopClientError || err instanceof Error
          ? err.message
          : "Salvataggio non riuscito.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async () => {
    if (!detail) {
      return;
    }
    if (
      !window.confirm(
        "Confermi la registrazione dei movimenti di magazzino per questo DDT?",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await requestRegisterDdt(detail.document.id);
      setDetail(saved);
      setFeedback("DDT registrato. Movimenti di magazzino creati.");
      await refreshDashboard();
      await refreshList();
    } catch (err) {
      setError(
        err instanceof DesktopClientError || err instanceof Error
          ? err.message
          : "Registrazione non riuscita.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleReprocess = async () => {
    if (!detail) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await requestReprocessDdt(detail.document.id);
      setDetail(saved);
      setFeedback("Elaborazione rieseguita.");
    } catch (err) {
      setError(
        err instanceof DesktopClientError || err instanceof Error
          ? err.message
          : "Rielaborazione non riuscita.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!detail) {
      return;
    }
    if (!window.confirm("Annullare questo documento non registrato?")) {
      return;
    }
    setBusy(true);
    try {
      await requestCancelDdt(detail.document.id);
      setFeedback("Documento annullato.");
      setView("archive");
      setDetail(null);
      await refreshDashboard();
      await refreshList();
    } catch (err) {
      setError(
        err instanceof DesktopClientError || err instanceof Error
          ? err.message
          : "Annullamento non riuscito.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page-wide page-enter" data-testid="page-ddt">
      <PageHeader
        eyebrow="Magazzino"
        title="DDT"
        description="Importazione, verifica e registrazione documenti di trasporto. L’OCR non registra movimenti automaticamente."
        actions={
          <>
            <Button
              variant={view === "dashboard" ? "primary" : "ghost"}
              onClick={() => setView("dashboard")}
            >
              Dashboard
            </Button>
            <Button
              variant={view === "archive" ? "primary" : "ghost"}
              onClick={() => setView("archive")}
            >
              Archivio
            </Button>
            <Button
              variant="secondary"
              disabled={!desktop || busy}
              data-testid="ddt-import"
              onClick={() => {
                void handleImport();
              }}
            >
              {busy ? "Operazione…" : "Importa file…"}
            </Button>
          </>
        }
      />
      <Separator />

      {!desktop ? (
        <Panel tone="muted">
          <p>Il modulo DDT è disponibile nell’app desktop Electron.</p>
        </Panel>
      ) : null}

      {error ? (
        <Panel title="Errore" tone="danger">
          <p>{error}</p>
        </Panel>
      ) : null}
      {feedback ? (
        <p className="ui-hint" data-testid="ddt-feedback">
          {feedback}
        </p>
      ) : null}

      {desktop && view === "dashboard" && dashboard ? (
        <section className="page-section" data-testid="ddt-dashboard">
          <div className="summary-grid">
            <Panel tone="muted" className="summary-card">
              <p className="summary-label">Importati (nuovi)</p>
              <p className="summary-value">{dashboard.imported}</p>
            </Panel>
            <Panel tone="muted" className="summary-card">
              <p className="summary-label">Da verificare</p>
              <p className="summary-value">{dashboard.reviewRequired}</p>
            </Panel>
            <Panel tone="muted" className="summary-card">
              <p className="summary-label">Pronti</p>
              <p className="summary-value">{dashboard.ready}</p>
            </Panel>
            <Panel tone="muted" className="summary-card">
              <p className="summary-label">Registrati</p>
              <p className="summary-value">{dashboard.registered}</p>
            </Panel>
            <Panel tone="muted" className="summary-card">
              <p className="summary-label">Con errori</p>
              <p className="summary-value">{dashboard.failed}</p>
            </Panel>
          </div>
          <h3 className="page-section-title">Ultime importazioni</h3>
          {dashboard.recent.length === 0 ? (
            <Panel tone="muted">
              <p>Nessun documento importato.</p>
            </Panel>
          ) : (
            <div className="panel-stack">
              {dashboard.recent.map((doc) => (
                <Panel key={doc.id} tone="muted">
                  <div className="module-card-top">
                    <strong>
                      {doc.documentNumber ?? doc.originalFileName}
                    </strong>
                    <Badge tone="neutral">
                      {DDT_STATUS_LABELS[doc.status]}
                    </Badge>
                  </div>
                  <p className="summary-meta">
                    {doc.counterpartyName ?? "Controparte n/d"} ·{" "}
                    {doc.documentDate ?? "data n/d"}
                  </p>
                  <Button variant="ghost" onClick={() => void openDetail(doc.id)}>
                    Apri
                  </Button>
                </Panel>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {desktop && view === "archive" ? (
        <section className="page-section" data-testid="ddt-archive">
          <div className="settings-actions">
            <label>
              Cerca
              <input
                value={search}
                onChange={(event) => {
                  setPage(1);
                  setSearch(event.target.value);
                }}
              />
            </label>
            <label>
              Stato
              <select
                value={statusFilter}
                onChange={(event) => {
                  setPage(1);
                  setStatusFilter(event.target.value as DdtStatus | "all");
                }}
              >
                <option value="all">Tutti</option>
                {DDT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {DDT_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="secondary"
              onClick={() => {
                void refreshList();
              }}
            >
              Aggiorna
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const result = await exportDdtArchiveCsv({
                      search,
                      status: statusFilter,
                      documentType: "all",
                      dateFrom: null,
                      dateTo: null,
                      page: 1,
                      pageSize: 25,
                    });
                    if (result.status === "empty") {
                      setFeedback("Nessun documento da esportare.");
                    } else if (result.status === "completed") {
                      setFeedback(
                        `Esportati ${result.rowCount} documenti in ${result.fileName}.`,
                      );
                    }
                  } catch (err) {
                    setError(
                      err instanceof DesktopClientError || err instanceof Error
                        ? err.message
                        : "Esportazione CSV non riuscita.",
                    );
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              Esporta CSV archivio
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const result = await exportDdtLinesCsv({
                      search,
                      status: statusFilter,
                      documentType: "all",
                      dateFrom: null,
                      dateTo: null,
                      page: 1,
                      pageSize: 25,
                    });
                    if (result.status === "empty") {
                      setFeedback("Nessuna riga da esportare.");
                    } else if (result.status === "completed") {
                      setFeedback(
                        `Esportate ${result.rowCount} righe in ${result.fileName}.`,
                      );
                    }
                  } catch (err) {
                    setError(
                      err instanceof DesktopClientError || err instanceof Error
                        ? err.message
                        : "Esportazione CSV non riuscita.",
                    );
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              Esporta CSV righe
            </Button>
          </div>
          {listItems.length === 0 ? (
            <Panel tone="muted">
              <p>Nessun documento in archivio per i filtri selezionati.</p>
            </Panel>
          ) : (
            <div className="panel-stack">
              {listItems.map((doc) => (
                <Panel key={doc.id} tone="muted">
                  <div className="module-card-top">
                    <strong>
                      {doc.documentNumber ?? doc.originalFileName}
                    </strong>
                    <Badge tone="neutral">
                      {DDT_STATUS_LABELS[doc.status]}
                    </Badge>
                  </div>
                  <p className="summary-meta">
                    {DDT_DOCUMENT_TYPE_LABELS[doc.documentType]} ·{" "}
                    {doc.counterpartyName ?? "—"} · {doc.documentDate ?? "—"}
                  </p>
                  <Button variant="ghost" onClick={() => void openDetail(doc.id)}>
                    Dettaglio
                  </Button>
                </Panel>
              ))}
            </div>
          )}
          <p className="ui-hint">
            Totale {listTotal} · pagina {page}
          </p>
          <div className="settings-actions">
            <Button
              variant="ghost"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Precedente
            </Button>
            <Button
              variant="ghost"
              disabled={page * 25 >= listTotal}
              onClick={() => setPage((p) => p + 1)}
            >
              Successiva
            </Button>
          </div>
        </section>
      ) : null}

      {desktop && view === "detail" && detail ? (
        <section className="page-section" data-testid="ddt-detail">
          <div className="module-card-top">
            <h3 className="page-section-title">
              {detail.document.documentNumber ?? detail.document.originalFileName}
            </h3>
            <Badge tone="neutral">
              {DDT_STATUS_LABELS[detail.document.status]}
            </Badge>
          </div>
          <p className="ui-hint">
            File: {detail.document.originalFileName} · SHA-256{" "}
            {detail.document.contentSha256.slice(0, 12)}… · OCR{" "}
            {detail.document.ocrStatus}
          </p>
          <div className="settings-actions">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const result = await openDdtOriginal(detail.document.id);
                    if (result.status === "missing" || result.status === "error") {
                      setError(result.message);
                    } else {
                      setFeedback("Documento originale aperto.");
                    }
                  } catch (err) {
                    setError(
                      err instanceof DesktopClientError || err instanceof Error
                        ? err.message
                        : "Apertura file non riuscita.",
                    );
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              Apri originale
            </Button>
          </div>
          {detail.document.lastError ? (
            <Panel tone="danger" title="Ultimo messaggio elaborazione">
              <p>{detail.document.lastError}</p>
              {detail.document.status !== "registered" ? (
                <div className="settings-actions">
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      void handleReprocess();
                    }}
                  >
                    Riesegui estrazione
                  </Button>
                </div>
              ) : null}
            </Panel>
          ) : null}

          <Panel title="Dati documento" tone="muted">
            <div className="company-form-grid">
              <label>
                Tipo
                <select
                  value={detail.document.documentType}
                  disabled={busy || detail.document.status === "registered"}
                  onChange={(event) =>
                    updateDetailDoc({
                      documentType: event.target.value as DdtDocumentType,
                    })
                  }
                >
                  <option value="inbound">
                    {DDT_DOCUMENT_TYPE_LABELS.inbound}
                  </option>
                  <option value="outbound">
                    {DDT_DOCUMENT_TYPE_LABELS.outbound}
                  </option>
                </select>
              </label>
              <label>
                Numero
                <input
                  value={detail.document.documentNumber ?? ""}
                  disabled={busy || detail.document.status === "registered"}
                  onChange={(event) =>
                    updateDetailDoc({
                      documentNumber: event.target.value || null,
                    })
                  }
                />
              </label>
              <label>
                Data
                <input
                  type="date"
                  value={detail.document.documentDate ?? ""}
                  disabled={busy || detail.document.status === "registered"}
                  onChange={(event) =>
                    updateDetailDoc({
                      documentDate: event.target.value || null,
                    })
                  }
                />
              </label>
              <label>
                Controparte
                <input
                  value={detail.document.counterpartyName ?? ""}
                  disabled={busy || detail.document.status === "registered"}
                  onChange={(event) =>
                    updateDetailDoc({
                      counterpartyName: event.target.value || null,
                    })
                  }
                />
              </label>
              <label className="company-span-2">
                Riferimento ordine
                <input
                  value={detail.document.orderReference ?? ""}
                  disabled={busy || detail.document.status === "registered"}
                  onChange={(event) =>
                    updateDetailDoc({
                      orderReference: event.target.value || null,
                    })
                  }
                />
              </label>
            </div>
          </Panel>

          {associationSummary ? (
            <Panel title="Riepilogo associazioni" tone="muted">
              <p>
                Righe totali: {associationSummary.totalLines} · Associate:{" "}
                {associationSummary.linked} · Mancanti:{" "}
                {associationSummary.missing} · Conflitti unità:{" "}
                {associationSummary.conflicts} · Dati non validi:{" "}
                {associationSummary.invalid}
              </p>
              {detail.document.status !== "registered" ? (
                <div className="settings-actions">
                  <Button
                    variant="secondary"
                    disabled={busy || associationSummary.missing === 0}
                    onClick={openMissingArticlesPreview}
                  >
                    Crea gli articoli mancanti
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      void handleReassociate();
                    }}
                  >
                    Riesegui associazioni
                  </Button>
                </div>
              ) : null}
            </Panel>
          ) : null}

          {missingDrafts ? (
            <Panel title="Verifica articoli da creare" tone="muted">
              <p className="ui-hint">
                Controlla codice, descrizione e unità prima della creazione.
                Nessun movimento di magazzino verrà generato.
              </p>
              {missingDrafts.map((draft, index) => (
                <div key={draft.lineId} className="quotes-item-row">
                  <label>
                    Codice
                    <input
                      value={draft.code}
                      disabled={busy}
                      onChange={(event) => {
                        const value = event.target.value;
                        setMissingDrafts((current) =>
                          current
                            ? current.map((item, i) =>
                                i === index ? { ...item, code: value } : item,
                              )
                            : current,
                        );
                      }}
                    />
                  </label>
                  <label className="company-span-2">
                    Descrizione
                    <input
                      value={draft.description}
                      disabled={busy}
                      onChange={(event) => {
                        const value = event.target.value;
                        setMissingDrafts((current) =>
                          current
                            ? current.map((item, i) =>
                                i === index
                                  ? { ...item, description: value }
                                  : item,
                              )
                            : current,
                        );
                      }}
                    />
                  </label>
                  <label>
                    U.M.
                    <select
                      value={draft.unit}
                      disabled={busy}
                      onChange={(event) => {
                        const value = event.target.value as ArticleUnitId;
                        setMissingDrafts((current) =>
                          current
                            ? current.map((item, i) =>
                                i === index ? { ...item, unit: value } : item,
                              )
                            : current,
                        );
                      }}
                    >
                      {ARTICLE_UNITS.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ))}
              <div className="settings-actions">
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => {
                    void handleCreateMissingArticles();
                  }}
                >
                  Conferma creazione ({missingDrafts.length})
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setMissingDrafts(null)}
                >
                  Annulla
                </Button>
              </div>
            </Panel>
          ) : null}

          <Panel title="Righe" tone="muted">
            {detail.lines.length === 0 ? (
              <p className="ui-hint">
                Nessuna riga estratta. Compila manualmente dopo un nuovo OCR o
                crea le associazioni in revisione successiva.
              </p>
            ) : (
              detail.lines.map((line) => (
                <div key={line.id} className="quotes-item-row">
                  <label>
                    Codice originale
                    <input
                      value={line.originalCode ?? ""}
                      disabled={busy || detail.document.status === "registered"}
                      onChange={(event) =>
                        updateDetailLine(line.id, {
                          originalCode: event.target.value || null,
                        })
                      }
                    />
                  </label>
                  <label>
                    Descrizione originale
                    <input
                      value={line.originalDescription ?? ""}
                      disabled={busy || detail.document.status === "registered"}
                      onChange={(event) =>
                        updateDetailLine(line.id, {
                          originalDescription: event.target.value || null,
                        })
                      }
                    />
                  </label>
                  <label>
                    Q.tà
                    <input
                      value={line.quantityRaw ?? ""}
                      disabled={busy || detail.document.status === "registered"}
                      onChange={(event) =>
                        updateDetailLine(line.id, {
                          quantityRaw: event.target.value || null,
                        })
                      }
                    />
                  </label>
                  <label>
                    U.M.
                    <select
                      value={line.unitNormalized ?? ""}
                      disabled={busy || detail.document.status === "registered"}
                      onChange={(event) =>
                        updateDetailLine(line.id, {
                          unitNormalized: (event.target.value ||
                            null) as ArticleUnitId | null,
                        })
                      }
                    >
                      <option value="">—</option>
                      {ARTICLE_UNITS.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="ui-hint">
                    Catalogo:{" "}
                    {line.articleCode
                      ? `${line.articleCode} — ${line.articleDescription}${line.articleUnit ? ` (${line.articleUnit})` : ""}`
                      : "—"}
                    {" · "}
                    Stato: {ddtLineAssociationLabel(line)}
                    {" · "}
                    {line.validationStatus}
                    {line.stockMovementId
                      ? ` · movimento ${line.stockMovementId.slice(0, 8)}`
                      : ""}
                  </p>
                  {line.warnings.length > 0 ? (
                    <p className="ui-hint">{line.warnings.join(" · ")}</p>
                  ) : null}
                  {detail.document.status !== "registered" &&
                  !line.articleId ? (
                    <div className="company-form-grid">
                      <label className="company-span-2">
                        Cerca articolo / suggerimenti
                        <input
                          value={
                            lineSearch[line.id] ??
                            line.originalCode ??
                            line.originalDescription ??
                            ""
                          }
                          disabled={busy}
                          placeholder="Codice o descrizione"
                          onChange={(event) => {
                            void searchArticlesForLine(
                              line.id,
                              event.target.value,
                            );
                          }}
                        />
                      </label>
                      <div className="settings-actions">
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            void searchArticlesForLine(
                              line.id,
                              lineSearch[line.id] ||
                                line.originalCode ||
                                line.originalDescription ||
                                "",
                            );
                          }}
                        >
                          Cerca
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={busy || !line.originalCode}
                          onClick={() => {
                            void createArticleForLine(line);
                          }}
                        >
                          Crea articolo da riga
                        </Button>
                      </div>
                      {(lineSuggestions[line.id] ?? []).length > 0 ? (
                        <div className="panel-stack company-span-2">
                          <p className="ui-hint">
                            Suggerimenti (solo proposta — conferma esplicita):
                          </p>
                          {(lineSuggestions[line.id] ?? []).map((article) => (
                            <Button
                              key={article.id}
                              variant="ghost"
                              disabled={busy}
                              onClick={() => linkArticleToLine(line.id, article)}
                            >
                              {article.code} — {article.description} (
                              {article.unit})
                            </Button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </Panel>

          {registrationBlockers.length > 0 ? (
            <Panel tone="danger" title="Bloccanti prima della registrazione">
              <ul>
                {registrationBlockers.slice(0, blockersExpanded ? undefined : 3).map(
                  (issue) => (
                    <li key={`${issue.code}-${issue.message}`}>
                      {issue.message}
                    </li>
                  ),
                )}
              </ul>
              {registrationBlockers.length > 3 ? (
                <Button
                  variant="ghost"
                  onClick={() => setBlockersExpanded((value) => !value)}
                >
                  {blockersExpanded
                    ? "Comprimi dettagli"
                    : `Mostra tutti (${registrationBlockers.length})`}
                </Button>
              ) : null}
              <p className="ui-hint">
                Usa «Crea gli articoli mancanti» o «Riesegui associazioni», poi
                salva e registra solo dopo conferma.
              </p>
            </Panel>
          ) : null}

          <Panel title="Elaborazioni" tone="muted">
            {detail.processings.length === 0 ? (
              <p className="ui-hint">Nessuna elaborazione registrata.</p>
            ) : (
              detail.processings.map((proc) => (
                <p key={proc.id} className="ui-hint">
                  Tentativo {proc.attempt}: {proc.strategy} → {proc.outcome}
                  {proc.message ? ` — ${proc.message}` : ""}
                </p>
              ))
            )}
          </Panel>

          <div className="settings-actions">
            <Button variant="ghost" onClick={() => setView("archive")}>
              Torna all’archivio
            </Button>
            {detail.document.status !== "registered" ? (
              <>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    void handleSaveReview();
                  }}
                >
                  Salva revisione
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    void handleReprocess();
                  }}
                >
                  Riesegui estrazione
                </Button>
                <Button
                  variant="primary"
                  disabled={busy || !canRegister}
                  data-testid="ddt-register"
                  onClick={() => {
                    void handleRegister();
                  }}
                >
                  Registra in magazzino
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    void handleCancel();
                  }}
                >
                  Annulla documento
                </Button>
              </>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
