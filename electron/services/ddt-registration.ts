import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { AppError } from "../errors/app-error.ts";
import { findArticleById } from "../repositories/articles-repository.ts";
import {
  getDdtDetail,
  insertDdtLineStockLink,
  transitionDdtStatus,
} from "../repositories/ddt-repository.ts";
import {
  getArticleStockMilli,
  insertStockMovement,
} from "../repositories/stock-movements-repository.ts";
import {
  canTransitionDdtStatus,
  collectDdtRegistrationIssues,
  type DdtDetailDto,
} from "../../shared/ddt.ts";
import { milliToQuantityString } from "../../shared/quotes-money.ts";

/** Core registration — callable from app IPC and unit tests with a DB handle. */
export function registerDdtOnDatabase(db: Database, id: string): DdtDetailDto {
  const detail = getDdtDetail(db, id);
  if (!detail) {
    throw AppError.notFound("Documento DDT non trovato.");
  }
  const { document, lines } = detail;
  if (document.status === "registered") {
    throw AppError.conflict("Documento già registrato.");
  }
  if (!canTransitionDdtStatus(document.status, "registered")) {
    throw AppError.conflict(
      `Stato attuale "${document.status}" non consente la registrazione.`,
    );
  }

  const issues = collectDdtRegistrationIssues(document, lines);
  if (issues.blocking.length > 0) {
    throw AppError.validation(
      issues.blocking.map((item) => item.message).join(" "),
    );
  }

  const claimed = transitionDdtStatus(db, id, document.status, "registered", {
    registeredAt: new Date().toISOString().slice(0, 19).replace("T", " "),
  });
  if (!claimed) {
    throw AppError.conflict(
      "Registrazione già in corso o documento non più registrabile.",
    );
  }

  const movementType = document.documentType === "inbound" ? "in" : "out";

  for (const line of lines) {
    if (!line.articleId || line.quantityMilli === null) {
      throw AppError.validation(`Riga ${line.lineNumber} incompleta.`);
    }
    if (line.stockMovementId) {
      continue;
    }
    const article = findArticleById(db, line.articleId);
    if (!article || article.status === "archived") {
      throw AppError.conflict(
        `Articolo non disponibile per la riga ${line.lineNumber}.`,
      );
    }
    if (line.unitNormalized && line.unitNormalized !== article.unit) {
      throw AppError.validation(
        `Unità incompatibile in riga ${line.lineNumber}.`,
      );
    }
    if (movementType === "out") {
      const current = getArticleStockMilli(db, article.id);
      if (line.quantityMilli > current) {
        throw AppError.conflict(
          `Giacenza insufficiente per ${article.code}. Disponibile: ${milliToQuantityString(current)} ${article.unit}.`,
        );
      }
    }

    const movementId = randomUUID();
    insertStockMovement(db, {
      id: movementId,
      articleId: article.id,
      movementType,
      quantityMilli: line.quantityMilli,
      movementDate:
        document.documentDate ?? new Date().toISOString().slice(0, 10),
      reason: `DDT ${document.documentNumber ?? document.id}`,
      notes: `Riga ${line.lineNumber}`,
    });
    insertDdtLineStockLink(db, {
      id: randomUUID(),
      lineId: line.id,
      stockMovementId: movementId,
    });
  }

  const finalDetail = getDdtDetail(db, id);
  if (!finalDetail) {
    throw AppError.internal("Registrazione DDT fallita.");
  }
  return finalDetail;
}
