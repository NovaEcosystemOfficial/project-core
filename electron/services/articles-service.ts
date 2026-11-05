import { randomUUID } from "node:crypto";
import { AppError } from "../errors/app-error.ts";
import { getDatabase, withAppTransaction } from "../db/connection.ts";
import {
  findArticleByCode,
  findArticleById,
  insertArticle,
  listArticles,
  setArticleStatus,
  updateArticleFields,
} from "../repositories/articles-repository.ts";
import {
  parseArticleCreateInput,
  parseArticleIdInput,
  parseArticleListQuery,
  parseArticleUpdateInput,
  type ArticleDto,
  type ArticleListResult,
} from "../../shared/articles.ts";

function wrapDbError(fallback: string, error: unknown): never {
  if (error instanceof AppError) {
    throw error;
  }
  if (error instanceof Error && /UNIQUE/i.test(error.message)) {
    throw AppError.conflict(
      "Esiste già un articolo con questo codice.",
      error,
    );
  }
  throw AppError.internal(fallback, error);
}

export function listArticlesForApp(input: unknown): ArticleListResult {
  let query;
  try {
    query = parseArticleListQuery(input);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Parametri di elenco non validi.";
    throw AppError.validation(message, error);
  }

  try {
    return listArticles(getDatabase(), query);
  } catch (error) {
    wrapDbError("Impossibile leggere gli articoli.", error);
  }
}

export function getArticleForApp(input: unknown): ArticleDto {
  let id: string;
  try {
    id = parseArticleIdInput(input);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Identificativo articolo non valido.";
    throw AppError.validation(message, error);
  }

  try {
    const article = findArticleById(getDatabase(), id);
    if (!article) {
      throw AppError.notFound("Articolo non trovato.");
    }
    return article;
  } catch (error) {
    wrapDbError("Impossibile leggere l’articolo.", error);
  }
}

export function createArticleForApp(input: unknown): ArticleDto {
  let fields;
  try {
    fields = parseArticleCreateInput(input);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dati articolo non validi.";
    throw AppError.validation(message, error);
  }

  try {
    return withAppTransaction((db) => {
      const duplicate = findArticleByCode(db, fields.code);
      if (duplicate) {
        throw AppError.conflict("Esiste già un articolo con questo codice.");
      }
      return insertArticle(db, randomUUID(), fields);
    });
  } catch (error) {
    wrapDbError("Impossibile creare l’articolo.", error);
  }
}

export function updateArticleForApp(input: unknown): ArticleDto {
  let payload;
  try {
    payload = parseArticleUpdateInput(input);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dati articolo non validi.";
    throw AppError.validation(message, error);
  }

  try {
    return withAppTransaction((db) => {
      const existing = findArticleById(db, payload.id);
      if (!existing) {
        throw AppError.notFound("Articolo non trovato.");
      }
      const duplicate = findArticleByCode(db, payload.code);
      if (duplicate && duplicate.id !== payload.id) {
        throw AppError.conflict("Esiste già un articolo con questo codice.");
      }
      const { id, ...fields } = payload;
      const updated = updateArticleFields(db, id, fields);
      if (!updated) {
        throw AppError.notFound("Articolo non trovato.");
      }
      return updated;
    });
  } catch (error) {
    wrapDbError("Impossibile aggiornare l’articolo.", error);
  }
}

export function archiveArticleForApp(input: unknown): ArticleDto {
  let id: string;
  try {
    id = parseArticleIdInput(input);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Identificativo articolo non valido.";
    throw AppError.validation(message, error);
  }

  try {
    return withAppTransaction((db) => {
      const existing = findArticleById(db, id);
      if (!existing) {
        throw AppError.notFound("Articolo non trovato.");
      }
      if (existing.status === "archived") {
        throw AppError.conflict("L’articolo è già archiviato.");
      }
      const updated = setArticleStatus(db, id, "archived");
      if (!updated) {
        throw AppError.notFound("Articolo non trovato.");
      }
      return updated;
    });
  } catch (error) {
    wrapDbError("Impossibile archiviare l’articolo.", error);
  }
}

export function reactivateArticleForApp(input: unknown): ArticleDto {
  let id: string;
  try {
    id = parseArticleIdInput(input);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Identificativo articolo non valido.";
    throw AppError.validation(message, error);
  }

  try {
    return withAppTransaction((db) => {
      const existing = findArticleById(db, id);
      if (!existing) {
        throw AppError.notFound("Articolo non trovato.");
      }
      if (existing.status === "active") {
        throw AppError.conflict("L’articolo è già attivo.");
      }
      const updated = setArticleStatus(db, id, "active");
      if (!updated) {
        throw AppError.notFound("Articolo non trovato.");
      }
      return updated;
    });
  } catch (error) {
    wrapDbError("Impossibile riattivare l’articolo.", error);
  }
}
