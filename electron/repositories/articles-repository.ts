import type Database from "better-sqlite3";
import type {
  ArticleDto,
  ArticleListQuery,
  ArticleListResult,
  ArticleStatus,
  ArticleUnitId,
  ArticleWriteFields,
} from "../../shared/articles.ts";

type ArticleRow = {
  id: string;
  code: string;
  description: string;
  category: string | null;
  unit: string;
  min_stock: number | null;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

const ARTICLE_SELECT = `
  SELECT
    id, code, description, category, unit, min_stock, notes, status,
    created_at, updated_at
  FROM articles
`;

function mapRow(row: ArticleRow): ArticleDto {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    category: row.category,
    unit: row.unit as ArticleUnitId,
    minStock: row.min_stock === null ? null : Number(row.min_stock),
    notes: row.notes,
    status: row.status as ArticleStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildFilterClause(query: ArticleListQuery): {
  whereSql: string;
  params: Record<string, string | number>;
} {
  const clauses: string[] = [];
  const params: Record<string, string | number> = {};

  if (query.status === "active" || query.status === "archived") {
    clauses.push("status = @status");
    params.status = query.status;
  }

  if (query.search.length > 0) {
    clauses.push(
      `(code LIKE @search ESCAPE '\\' OR description LIKE @search ESCAPE '\\' OR IFNULL(category, '') LIKE @search ESCAPE '\\')`,
    );
    const escaped = query.search
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_");
    params.search = `%${escaped}%`;
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return { whereSql, params };
}

export function findArticleById(db: Database, id: string): ArticleDto | null {
  const row = db.prepare(`${ARTICLE_SELECT} WHERE id = ?`).get(id) as
    | ArticleRow
    | undefined;
  return row ? mapRow(row) : null;
}

export function findArticleByCode(
  db: Database,
  normalizedCode: string,
): ArticleDto | null {
  const row = db.prepare(`${ARTICLE_SELECT} WHERE code = ?`).get(normalizedCode) as
    | ArticleRow
    | undefined;
  return row ? mapRow(row) : null;
}

export function insertArticle(
  db: Database,
  id: string,
  fields: ArticleWriteFields,
): ArticleDto {
  db.prepare(
    `INSERT INTO articles (
      id, code, description, category, unit, min_stock, notes, status,
      created_at, updated_at
    ) VALUES (
      @id, @code, @description, @category, @unit, @min_stock, @notes, 'active',
      datetime('now'), datetime('now')
    )`,
  ).run({
    id,
    code: fields.code,
    description: fields.description,
    category: fields.category,
    unit: fields.unit,
    min_stock: fields.minStock,
    notes: fields.notes,
  });

  const created = findArticleById(db, id);
  if (!created) {
    throw new Error("Insert article failed to re-read.");
  }
  return created;
}

export function updateArticleFields(
  db: Database,
  id: string,
  fields: ArticleWriteFields,
): ArticleDto | null {
  const result = db
    .prepare(
      `UPDATE articles SET
        code = @code,
        description = @description,
        category = @category,
        unit = @unit,
        min_stock = @min_stock,
        notes = @notes,
        updated_at = datetime('now')
      WHERE id = @id`,
    )
    .run({
      id,
      code: fields.code,
      description: fields.description,
      category: fields.category,
      unit: fields.unit,
      min_stock: fields.minStock,
      notes: fields.notes,
    });

  if (result.changes === 0) {
    return null;
  }
  return findArticleById(db, id);
}

export function setArticleStatus(
  db: Database,
  id: string,
  status: ArticleStatus,
): ArticleDto | null {
  const result = db
    .prepare(
      `UPDATE articles SET
        status = @status,
        updated_at = datetime('now')
      WHERE id = @id`,
    )
    .run({ id, status });
  if (result.changes === 0) {
    return null;
  }
  return findArticleById(db, id);
}

export function listArticles(
  db: Database,
  query: ArticleListQuery,
): ArticleListResult {
  const { whereSql, params } = buildFilterClause(query);
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM articles ${whereSql}`)
    .get(params) as { c: number };
  const total = Number(totalRow.c) || 0;

  const pageParams: Record<string, string | number> = {
    ...params,
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  };

  const rows = db
    .prepare(
      `${ARTICLE_SELECT}
       ${whereSql}
       ORDER BY code COLLATE NOCASE ASC, id ASC
       LIMIT @limit OFFSET @offset`,
    )
    .all(pageParams) as ArticleRow[];

  return {
    items: rows.map(mapRow),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}
