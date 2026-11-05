import { randomUUID } from "node:crypto";
import { BrowserWindow, dialog } from "electron";
import { AppError } from "../errors/app-error.ts";
import { getDatabase, withAppTransaction } from "../db/connection.ts";
import { findArticleById } from "../repositories/articles-repository.ts";
import {
  deleteLinesForDocument,
  findDdtByDocumentKey,
  findDdtById,
  findDdtBySha256,
  getDdtDashboard,
  getDdtDetail,
  insertDdtDocument,
  insertDdtLine,
  insertDdtProcessing,
  listDdtDocuments,
  listDdtLines,
  nextProcessingAttempt,
  transitionDdtStatus,
  updateDdtDocumentFields,
  updateDdtLine,
} from "../repositories/ddt-repository.ts";
import { normalizeArticleCode } from "../../shared/articles.ts";
import {
  createMissingDdtArticlesOnDatabase,
  evaluateLineAssociation,
  findActiveArticleByNormalizedCode,
  reassociateDdtArticlesOnDatabase,
} from "./ddt-association.ts";
import { registerDdtOnDatabase } from "./ddt-registration.ts";
import {
  buildDdtDocumentKey,
  canTransitionDdtStatus,
  collectDdtRegistrationIssues,
  parseDdtCreateMissingArticlesInput,
  parseDdtDocumentUpdateInput,
  parseDdtId,
  parseDdtListQuery,
  parseDdtQuantityRaw,
  type DdtDashboardDto,
  type DdtDetailDto,
  type DdtDocumentDto,
  type DdtImportBatchResult,
  type DdtImportResult,
  type DdtListResult,
  type DdtStatus,
} from "../../shared/ddt.ts";
import { extractDdtContent } from "./ddt-extract.ts";
import {
  newDdtId,
  readAndValidateDdtFile,
  resolveDdtAbsolutePath,
  storeDdtOriginal,
} from "./ddt-file-store.ts";

function wrap(fallback: string, error: unknown): never {
  if (error instanceof AppError) {
    throw error;
  }
  throw AppError.internal(fallback, error);
}

function applyExtractionToDocument(
  db: Parameters<typeof updateDdtDocumentFields>[0],
  documentId: string,
  extraction: Awaited<ReturnType<typeof extractDdtContent>>,
): DdtDocumentDto {
  // Preserve manual corrections / article links across reprocessing.
  const previousLines = listDdtLines(db, documentId);
  const previousByCode = new Map(
    previousLines
      .filter((line) => line.originalCode)
      .map((line) => [normalizeArticleCode(line.originalCode!), line]),
  );
  const manualOnly = previousLines.filter(
    (line) =>
      line.source === "manual" &&
      (!line.originalCode ||
        !extraction.parsed.lines.some(
          (parsed) =>
            parsed.originalCode &&
            normalizeArticleCode(parsed.originalCode) ===
              normalizeArticleCode(line.originalCode!),
        )),
  );

  deleteLinesForDocument(db, documentId);
  let lineNo = 0;
  for (const line of extraction.parsed.lines) {
    lineNo += 1;
    const prev =
      line.originalCode != null
        ? previousByCode.get(normalizeArticleCode(line.originalCode))
        : undefined;
    let quantityRaw = line.quantityRaw;
    let quantityMilli = line.quantityMilli;
    let unitNormalized = line.unitNormalized;
    let unitRaw = line.unitRaw;
    let originalDescription = line.originalDescription;
    let source = line.source;
    let preferredArticleId =
      findActiveArticleByNormalizedCode(db, line.originalCode)?.id ?? null;
    if (prev?.source === "manual") {
      // Manual edits win over a fresh automatic extraction.
      preferredArticleId = prev.articleId ?? preferredArticleId;
      quantityRaw = prev.quantityRaw ?? quantityRaw;
      quantityMilli = prev.quantityMilli ?? quantityMilli;
      unitNormalized = prev.unitNormalized ?? unitNormalized;
      unitRaw = prev.unitRaw ?? unitRaw;
      originalDescription = prev.originalDescription ?? originalDescription;
      source = "manual";
    } else if (prev?.articleId && !preferredArticleId) {
      preferredArticleId = prev.articleId;
    }
    const evaluated = evaluateLineAssociation(db, {
      originalCode: line.originalCode,
      unitNormalized,
      quantityRaw,
      quantityMilli,
      warnings: [...line.warnings],
      validationStatus: line.validationStatus,
      articleId: preferredArticleId,
    });
    insertDdtLine(db, {
      id: randomUUID(),
      documentId,
      lineNumber: lineNo,
      originalCode: line.originalCode,
      originalDescription,
      articleId: evaluated.articleId,
      quantityRaw,
      quantityMilli: evaluated.quantityMilli,
      unitRaw,
      unitNormalized,
      source,
      confidence: line.confidence,
      warnings: evaluated.warnings,
      validationStatus: evaluated.validationStatus,
      pageNumber: line.pageNumber,
    });
  }

  for (const manual of manualOnly) {
    lineNo += 1;
    insertDdtLine(db, {
      id: randomUUID(),
      documentId,
      lineNumber: lineNo,
      originalCode: manual.originalCode,
      originalDescription: manual.originalDescription,
      articleId: manual.articleId,
      quantityRaw: manual.quantityRaw,
      quantityMilli: manual.quantityMilli,
      unitRaw: manual.unitRaw,
      unitNormalized: manual.unitNormalized,
      source: "manual",
      confidence: null,
      warnings: [...manual.warnings, "Riga manuale conservata dopo riestrazione."],
      validationStatus: manual.validationStatus,
      pageNumber: manual.pageNumber,
    });
  }

  const documentKey = buildDdtDocumentKey({
    documentType: findDdtById(db, documentId)?.documentType ?? "inbound",
    documentNumber: extraction.parsed.documentNumber,
    documentDate: extraction.parsed.documentDate,
    counterpartyName: extraction.parsed.counterpartyName,
  });

  const persisted = listDdtLines(db, documentId);
  const hasLines = persisted.length > 0;
  const draftDocument = {
    ...(findDdtById(db, documentId) as NonNullable<
      ReturnType<typeof findDdtById>
    >),
    documentNumber: extraction.parsed.documentNumber,
    documentDate: extraction.parsed.documentDate,
    counterpartyName: extraction.parsed.counterpartyName,
    orderReference: extraction.parsed.orderReference,
    documentKey,
  };
  const issues = collectDdtRegistrationIssues(draftDocument, persisted);
  // Soft warnings (es. separatore migliaia) non bloccano lo stato ready:
  // i blocking di collectDdtRegistrationIssues restano la fonte di verità.
  const needsReview =
    issues.blocking.length > 0 ||
    extraction.parsed.warnings.length > 0 ||
    persisted.some(
      (line) =>
        line.validationStatus === "error" ||
        line.validationStatus === "unchecked",
    );

  const nextStatus: DdtStatus = needsReview ? "review_required" : "ready";
  const reviewMessage = !hasLines
    ? extraction.parsed.warnings.join(" ") ||
      "Nessuna riga articolo riconosciuta: compilazione manuale richiesta."
    : issues.blocking.length > 0
      ? issues.blocking.map((item) => item.message).join(" ")
      : extraction.message;

  return updateDdtDocumentFields(db, documentId, {
    documentNumber: extraction.parsed.documentNumber,
    documentDate: extraction.parsed.documentDate,
    counterpartyName: extraction.parsed.counterpartyName,
    orderReference: extraction.parsed.orderReference,
    documentKey,
    pageCount: extraction.pageCount,
    status: nextStatus,
    ocrStatus: extraction.ocrUsed
      ? "ocr"
      : extraction.strategy === "native_text"
        ? "native_text"
        : "failed",
    processedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
    lastError: reviewMessage,
  });
}

async function processDocumentExtraction(documentId: string): Promise<void> {
  const db = getDatabase();
  const doc = findDdtById(db, documentId);
  if (!doc) {
    return;
  }
  if (doc.status === "registered") {
    return;
  }
  if (!canTransitionDdtStatus(doc.status, "processing") && doc.status !== "processing") {
    if (!canTransitionDdtStatus(doc.status, "review_required")) {
      return;
    }
  }
  transitionDdtStatus(db, documentId, doc.status, "processing");

  const absolutePath = resolveDdtAbsolutePath(doc.originalRelativePath);
  const attempt = nextProcessingAttempt(db, documentId);
  const startedAt = new Date().toISOString().slice(0, 19).replace("T", " ");

  try {
    const extraction = await extractDdtContent({
      absolutePath,
      mimeType: doc.mimeType,
    });
    withAppTransaction((tx) => {
      applyExtractionToDocument(tx, documentId, extraction);
      const partial =
        extraction.parsed.lines.length === 0 || Boolean(extraction.message);
      insertDdtProcessing(tx, {
        id: randomUUID(),
        documentId,
        attempt,
        strategy: extraction.strategy,
        outcome: partial ? "partial" : "success",
        parserVersion: extraction.parsed.parserVersion,
        message:
          extraction.message ??
          (partial ? extraction.parsed.warnings.join(" ") || null : null),
        startedAt,
        finishedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
      });
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Elaborazione fallita.";
    withAppTransaction((tx) => {
      updateDdtDocumentFields(tx, documentId, {
        status: "failed",
        ocrStatus: "failed",
        lastError: message,
      });
      insertDdtProcessing(tx, {
        id: randomUUID(),
        documentId,
        attempt,
        strategy: "native_text",
        outcome: "failed",
        parserVersion: "n/a",
        message,
        startedAt,
        finishedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
      });
    });
  }
}

export function getDdtDashboardForApp(): DdtDashboardDto {
  try {
    return getDdtDashboard(getDatabase());
  } catch (error) {
    wrap("Impossibile leggere la dashboard DDT.", error);
  }
}

export function listDdtDocumentsForApp(input: unknown): DdtListResult {
  let query;
  try {
    query = parseDdtListQuery(input);
  } catch (error) {
    throw AppError.validation(
      error instanceof Error ? error.message : "Query non valida.",
      error,
    );
  }
  try {
    return listDdtDocuments(getDatabase(), query);
  } catch (error) {
    wrap("Impossibile elencare i DDT.", error);
  }
}

export function getDdtDetailForApp(input: unknown): DdtDetailDto {
  let id: string;
  try {
    id = parseDdtId(input);
  } catch (error) {
    throw AppError.validation(
      error instanceof Error ? error.message : "ID non valido.",
      error,
    );
  }
  try {
    const detail = getDdtDetail(getDatabase(), id);
    if (!detail) {
      throw AppError.notFound("Documento DDT non trovato.");
    }
    return detail;
  } catch (error) {
    wrap("Impossibile leggere il dettaglio DDT.", error);
  }
}

export async function importDdtFilesForApp(): Promise<DdtImportBatchResult> {
  const parent =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const openOptions = {
    title: "Importa DDT",
    properties: ["openFile", "multiSelections"] as Array<
      "openFile" | "multiSelections"
    >,
    filters: [
      { name: "Documenti", extensions: ["pdf", "jpg", "jpeg", "png", "webp"] },
    ],
  };
  const result = parent
    ? await dialog.showOpenDialog(parent, openOptions)
    : await dialog.showOpenDialog(openOptions);
  if (result.canceled || result.filePaths.length === 0) {
    return { results: [{ status: "cancelled" }] };
  }
  if (result.filePaths.length > 20) {
    throw AppError.validation("Massimo 20 file per importazione.");
  }

  const results: DdtImportResult[] = [];
  for (const filePath of result.filePaths) {
    try {
      const detected = readAndValidateDdtFile(filePath);
      const existing = findDdtBySha256(getDatabase(), detected.sha256);
      if (existing) {
        // Re-run extraction for failed/pending duplicates so a fixed worker
        // recovers without requiring a manual second step.
        if (
          existing.status === "failed" ||
          existing.ocrStatus === "failed" ||
          existing.ocrStatus === "pending"
        ) {
          try {
            await processDocumentExtraction(existing.id);
          } catch {
            // Keep duplicate result; lastError remains on the document.
          }
        }
        const refreshed =
          findDdtById(getDatabase(), existing.id) ?? existing;
        results.push({
          status: "duplicate",
          document: refreshed,
          duplicateOfId: existing.id,
        });
        continue;
      }

      const documentId = newDdtId();
      const stored = storeDdtOriginal({ documentId, detected });
      const document = withAppTransaction((db) =>
        insertDdtDocument(db, {
          id: documentId,
          documentType: "inbound",
          originalRelativePath: stored.relativePath,
          originalFileName: detected.originalFileName,
          mimeType: detected.mimeType,
          contentSha256: detected.sha256,
          byteSize: detected.byteSize,
          pageCount: null,
          status: "imported",
          ocrStatus: "pending",
        }),
      );
      results.push({ status: "imported", document });
      // Fire-and-await sequentially to limit memory.
      await processDocumentExtraction(documentId);
      const refreshed = findDdtById(getDatabase(), documentId);
      if (refreshed) {
        results[results.length - 1] = {
          status: "imported",
          document: refreshed,
        };
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw AppError.internal(
        error instanceof Error
          ? error.message
          : "Importazione DDT non riuscita.",
        error,
      );
    }
  }
  return { results };
}

export async function reprocessDdtForApp(input: unknown): Promise<DdtDetailDto> {
  const id = parseDdtId(input);
  const doc = findDdtById(getDatabase(), id);
  if (!doc) {
    throw AppError.notFound("Documento DDT non trovato.");
  }
  if (doc.status === "registered") {
    throw AppError.conflict(
      "Non è possibile rieseguire l’OCR su un documento già registrato.",
    );
  }
  await processDocumentExtraction(id);
  const detail = getDdtDetail(getDatabase(), id);
  if (!detail) {
    throw AppError.notFound("Documento DDT non trovato.");
  }
  return detail;
}

export function saveDdtReviewForApp(input: unknown): DdtDetailDto {
  let payload;
  try {
    payload = parseDdtDocumentUpdateInput(input);
  } catch (error) {
    throw AppError.validation(
      error instanceof Error ? error.message : "Dati revisione non validi.",
      error,
    );
  }

  try {
    return withAppTransaction((db) => {
      const current = findDdtById(db, payload.id);
      if (!current) {
        throw AppError.notFound("Documento DDT non trovato.");
      }
      if (current.status === "registered") {
        throw AppError.conflict("Documento già registrato: non modificabile.");
      }
      if (current.status === "cancelled") {
        throw AppError.conflict("Documento annullato.");
      }

      const documentKey = buildDdtDocumentKey({
        documentType: payload.documentType,
        documentNumber: payload.documentNumber,
        documentDate: payload.documentDate,
        counterpartyName: payload.counterpartyName,
      });
      if (documentKey) {
        const clash = findDdtByDocumentKey(db, documentKey, payload.id);
        if (clash && clash.status === "registered") {
          throw AppError.conflict(
            "Esiste già un DDT registrato con stesso tipo/numero/data/controparte.",
          );
        }
      }

      for (const line of payload.lines) {
        let articleId = line.articleId;
        if (articleId) {
          const article = findArticleById(db, articleId);
          if (!article) {
            throw AppError.validation(`Articolo non trovato (riga ${line.id}).`);
          }
        } else if (line.originalCode) {
          articleId =
            findActiveArticleByNormalizedCode(db, line.originalCode)?.id ?? null;
        }
        const evaluated = evaluateLineAssociation(db, {
          originalCode: line.originalCode,
          unitNormalized: line.unitNormalized,
          quantityRaw: line.quantityRaw,
          quantityMilli: parseDdtQuantityRaw(
            line.quantityRaw,
            line.unitNormalized,
          ),
          warnings: [],
          validationStatus: "unchecked",
          articleId,
        });
        if (!line.unitNormalized && evaluated.articleId) {
          evaluated.warnings.push("Unità mancante.");
          evaluated.validationStatus = "error";
        }

        updateDdtLine(db, {
          id: line.id,
          originalCode: line.originalCode,
          originalDescription: line.originalDescription,
          articleId: evaluated.articleId,
          quantityRaw: line.quantityRaw,
          quantityMilli: evaluated.quantityMilli,
          unitNormalized: line.unitNormalized,
          source: "manual",
          warnings: evaluated.warnings,
          validationStatus: evaluated.validationStatus,
        });
      }

      const lines = listDdtLines(db, payload.id);
      const issues = collectDdtRegistrationIssues(
        {
          ...current,
          documentType: payload.documentType,
          documentNumber: payload.documentNumber,
          documentDate: payload.documentDate,
          counterpartyName: payload.counterpartyName,
        },
        lines,
      );
      const nextStatus: DdtStatus =
        issues.blocking.length === 0 ? "ready" : "review_required";

      updateDdtDocumentFields(db, payload.id, {
        documentType: payload.documentType,
        documentNumber: payload.documentNumber,
        documentDate: payload.documentDate,
        counterpartyName: payload.counterpartyName,
        counterpartyPartyId: payload.counterpartyPartyId,
        orderReference: payload.orderReference,
        notes: payload.notes,
        documentKey,
        status: nextStatus,
        ocrStatus: current.ocrStatus === "pending" ? "manual" : current.ocrStatus,
        lastError: null,
      });

      const detail = getDdtDetail(db, payload.id);
      if (!detail) {
        throw AppError.internal("Salvataggio revisione fallito.");
      }
      return detail;
    });
  } catch (error) {
    wrap("Impossibile salvare la revisione DDT.", error);
  }
}

export function createMissingDdtArticlesForApp(input: unknown): DdtDetailDto {
  let payload;
  try {
    payload = parseDdtCreateMissingArticlesInput(input);
  } catch (error) {
    throw AppError.validation(
      error instanceof Error ? error.message : "Dati creazione non validi.",
      error,
    );
  }
  try {
    return withAppTransaction((db) =>
      createMissingDdtArticlesOnDatabase(db, payload.id, payload.drafts),
    );
  } catch (error) {
    wrap("Impossibile creare gli articoli mancanti dal DDT.", error);
  }
}

export function reassociateDdtArticlesForApp(input: unknown): DdtDetailDto {
  let id: string;
  try {
    id = parseDdtId(input);
  } catch (error) {
    throw AppError.validation(
      error instanceof Error ? error.message : "ID non valido.",
      error,
    );
  }
  try {
    return withAppTransaction((db) => reassociateDdtArticlesOnDatabase(db, id));
  } catch (error) {
    wrap("Impossibile rieseguire le associazioni DDT.", error);
  }
}

export function registerDdtForApp(input: unknown): DdtDetailDto {
  let id: string;
  try {
    id = parseDdtId(input);
  } catch (error) {
    throw AppError.validation(
      error instanceof Error ? error.message : "ID non valido.",
      error,
    );
  }

  try {
    return withAppTransaction((db) => registerDdtOnDatabase(db, id));
  } catch (error) {
    wrap("Impossibile registrare il DDT.", error);
  }
}

export function cancelDdtForApp(input: unknown): DdtDocumentDto {
  const id = parseDdtId(input);
  try {
    return withAppTransaction((db) => {
      const doc = findDdtById(db, id);
      if (!doc) {
        throw AppError.notFound("Documento DDT non trovato.");
      }
      if (doc.status === "registered") {
        throw AppError.conflict(
          "Un DDT registrato non può essere annullato (servirebbe uno storno esplicito).",
        );
      }
      if (!canTransitionDdtStatus(doc.status, "cancelled")) {
        throw AppError.conflict("Annullamento non consentito nello stato attuale.");
      }
      const ok = transitionDdtStatus(db, id, doc.status, "cancelled");
      if (!ok) {
        throw AppError.conflict("Annullamento non applicato.");
      }
      const updated = findDdtById(db, id);
      if (!updated) {
        throw AppError.internal("Annullamento fallito.");
      }
      return updated;
    });
  } catch (error) {
    wrap("Impossibile annullare il DDT.", error);
  }
}

/** Test helper: import from absolute path without dialog. */
export async function importDdtFromPathForTests(
  absolutePath: string,
): Promise<DdtDocumentDto> {
  const detected = readAndValidateDdtFile(absolutePath);
  const existing = findDdtBySha256(getDatabase(), detected.sha256);
  if (existing) {
    return existing;
  }
  const documentId = newDdtId();
  const stored = storeDdtOriginal({ documentId, detected });
  withAppTransaction((db) =>
    insertDdtDocument(db, {
      id: documentId,
      documentType: "inbound",
      originalRelativePath: stored.relativePath,
      originalFileName: detected.originalFileName,
      mimeType: detected.mimeType,
      contentSha256: detected.sha256,
      byteSize: detected.byteSize,
      pageCount: null,
      status: "imported",
      ocrStatus: "pending",
    }),
  );
  await processDocumentExtraction(documentId);
  const doc = findDdtById(getDatabase(), documentId);
  if (!doc) {
    throw new Error("import test failed");
  }
  return doc;
}
