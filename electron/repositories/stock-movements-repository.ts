import type Database from "better-sqlite3";
import { milliToQuantityString } from "../../shared/quotes-money.ts";
import type { ArticleUnitId } from "../../shared/articles.ts";
import {
  isBelowMinStock,
  minStockToMilli,
  type StockBalanceDto,
  type StockBalanceListQuery,
  type StockBalanceListResult,
  type StockMovementDto,
  type StockMovementListQuery,
  type StockMovementListResult,
  type StockMovementType,
  type WarehouseSummaryDto,
} from "../../shared/stock-movements.ts";

type MovementRow = {
  id: string;
  article_id: string;
  article_code: string;
  article_description: string;
  article_unit: string;
  movement_type: string;
  quantity_milli: number;
  movement_date: string;
  reason: string | null;
  notes: string | null;
  created_at: string;
};

const STOCK_SUM_SQL = `
  COALESCE(SUM(
    CASE movement_type
      WHEN 'in' THEN quantity_milli
      WHEN 'adjustment_in' THEN quantity_milli
      WHEN 'out' THEN -quantity_milli
      WHEN 'adjustment_out' THEN -quantity_milli
      ELSE 0
    END
  ), 0)
`;

function mapMovement(row: MovementRow): StockMovementDto {
  return {
    id: row.id,
    articleId: row.article_id,
    articleCode: row.article_code,
    articleDescription: row.article_description,
    articleUnit: row.article_unit as ArticleUnitId,
    movementType: row.movement_type as StockMovementType,
    quantityMilli: row.quantity_milli,
    quantity: milliToQuantityString(row.quantity_milli),
    movementDate: row.movement_date,
    reason: row.reason,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export function getArticleStockMilli(db: Database, articleId: string): number {
  const row = db
    .prepare(
      `SELECT ${STOCK_SUM_SQL} AS stock_milli
       FROM stock_movements
       WHERE article_id = ?`,
    )
    .get(articleId) as { stock_milli: number };
  return Number(row.stock_milli) || 0;
}

export function insertStockMovement(
  db: Database,
  params: {
    id: string;
    articleId: string;
    movementType: StockMovementType;
    quantityMilli: number;
    movementDate: string;
    reason: string | null;
    notes: string | null;
  },
): StockMovementDto {
  db.prepare(
    `INSERT INTO stock_movements (
      id, article_id, movement_type, quantity_milli, movement_date,
      reason, notes, created_at
    ) VALUES (
      @id, @article_id, @movement_type, @quantity_milli, @movement_date,
      @reason, @notes, datetime('now')
    )`,
  ).run({
    id: params.id,
    article_id: params.articleId,
    movement_type: params.movementType,
    quantity_milli: params.quantityMilli,
    movement_date: params.movementDate,
    reason: params.reason,
    notes: params.notes,
  });

  const created = findStockMovementById(db, params.id);
  if (!created) {
    throw new Error("Insert stock movement failed to re-read.");
  }
  return created;
}

export function findStockMovementById(
  db: Database,
  id: string,
): StockMovementDto | null {
  const row = db
    .prepare(
      `SELECT
         m.id, m.article_id, a.code AS article_code,
         a.description AS article_description, a.unit AS article_unit,
         m.movement_type, m.quantity_milli, m.movement_date,
         m.reason, m.notes, m.created_at
       FROM stock_movements m
       INNER JOIN articles a ON a.id = m.article_id
       WHERE m.id = ?`,
    )
    .get(id) as MovementRow | undefined;
  return row ? mapMovement(row) : null;
}

export function listStockMovements(
  db: Database,
  query: StockMovementListQuery,
): StockMovementListResult {
  const clauses: string[] = [];
  const params: Record<string, string | number> = {};

  if (query.articleId) {
    clauses.push("m.article_id = @article_id");
    params.article_id = query.articleId;
  }
  if (query.movementType !== "all") {
    clauses.push("m.movement_type = @movement_type");
    params.movement_type = query.movementType;
  }
  if (query.dateFrom) {
    clauses.push("m.movement_date >= @date_from");
    params.date_from = query.dateFrom;
  }
  if (query.dateTo) {
    clauses.push("m.movement_date <= @date_to");
    params.date_to = query.dateTo;
  }
  if (query.search.length > 0) {
    clauses.push(
      `(a.code LIKE @search ESCAPE '\\' OR a.description LIKE @search ESCAPE '\\' OR IFNULL(m.reason, '') LIKE @search ESCAPE '\\')`,
    );
    const escaped = query.search
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_");
    params.search = `%${escaped}%`;
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM stock_movements m
       INNER JOIN articles a ON a.id = m.article_id
       ${whereSql}`,
    )
    .get(params) as { c: number };
  const total = Number(totalRow.c) || 0;

  const pageParams = {
    ...params,
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  };

  const rows = db
    .prepare(
      `SELECT
         m.id, m.article_id, a.code AS article_code,
         a.description AS article_description, a.unit AS article_unit,
         m.movement_type, m.quantity_milli, m.movement_date,
         m.reason, m.notes, m.created_at
       FROM stock_movements m
       INNER JOIN articles a ON a.id = m.article_id
       ${whereSql}
       ORDER BY m.movement_date DESC, m.created_at DESC, m.id DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all(pageParams) as MovementRow[];

  return {
    items: rows.map(mapMovement),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

type BalanceRow = {
  id: string;
  code: string;
  description: string;
  unit: string;
  min_stock: number | null;
  status: string;
  stock_milli: number;
};

function mapBalance(row: BalanceRow): StockBalanceDto {
  const stockMilli = Number(row.stock_milli) || 0;
  const minStock = row.min_stock === null ? null : Number(row.min_stock);
  return {
    articleId: row.id,
    code: row.code,
    description: row.description,
    unit: row.unit as ArticleUnitId,
    stockMilli,
    stock: milliToQuantityString(stockMilli),
    minStock,
    minStockMilli: minStockToMilli(minStock),
    belowMinStock: isBelowMinStock(stockMilli, minStock),
    status: row.status as "active" | "archived",
  };
}

const BALANCE_FROM = `
  FROM articles a
  LEFT JOIN (
    SELECT article_id, ${STOCK_SUM_SQL} AS stock_milli
    FROM stock_movements
    GROUP BY article_id
  ) s ON s.article_id = a.id
`;

export function listStockBalances(
  db: Database,
  query: StockBalanceListQuery,
): StockBalanceListResult {
  const clauses: string[] = ["a.status = 'active'"];
  const params: Record<string, string | number> = {};

  if (query.search.length > 0) {
    clauses.push(
      `(a.code LIKE @search ESCAPE '\\' OR a.description LIKE @search ESCAPE '\\')`,
    );
    const escaped = query.search
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_");
    params.search = `%${escaped}%`;
  }

  if (query.filter === "below_min") {
    clauses.push(`a.min_stock IS NOT NULL AND a.min_stock > 0`);
    clauses.push(
      `COALESCE(s.stock_milli, 0) <= CAST(ROUND(a.min_stock * 1000) AS INTEGER)`,
    );
  }

  const whereSql = `WHERE ${clauses.join(" AND ")}`;

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c ${BALANCE_FROM} ${whereSql}`)
    .get(params) as { c: number };
  const total = Number(totalRow.c) || 0;

  const pageParams = {
    ...params,
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  };

  const rows = db
    .prepare(
      `SELECT
         a.id, a.code, a.description, a.unit, a.min_stock, a.status,
         COALESCE(s.stock_milli, 0) AS stock_milli
       ${BALANCE_FROM}
       ${whereSql}
       ORDER BY a.code COLLATE NOCASE ASC, a.id ASC
       LIMIT @limit OFFSET @offset`,
    )
    .all(pageParams) as BalanceRow[];

  return {
    items: rows.map(mapBalance),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export function getWarehouseSummary(db: Database): WarehouseSummaryDto {
  const active = db
    .prepare(`SELECT COUNT(*) AS c FROM articles WHERE status = 'active'`)
    .get() as { c: number };
  const movements = db
    .prepare(`SELECT COUNT(*) AS c FROM stock_movements`)
    .get() as { c: number };
  const below = db
    .prepare(
      `SELECT COUNT(*) AS c
       ${BALANCE_FROM}
       WHERE a.status = 'active'
         AND a.min_stock IS NOT NULL
         AND a.min_stock > 0
         AND COALESCE(s.stock_milli, 0) <= CAST(ROUND(a.min_stock * 1000) AS INTEGER)`,
    )
    .get() as { c: number };

  return {
    activeArticles: Number(active.c) || 0,
    belowMinStockCount: Number(below.c) || 0,
    movementCount: Number(movements.c) || 0,
  };
}

/** Count movements for an article (immutability / FK diagnostics). */
export function countMovementsForArticle(
  db: Database,
  articleId: string,
): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM stock_movements WHERE article_id = ?`)
    .get(articleId) as { c: number };
  return Number(row.c) || 0;
}
