import { randomUUID } from "node:crypto";
import { AppError } from "../errors/app-error.ts";
import { getDatabase, withAppTransaction } from "../db/connection.ts";
import { findArticleById } from "../repositories/articles-repository.ts";
import {
  getArticleStockMilli,
  getWarehouseSummary,
  insertStockMovement,
  listStockBalances,
  listStockMovements,
} from "../repositories/stock-movements-repository.ts";
import { milliToQuantityString } from "../../shared/quotes-money.ts";
import {
  isOutboundMovement,
  parseArticleIdForStock,
  parseStockBalanceListQuery,
  parseStockMovementCreateInput,
  parseStockMovementListQuery,
  parseStockQuantityToMilli,
  type ArticleStockDto,
  type StockBalanceListResult,
  type StockMovementDto,
  type StockMovementListResult,
  type WarehouseSummaryDto,
} from "../../shared/stock-movements.ts";

function wrapDbError(fallback: string, error: unknown): never {
  if (error instanceof AppError) {
    throw error;
  }
  throw AppError.internal(fallback, error);
}

export function createStockMovementForApp(input: unknown): StockMovementDto {
  let payload;
  try {
    payload = parseStockMovementCreateInput(input);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dati movimento non validi.";
    throw AppError.validation(message, error);
  }

  try {
    return withAppTransaction((db) => {
      const article = findArticleById(db, payload.articleId);
      if (!article) {
        throw AppError.notFound("Articolo non trovato.");
      }
      if (article.status === "archived") {
        throw AppError.conflict(
          "Non è possibile registrare movimenti su un articolo archiviato.",
        );
      }

      let quantityMilli: number;
      try {
        quantityMilli = parseStockQuantityToMilli(
          payload.quantity,
          article.unit,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Quantità non valida.";
        throw AppError.validation(message, error);
      }

      const current = getArticleStockMilli(db, article.id);
      if (isOutboundMovement(payload.movementType)) {
        if (quantityMilli > current) {
          throw AppError.conflict(
            `Giacenza insufficiente. Disponibile: ${milliToQuantityString(current)} ${article.unit}.`,
          );
        }
      }

      return insertStockMovement(db, {
        id: randomUUID(),
        articleId: article.id,
        movementType: payload.movementType,
        quantityMilli,
        movementDate: payload.movementDate,
        reason: payload.reason,
        notes: payload.notes,
      });
    });
  } catch (error) {
    wrapDbError("Impossibile registrare il movimento di magazzino.", error);
  }
}

export function listStockMovementsForApp(
  input: unknown,
): StockMovementListResult {
  let query;
  try {
    query = parseStockMovementListQuery(input);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Parametri di elenco movimenti non validi.";
    throw AppError.validation(message, error);
  }

  try {
    return listStockMovements(getDatabase(), query);
  } catch (error) {
    wrapDbError("Impossibile leggere lo storico movimenti.", error);
  }
}

export function listStockBalancesForApp(
  input: unknown,
): StockBalanceListResult {
  let query;
  try {
    query = parseStockBalanceListQuery(input);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Parametri di elenco giacenze non validi.";
    throw AppError.validation(message, error);
  }

  try {
    return listStockBalances(getDatabase(), query);
  } catch (error) {
    wrapDbError("Impossibile leggere le giacenze.", error);
  }
}

export function getArticleStockForApp(input: unknown): ArticleStockDto {
  let articleId: string;
  try {
    articleId = parseArticleIdForStock(input);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Identificativo articolo non valido.";
    throw AppError.validation(message, error);
  }

  try {
    const article = findArticleById(getDatabase(), articleId);
    if (!article) {
      throw AppError.notFound("Articolo non trovato.");
    }
    const stockMilli = getArticleStockMilli(getDatabase(), articleId);
    return {
      articleId,
      stockMilli,
      stock: milliToQuantityString(stockMilli),
    };
  } catch (error) {
    wrapDbError("Impossibile leggere la giacenza.", error);
  }
}

export function getWarehouseSummaryForApp(): WarehouseSummaryDto {
  try {
    return getWarehouseSummary(getDatabase());
  } catch (error) {
    wrapDbError("Impossibile calcolare il riepilogo magazzino.", error);
  }
}
