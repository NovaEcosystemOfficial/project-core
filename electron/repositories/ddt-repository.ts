import type Database from "better-sqlite3";
import type { ArticleUnitId } from "../../shared/articles.ts";
import {
  type DdtAllowedMime,
  type DdtDashboardDto,
  type DdtDetailDto,
  type DdtDocumentDto,
  type DdtDocumentType,
  type DdtLineDto,
  type DdtLineSource,
  type DdtLineValidation,
  type DdtListQuery,
  type DdtListResult,
  type DdtOcrStatus,
  type DdtProcessingDto,
  type DdtStatus,
} from "../../shared/ddt.ts";

type DocRow = {
  id: string;
  document_type: string;
  document_number: string | null;
  document_date: string | null;
  counterparty_name: string | null;
  counterparty_party_id: string | null;
  order_reference: string | null;
  original_relative_path: string;
  original_file_name: string;
  mime_type: string;
  content_sha256: string;
  byte_size: number;
  page_count: number | null;
  status: string;
  ocr_status: string;
  document_key: string | null;
  notes: string | null;
  last_error: string | null;
  imported_at: string;
  processed_at: string | null;
  registered_at: string | null;
  created_at: string;
  updated_at: string;
};

type LineRow = {
  id: string;
  document_id: string;
  line_number: number;
  original_code: string | null;
  original_description: string | null;
  article_id: string | null;
  article_code: string | null;
  article_description: string | null;
  article_unit: string | null;
  quantity_raw: string | null;
  quantity_milli: number | null;
  unit_raw: string | null;
  unit_normalized: string | null;
  source: string;
  confidence: number | null;
  warnings_json: string;
  validation_status: string;
  page_number: number | null;
  stock_movement_id: string | null;
};

type ProcessingRow = {
  id: string;
  document_id: string;
  attempt: number;
  strategy: string;
  outcome: string;
  parser_version: string;
  message: string | null;
  started_at: string;
  finished_at: string | null;
};

function mapDocument(row: DocRow): DdtDocumentDto {
  return {
    id: row.id,
    documentType: row.document_type as DdtDocumentType,
    documentNumber: row.document_number,
    documentDate: row.document_date,
    counterpartyName: row.counterparty_name,
    counterpartyPartyId: row.counterparty_party_id,
    orderReference: row.order_reference,
    originalRelativePath: row.original_relative_path,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type as DdtAllowedMime,
    contentSha256: row.content_sha256,
    byteSize: row.byte_size,
    pageCount: row.page_count,
    status: row.status as DdtStatus,
    ocrStatus: row.ocr_status as DdtOcrStatus,
    documentKey: row.document_key,
    notes: row.notes,
    lastError: row.last_error,
    importedAt: row.imported_at,
    processedAt: row.processed_at,
    registeredAt: row.registered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseWarnings(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function mapLine(row: LineRow): DdtLineDto {
  return {
    id: row.id,
    documentId: row.document_id,
    lineNumber: row.line_number,
    originalCode: row.original_code,
    originalDescription: row.original_description,
    articleId: row.article_id,
    articleCode: row.article_code,
    articleDescription: row.article_description,
    articleUnit: (row.article_unit as ArticleUnitId | null) ?? null,
    quantityRaw: row.quantity_raw,
    quantityMilli: row.quantity_milli,
    unitRaw: row.unit_raw,
    unitNormalized: (row.unit_normalized as ArticleUnitId | null) ?? null,
    source: row.source as DdtLineSource,
    confidence: row.confidence,
    warnings: parseWarnings(row.warnings_json),
    validationStatus: row.validation_status as DdtLineValidation,
    pageNumber: row.page_number,
    stockMovementId: row.stock_movement_id,
  };
}

function mapProcessing(row: ProcessingRow): DdtProcessingDto {
  return {
    id: row.id,
    documentId: row.document_id,
    attempt: row.attempt,
    strategy: row.strategy as DdtProcessingDto["strategy"],
    outcome: row.outcome as DdtProcessingDto["outcome"],
    parserVersion: row.parser_version,
    message: row.message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function findDdtBySha256(
  db: Database,
  sha256: string,
): DdtDocumentDto | null {
  const row = db
    .prepare(`SELECT * FROM ddt_documents WHERE content_sha256 = ?`)
    .get(sha256) as DocRow | undefined;
  return row ? mapDocument(row) : null;
}

export function findDdtById(db: Database, id: string): DdtDocumentDto | null {
  const row = db
    .prepare(`SELECT * FROM ddt_documents WHERE id = ?`)
    .get(id) as DocRow | undefined;
  return row ? mapDocument(row) : null;
}

export function findDdtByDocumentKey(
  db: Database,
  documentKey: string,
  excludeId?: string,
): DdtDocumentDto | null {
  const row = excludeId
    ? (db
        .prepare(
          `SELECT * FROM ddt_documents
           WHERE document_key = ? AND id != ? AND status != 'cancelled'
           LIMIT 1`,
        )
        .get(documentKey, excludeId) as DocRow | undefined)
    : (db
        .prepare(
          `SELECT * FROM ddt_documents
           WHERE document_key = ? AND status != 'cancelled'
           LIMIT 1`,
        )
        .get(documentKey) as DocRow | undefined);
  return row ? mapDocument(row) : null;
}

export function insertDdtDocument(
  db: Database,
  doc: {
    id: string;
    documentType: DdtDocumentType;
    originalRelativePath: string;
    originalFileName: string;
    mimeType: DdtAllowedMime;
    contentSha256: string;
    byteSize: number;
    pageCount: number | null;
    status: DdtStatus;
    ocrStatus: DdtOcrStatus;
  },
): DdtDocumentDto {
  db.prepare(
    `INSERT INTO ddt_documents (
      id, document_type, original_relative_path, original_file_name,
      mime_type, content_sha256, byte_size, page_count, status, ocr_status
    ) VALUES (
      @id, @document_type, @original_relative_path, @original_file_name,
      @mime_type, @content_sha256, @byte_size, @page_count, @status, @ocr_status
    )`,
  ).run({
    id: doc.id,
    document_type: doc.documentType,
    original_relative_path: doc.originalRelativePath,
    original_file_name: doc.originalFileName,
    mime_type: doc.mimeType,
    content_sha256: doc.contentSha256,
    byte_size: doc.byteSize,
    page_count: doc.pageCount,
    status: doc.status,
    ocr_status: doc.ocrStatus,
  });
  const created = findDdtById(db, doc.id);
  if (!created) {
    throw new Error("Inserimento DDT fallito.");
  }
  return created;
}

export function updateDdtDocumentFields(
  db: Database,
  id: string,
  fields: Partial<{
    documentType: DdtDocumentType;
    documentNumber: string | null;
    documentDate: string | null;
    counterpartyName: string | null;
    counterpartyPartyId: string | null;
    orderReference: string | null;
    pageCount: number | null;
    status: DdtStatus;
    ocrStatus: DdtOcrStatus;
    documentKey: string | null;
    notes: string | null;
    lastError: string | null;
    processedAt: string | null;
    registeredAt: string | null;
  }>,
): DdtDocumentDto {
  const current = findDdtById(db, id);
  if (!current) {
    throw new Error("Documento DDT non trovato.");
  }
  db.prepare(
    `UPDATE ddt_documents SET
      document_type = @document_type,
      document_number = @document_number,
      document_date = @document_date,
      counterparty_name = @counterparty_name,
      counterparty_party_id = @counterparty_party_id,
      order_reference = @order_reference,
      page_count = @page_count,
      status = @status,
      ocr_status = @ocr_status,
      document_key = @document_key,
      notes = @notes,
      last_error = @last_error,
      processed_at = @processed_at,
      registered_at = @registered_at,
      updated_at = datetime('now')
     WHERE id = @id`,
  ).run({
    id,
    document_type: fields.documentType ?? current.documentType,
    document_number:
      fields.documentNumber !== undefined
        ? fields.documentNumber
        : current.documentNumber,
    document_date:
      fields.documentDate !== undefined
        ? fields.documentDate
        : current.documentDate,
    counterparty_name:
      fields.counterpartyName !== undefined
        ? fields.counterpartyName
        : current.counterpartyName,
    counterparty_party_id:
      fields.counterpartyPartyId !== undefined
        ? fields.counterpartyPartyId
        : current.counterpartyPartyId,
    order_reference:
      fields.orderReference !== undefined
        ? fields.orderReference
        : current.orderReference,
    page_count:
      fields.pageCount !== undefined ? fields.pageCount : current.pageCount,
    status: fields.status ?? current.status,
    ocr_status: fields.ocrStatus ?? current.ocrStatus,
    document_key:
      fields.documentKey !== undefined
        ? fields.documentKey
        : current.documentKey,
    notes: fields.notes !== undefined ? fields.notes : current.notes,
    last_error:
      fields.lastError !== undefined ? fields.lastError : current.lastError,
    processed_at:
      fields.processedAt !== undefined
        ? fields.processedAt
        : current.processedAt,
    registered_at:
      fields.registeredAt !== undefined
        ? fields.registeredAt
        : current.registeredAt,
  });
  const updated = findDdtById(db, id);
  if (!updated) {
    throw new Error("Aggiornamento DDT fallito.");
  }
  return updated;
}

/** Optimistic lock: transition only if current status matches. */
export function transitionDdtStatus(
  db: Database,
  id: string,
  from: DdtStatus,
  to: DdtStatus,
  extra?: { lastError?: string | null; registeredAt?: string | null },
): boolean {
  const result = db
    .prepare(
      `UPDATE ddt_documents SET
        status = @to,
        last_error = COALESCE(@last_error, last_error),
        registered_at = COALESCE(@registered_at, registered_at),
        updated_at = datetime('now')
       WHERE id = @id AND status = @from`,
    )
    .run({
      id,
      from,
      to,
      last_error: extra?.lastError ?? null,
      registered_at: extra?.registeredAt ?? null,
    });
  return result.changes === 1;
}

export function deleteLinesForDocument(db: Database, documentId: string): void {
  db.prepare(`DELETE FROM ddt_lines WHERE document_id = ?`).run(documentId);
}

export function insertDdtLine(
  db: Database,
  line: {
    id: string;
    documentId: string;
    lineNumber: number;
    originalCode: string | null;
    originalDescription: string | null;
    articleId: string | null;
    quantityRaw: string | null;
    quantityMilli: number | null;
    unitRaw: string | null;
    unitNormalized: ArticleUnitId | null;
    source: DdtLineSource;
    confidence: number | null;
    warnings: string[];
    validationStatus: DdtLineValidation;
    pageNumber: number | null;
  },
): void {
  db.prepare(
    `INSERT INTO ddt_lines (
      id, document_id, line_number, original_code, original_description,
      article_id, quantity_raw, quantity_milli, unit_raw, unit_normalized,
      source, confidence, warnings_json, validation_status, page_number
    ) VALUES (
      @id, @document_id, @line_number, @original_code, @original_description,
      @article_id, @quantity_raw, @quantity_milli, @unit_raw, @unit_normalized,
      @source, @confidence, @warnings_json, @validation_status, @page_number
    )`,
  ).run({
    id: line.id,
    document_id: line.documentId,
    line_number: line.lineNumber,
    original_code: line.originalCode,
    original_description: line.originalDescription,
    article_id: line.articleId,
    quantity_raw: line.quantityRaw,
    quantity_milli: line.quantityMilli,
    unit_raw: line.unitRaw,
    unit_normalized: line.unitNormalized,
    source: line.source,
    confidence: line.confidence,
    warnings_json: JSON.stringify(line.warnings),
    validation_status: line.validationStatus,
    page_number: line.pageNumber,
  });
}

export function updateDdtLine(
  db: Database,
  line: {
    id: string;
    originalCode: string | null;
    originalDescription: string | null;
    articleId: string | null;
    quantityRaw: string | null;
    quantityMilli: number | null;
    unitNormalized: ArticleUnitId | null;
    source: DdtLineSource;
    warnings: string[];
    validationStatus: DdtLineValidation;
  },
): void {
  db.prepare(
    `UPDATE ddt_lines SET
      original_code = @original_code,
      original_description = @original_description,
      article_id = @article_id,
      quantity_raw = @quantity_raw,
      quantity_milli = @quantity_milli,
      unit_normalized = @unit_normalized,
      source = @source,
      warnings_json = @warnings_json,
      validation_status = @validation_status,
      updated_at = datetime('now')
     WHERE id = @id`,
  ).run({
    id: line.id,
    original_code: line.originalCode,
    original_description: line.originalDescription,
    article_id: line.articleId,
    quantity_raw: line.quantityRaw,
    quantity_milli: line.quantityMilli,
    unit_normalized: line.unitNormalized,
    source: line.source,
    warnings_json: JSON.stringify(line.warnings),
    validation_status: line.validationStatus,
  });
}

export function listDdtLines(db: Database, documentId: string): DdtLineDto[] {
  const rows = db
    .prepare(
      `SELECT l.*,
              a.code AS article_code,
              a.description AS article_description,
              a.unit AS article_unit,
              link.stock_movement_id AS stock_movement_id
       FROM ddt_lines l
       LEFT JOIN articles a ON a.id = l.article_id
       LEFT JOIN ddt_line_stock_links link ON link.line_id = l.id
       WHERE l.document_id = ?
       ORDER BY l.line_number ASC`,
    )
    .all(documentId) as LineRow[];
  return rows.map(mapLine);
}

export function insertDdtProcessing(
  db: Database,
  processing: {
    id: string;
    documentId: string;
    attempt: number;
    strategy: DdtProcessingDto["strategy"];
    outcome: DdtProcessingDto["outcome"];
    parserVersion: string;
    message: string | null;
    startedAt: string;
    finishedAt: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO ddt_processings (
      id, document_id, attempt, strategy, outcome, parser_version,
      message, started_at, finished_at
    ) VALUES (
      @id, @document_id, @attempt, @strategy, @outcome, @parser_version,
      @message, @started_at, @finished_at
    )`,
  ).run({
    id: processing.id,
    document_id: processing.documentId,
    attempt: processing.attempt,
    strategy: processing.strategy,
    outcome: processing.outcome,
    parser_version: processing.parserVersion,
    message: processing.message,
    started_at: processing.startedAt,
    finished_at: processing.finishedAt,
  });
}

export function listDdtProcessings(
  db: Database,
  documentId: string,
): DdtProcessingDto[] {
  const rows = db
    .prepare(
      `SELECT * FROM ddt_processings
       WHERE document_id = ?
       ORDER BY attempt ASC`,
    )
    .all(documentId) as ProcessingRow[];
  return rows.map(mapProcessing);
}

export function nextProcessingAttempt(db: Database, documentId: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(attempt), 0) AS max_attempt
       FROM ddt_processings WHERE document_id = ?`,
    )
    .get(documentId) as { max_attempt: number };
  return Number(row.max_attempt) + 1;
}

export function insertDdtLineStockLink(
  db: Database,
  params: { id: string; lineId: string; stockMovementId: string },
): void {
  db.prepare(
    `INSERT INTO ddt_line_stock_links (id, line_id, stock_movement_id)
     VALUES (@id, @line_id, @stock_movement_id)`,
  ).run({
    id: params.id,
    line_id: params.lineId,
    stock_movement_id: params.stockMovementId,
  });
}

export function getDdtDetail(db: Database, id: string): DdtDetailDto | null {
  const document = findDdtById(db, id);
  if (!document) {
    return null;
  }
  return {
    document,
    lines: listDdtLines(db, id),
    processings: listDdtProcessings(db, id),
  };
}

function buildDdtListWhere(query: DdtListQuery): {
  whereSql: string;
  params: Record<string, unknown>;
} {
  const where: string[] = ["1=1"];
  const params: Record<string, unknown> = {};

  if (query.status !== "all") {
    where.push("status = @status");
    params.status = query.status;
  }
  if (query.documentType !== "all") {
    where.push("document_type = @document_type");
    params.document_type = query.documentType;
  }
  if (query.dateFrom) {
    where.push("document_date >= @date_from");
    params.date_from = query.dateFrom;
  }
  if (query.dateTo) {
    where.push("document_date <= @date_to");
    params.date_to = query.dateTo;
  }
  if (query.search) {
    where.push(
      `(document_number LIKE @search ESCAPE '\\'
        OR counterparty_name LIKE @search ESCAPE '\\'
        OR order_reference LIKE @search ESCAPE '\\'
        OR original_file_name LIKE @search ESCAPE '\\')`,
    );
    params.search = `%${query.search.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
  }

  return { whereSql: where.join(" AND "), params };
}

export function listDdtDocuments(
  db: Database,
  query: DdtListQuery,
): DdtListResult {
  const { whereSql, params } = buildDdtListWhere(query);
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM ddt_documents WHERE ${whereSql}`)
    .get(params) as { c: number };
  const total = Number(totalRow.c) || 0;
  const offset = (query.page - 1) * query.pageSize;
  const rows = db
    .prepare(
      `SELECT * FROM ddt_documents
       WHERE ${whereSql}
       ORDER BY imported_at DESC, created_at DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: query.pageSize, offset }) as DocRow[];

  return {
    items: rows.map(mapDocument),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/** Full filtered set for CSV export (hard cap enforced by caller). */
export function listDdtDocumentsForExport(
  db: Database,
  query: DdtListQuery,
  maxRows: number,
): { items: DdtDocumentDto[]; total: number } {
  const { whereSql, params } = buildDdtListWhere(query);
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM ddt_documents WHERE ${whereSql}`)
    .get(params) as { c: number };
  const total = Number(totalRow.c) || 0;
  const rows = db
    .prepare(
      `SELECT * FROM ddt_documents
       WHERE ${whereSql}
       ORDER BY imported_at DESC, created_at DESC
       LIMIT @limit`,
    )
    .all({ ...params, limit: maxRows }) as DocRow[];
  return { items: rows.map(mapDocument), total };
}

export function getDdtDashboard(db: Database): DdtDashboardDto {
  const count = (status: DdtStatus): number => {
    const row = db
      .prepare(`SELECT COUNT(*) AS c FROM ddt_documents WHERE status = ?`)
      .get(status) as { c: number };
    return Number(row.c) || 0;
  };
  const recentRows = db
    .prepare(
      `SELECT * FROM ddt_documents
       ORDER BY imported_at DESC
       LIMIT 8`,
    )
    .all() as DocRow[];
  return {
    imported: count("imported"),
    reviewRequired: count("review_required"),
    ready: count("ready"),
    registered: count("registered"),
    failed: count("failed"),
    recent: recentRows.map(mapDocument),
  };
}
