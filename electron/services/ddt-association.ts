/**
 * Associazione articoli DDT: match esatto per codice normalizzato,
 * creazione massiva esplicita delle anagrafiche mancanti, riesecuzione match.
 * Nessun movimento di magazzino qui.
 */

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { AppError } from "../errors/app-error.ts";
import {
  findArticleByCode,
  findArticleById,
  insertArticle,
  listArticles,
} from "../repositories/articles-repository.ts";
import {
  findDdtById,
  getDdtDetail,
  listDdtLines,
  updateDdtDocumentFields,
  updateDdtLine,
} from "../repositories/ddt-repository.ts";
import {
  normalizeArticleCode,
  parseArticleCreateInput,
  type ArticleDto,
  type ArticleUnitId,
} from "../../shared/articles.ts";
import {
  buildMissingArticleDrafts,
  collectDdtRegistrationIssues,
  parseDdtQuantityDetailed,
  type DdtDetailDto,
  type DdtLineDto,
  type DdtMissingArticleDraft,
  type DdtStatus,
} from "../../shared/ddt.ts";

export function findActiveArticleByNormalizedCode(
  db: Database,
  code: string | null,
): ArticleDto | null {
  if (!code) {
    return null;
  }
  const normalized = normalizeArticleCode(code);
  if (!normalized) {
    return null;
  }
  const article = findArticleByCode(db, normalized);
  return article && article.status === "active" ? article : null;
}

/** Solo suggerimenti: non usati per auto-associazione. */
export function suggestArticlesByDescription(
  db: Database,
  description: string | null,
  limit = 5,
): ArticleDto[] {
  if (!description || description.trim().length < 4) {
    return [];
  }
  const result = listArticles(db, {
    search: description.trim().slice(0, 80),
    status: "active",
    page: 1,
    pageSize: limit,
  });
  return result.items;
}

export function evaluateLineAssociation(
  db: Database,
  line: {
    originalCode: string | null;
    unitNormalized: ArticleUnitId | null;
    quantityRaw: string | null;
    quantityMilli: number | null;
    warnings: string[];
    validationStatus: DdtLineDto["validationStatus"];
    articleId?: string | null;
  },
): {
  articleId: string | null;
  quantityMilli: number | null;
  warnings: string[];
  validationStatus: DdtLineDto["validationStatus"];
} {
  const warnings = [...line.warnings];
  let articleId = line.articleId ?? null;
  if (!articleId) {
    articleId = findActiveArticleByNormalizedCode(db, line.originalCode)?.id ?? null;
  }

  const qty = parseDdtQuantityDetailed(line.quantityRaw, line.unitNormalized);
  const quantityMilli =
    qty.quantityMilli !== null ? qty.quantityMilli : line.quantityMilli;
  if (qty.warning && !warnings.includes(qty.warning)) {
    warnings.push(qty.warning);
  }

  if (!articleId) {
    warnings.push(
      line.originalCode
        ? "Articolo assente in catalogo (match esatto per codice)."
        : "Articolo non associato: codice assente.",
    );
  } else {
    const article = findArticleById(db, articleId);
    if (article && line.unitNormalized && line.unitNormalized !== article.unit) {
      const msg = `Unità estratta (${line.unitNormalized}) diversa da catalogo (${article.unit}).`;
      if (!warnings.includes(msg)) {
        warnings.push(msg);
      }
    }
  }

  let validationStatus = line.validationStatus;
  if (!articleId || quantityMilli === null || qty.ambiguous) {
    validationStatus = "error";
  } else if (
    warnings.some((w) => /diversa da catalogo|migliaia|ambigua/i.test(w))
  ) {
    validationStatus = "warning";
  } else if (validationStatus === "unchecked") {
    validationStatus = warnings.length ? "warning" : "ok";
  } else if (validationStatus === "ok" && warnings.length) {
    validationStatus = "warning";
  }

  return { articleId, quantityMilli, warnings, validationStatus };
}

function refreshDocumentStatusAfterAssociation(
  db: Database,
  documentId: string,
): DdtDetailDto {
  const current = findDdtById(db, documentId);
  if (!current) {
    throw AppError.notFound("Documento DDT non trovato.");
  }
  if (current.status === "registered" || current.status === "cancelled") {
    const detail = getDdtDetail(db, documentId);
    if (!detail) {
      throw AppError.internal("Lettura DDT fallita.");
    }
    return detail;
  }
  const lines = listDdtLines(db, documentId);
  const issues = collectDdtRegistrationIssues(current, lines);
  const nextStatus: DdtStatus =
    issues.blocking.length === 0 ? "ready" : "review_required";
  const summaryParts: string[] = [];
  if (issues.blocking.length > 0) {
    summaryParts.push(...issues.blocking.map((item) => item.message));
  }
  updateDdtDocumentFields(db, documentId, {
    status: nextStatus,
    lastError: summaryParts.length ? summaryParts.join(" ") : null,
  });
  const detail = getDdtDetail(db, documentId);
  if (!detail) {
    throw AppError.internal("Aggiornamento stato DDT fallito.");
  }
  return detail;
}

export function reassociateDdtArticlesOnDatabase(
  db: Database,
  documentId: string,
): DdtDetailDto {
  const current = findDdtById(db, documentId);
  if (!current) {
    throw AppError.notFound("Documento DDT non trovato.");
  }
  if (current.status === "registered") {
    throw AppError.conflict("Documento già registrato: associazioni bloccate.");
  }
  if (current.status === "cancelled") {
    throw AppError.conflict("Documento annullato.");
  }

  const lines = listDdtLines(db, documentId);
  for (const line of lines) {
    // Non sovrascrivere un'associazione manuale già presente se il codice matcha ancora.
    const preferredId = line.articleId;
    const matched = findActiveArticleByNormalizedCode(db, line.originalCode);
    let articleId = matched?.id ?? null;
    if (preferredId && !articleId) {
      const stillThere = findArticleById(db, preferredId);
      if (stillThere && stillThere.status === "active") {
        articleId = preferredId;
      }
    } else if (preferredId && matched && preferredId !== matched.id) {
      // Match esatto per codice ha priorità assoluta.
      articleId = matched.id;
    }

    const evaluated = evaluateLineAssociation(db, {
      originalCode: line.originalCode,
      unitNormalized: line.unitNormalized,
      quantityRaw: line.quantityRaw,
      quantityMilli: line.quantityMilli,
      warnings: line.warnings.filter(
        (w) =>
          !/assente in catalogo|non associato|Nessun articolo/i.test(w),
      ),
      validationStatus: line.validationStatus,
      articleId,
    });

    updateDdtLine(db, {
      id: line.id,
      originalCode: line.originalCode,
      originalDescription: line.originalDescription,
      articleId: evaluated.articleId,
      quantityRaw: line.quantityRaw,
      quantityMilli: evaluated.quantityMilli,
      unitNormalized: line.unitNormalized,
      source: line.source,
      warnings: evaluated.warnings,
      validationStatus: evaluated.validationStatus,
    });
  }

  return refreshDocumentStatusAfterAssociation(db, documentId);
}

export function createMissingDdtArticlesOnDatabase(
  db: Database,
  documentId: string,
  draftsInput?: DdtMissingArticleDraft[],
): DdtDetailDto {
  const current = findDdtById(db, documentId);
  if (!current) {
    throw AppError.notFound("Documento DDT non trovato.");
  }
  if (current.status === "registered") {
    throw AppError.conflict("Documento già registrato.");
  }
  if (current.status === "cancelled") {
    throw AppError.conflict("Documento annullato.");
  }

  const lines = listDdtLines(db, documentId);
  const unlinked = lines.filter((line) => !line.articleId);
  const drafts =
    draftsInput && draftsInput.length > 0
      ? draftsInput
      : buildMissingArticleDrafts(lines);

  if (drafts.length === 0) {
    if (unlinked.length === 0) {
      // Idempotente: tutto già associato.
      return refreshDocumentStatusAfterAssociation(db, documentId);
    }
    throw AppError.validation(
      "Nessun articolo mancante creabile: servono codice e unità sulle righe non associate.",
    );
  }

  const createdByNormalizedCode = new Map<string, ArticleDto>();
  const errors: string[] = [];

  for (const draft of drafts) {
    try {
      const fields = parseArticleCreateInput({
        code: draft.code,
        description: draft.description,
        category: null,
        unit: draft.unit,
        minStock: null,
        notes: "Creato da DDT (creazione massiva)",
      });
      const existing = findArticleByCode(db, fields.code);
      if (existing) {
        if (existing.status !== "active") {
          errors.push(`${fields.code}: presente ma non attivo.`);
          continue;
        }
        createdByNormalizedCode.set(fields.code, existing);
        continue;
      }
      const created = insertArticle(db, randomUUID(), fields);
      createdByNormalizedCode.set(fields.code, created);
    } catch (error) {
      errors.push(
        `${draft.code}: ${error instanceof Error ? error.message : "creazione fallita"}`,
      );
    }
  }

  for (const line of lines) {
    if (line.articleId) {
      continue;
    }
    if (!line.originalCode) {
      continue;
    }
    const code = normalizeArticleCode(line.originalCode);
    const article =
      createdByNormalizedCode.get(code) ??
      findActiveArticleByNormalizedCode(db, line.originalCode);
    if (!article) {
      continue;
    }
    const evaluated = evaluateLineAssociation(db, {
      originalCode: line.originalCode,
      unitNormalized: line.unitNormalized,
      quantityRaw: line.quantityRaw,
      quantityMilli: line.quantityMilli,
      warnings: line.warnings.filter(
        (w) =>
          !/assente in catalogo|non associato|Nessun articolo/i.test(w),
      ),
      validationStatus: line.validationStatus,
      articleId: article.id,
    });
    updateDdtLine(db, {
      id: line.id,
      originalCode: line.originalCode,
      originalDescription: line.originalDescription,
      articleId: evaluated.articleId,
      quantityRaw: line.quantityRaw,
      quantityMilli: evaluated.quantityMilli,
      unitNormalized: line.unitNormalized,
      source: line.source,
      warnings: evaluated.warnings,
      validationStatus: evaluated.validationStatus,
    });
  }

  const detail = refreshDocumentStatusAfterAssociation(db, documentId);
  if (errors.length > 0) {
    updateDdtDocumentFields(db, documentId, {
      lastError: [
        detail.document.lastError,
        `Creazione parziale: ${errors.slice(0, 5).join(" · ")}${errors.length > 5 ? ` (+${errors.length - 5})` : ""}`,
      ]
        .filter(Boolean)
        .join(" "),
    });
    const refreshed = getDdtDetail(db, documentId);
    if (!refreshed) {
      throw AppError.internal("Creazione articoli DDT fallita.");
    }
    return refreshed;
  }
  return detail;
}
