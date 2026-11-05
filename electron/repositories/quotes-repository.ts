import type Database from "better-sqlite3";
import {
  centsToEuroString,
  mapComputedItemToDto,
  type ComputedQuoteDocument,
  type QuoteCustomerSnapshot,
  type QuoteDto,
  type QuoteLifecycleStatus,
  type QuoteListItemDto,
  type QuoteListQuery,
  type QuoteListResult,
} from "../../shared/quotes.ts";
import {
  isAllowedVatRateBps,
  type QuoteVatRateBps,
} from "../../shared/quotes-money.ts";

type QuoteRow = {
  id: string;
  number: string;
  party_id: string;
  customer_name: string;
  customer_address: string | null;
  customer_tax_code: string | null;
  customer_vat_number: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  issue_date: string;
  due_date: string | null;
  lifecycle_status: string;
  archived: number;
  notes: string | null;
  currency: string;
  taxable_cents: number;
  vat_cents: number;
  total_cents: number;
  created_at: string;
  updated_at: string;
};

type QuoteItemRow = {
  id: string;
  quote_id: string;
  position: number;
  description: string;
  quantity_milli: number;
  unit: string | null;
  unit_price_cents: number;
  discount_bps: number;
  vat_rate_bps: number;
  taxable_cents: number;
  vat_cents: number;
  total_cents: number;
};

function escapeLikePattern(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

function asLifecycle(value: string): QuoteLifecycleStatus {
  switch (value) {
    case "sent":
    case "accepted":
    case "rejected":
    case "expired":
    case "draft":
      return value;
    default:
      return "draft";
  }
}

function mapItemRow(row: QuoteItemRow) {
  const vatRateBps = isAllowedVatRateBps(row.vat_rate_bps)
    ? row.vat_rate_bps
    : (0 as QuoteVatRateBps);
  return mapComputedItemToDto({
    id: row.id,
    position: row.position,
    description: row.description,
    quantityMilli: row.quantity_milli,
    unit: row.unit,
    unitPriceCents: row.unit_price_cents,
    discountBps: row.discount_bps,
    vatRateBps,
    taxableCents: row.taxable_cents,
    vatCents: row.vat_cents,
    totalCents: row.total_cents,
  });
}

function mapQuoteRow(row: QuoteRow, items: QuoteItemRow[]): QuoteDto {
  return {
    id: row.id,
    number: row.number,
    partyId: row.party_id,
    customer: {
      name: row.customer_name,
      address: row.customer_address,
      taxCode: row.customer_tax_code,
      vatNumber: row.customer_vat_number,
      email: row.customer_email,
      phone: row.customer_phone,
    },
    issueDate: row.issue_date,
    dueDate: row.due_date,
    lifecycleStatus: asLifecycle(row.lifecycle_status),
    archived: row.archived === 1,
    notes: row.notes,
    currency: "EUR",
    taxableCents: row.taxable_cents,
    vatCents: row.vat_cents,
    totalCents: row.total_cents,
    taxable: centsToEuroString(row.taxable_cents),
    vat: centsToEuroString(row.vat_cents),
    total: centsToEuroString(row.total_cents),
    items: items
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(mapItemRow),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapListRow(row: QuoteRow): QuoteListItemDto {
  return {
    id: row.id,
    number: row.number,
    partyId: row.party_id,
    customerName: row.customer_name,
    issueDate: row.issue_date,
    lifecycleStatus: asLifecycle(row.lifecycle_status),
    archived: row.archived === 1,
    totalCents: row.total_cents,
    total: centsToEuroString(row.total_cents),
    updatedAt: row.updated_at,
  };
}

/**
 * Allocate next commercial quote number for the given UTC year.
 * Must run inside a transaction. Format: PREV-YYYY-####
 */
export function allocateQuoteNumber(db: Database, year: number): string {
  db.prepare(
    `INSERT INTO quote_number_sequences (year, last_value)
     VALUES (@year, 1)
     ON CONFLICT(year) DO UPDATE SET last_value = last_value + 1`,
  ).run({ year });

  const row = db
    .prepare(
      `SELECT last_value AS value FROM quote_number_sequences WHERE year = ?`,
    )
    .get(year) as { value: number };
  const seq = String(row.value).padStart(4, "0");
  return `PREV-${year}-${seq}`;
}

export function findQuoteById(db: Database, id: string): QuoteDto | null {
  const row = db.prepare(`SELECT * FROM quotes WHERE id = ?`).get(id) as
    | QuoteRow
    | undefined;
  if (!row) {
    return null;
  }
  const items = db
    .prepare(
      `SELECT * FROM quote_items WHERE quote_id = ? ORDER BY position ASC`,
    )
    .all(id) as QuoteItemRow[];
  return mapQuoteRow(row, items);
}

export function insertQuote(
  db: Database,
  params: {
    id: string;
    number: string;
    partyId: string;
    customer: QuoteCustomerSnapshot;
    issueDate: string;
    dueDate: string | null;
    notes: string | null;
    computed: ComputedQuoteDocument;
    itemIds: string[];
  },
): QuoteDto {
  db.prepare(
    `INSERT INTO quotes (
      id, number, party_id,
      customer_name, customer_address, customer_tax_code,
      customer_vat_number, customer_email, customer_phone,
      issue_date, due_date, lifecycle_status, archived, notes, currency,
      taxable_cents, vat_cents, total_cents,
      created_at, updated_at
    ) VALUES (
      @id, @number, @party_id,
      @customer_name, @customer_address, @customer_tax_code,
      @customer_vat_number, @customer_email, @customer_phone,
      @issue_date, @due_date, 'draft', 0, @notes, 'EUR',
      @taxable_cents, @vat_cents, @total_cents,
      datetime('now'), datetime('now')
    )`,
  ).run({
    id: params.id,
    number: params.number,
    party_id: params.partyId,
    customer_name: params.customer.name,
    customer_address: params.customer.address,
    customer_tax_code: params.customer.taxCode,
    customer_vat_number: params.customer.vatNumber,
    customer_email: params.customer.email,
    customer_phone: params.customer.phone,
    issue_date: params.issueDate,
    due_date: params.dueDate,
    notes: params.notes,
    taxable_cents: params.computed.taxableCents,
    vat_cents: params.computed.vatCents,
    total_cents: params.computed.totalCents,
  });

  insertItems(db, params.id, params.computed, params.itemIds);
  const created = findQuoteById(db, params.id);
  if (!created) {
    throw new Error("Insert quote failed to re-read.");
  }
  return created;
}

function insertItems(
  db: Database,
  quoteId: string,
  computed: ComputedQuoteDocument,
  itemIds: string[],
): void {
  const insert = db.prepare(
    `INSERT INTO quote_items (
      id, quote_id, position, description, quantity_milli, unit,
      unit_price_cents, discount_bps, vat_rate_bps,
      taxable_cents, vat_cents, total_cents
    ) VALUES (
      @id, @quote_id, @position, @description, @quantity_milli, @unit,
      @unit_price_cents, @discount_bps, @vat_rate_bps,
      @taxable_cents, @vat_cents, @total_cents
    )`,
  );

  computed.items.forEach((item, index) => {
    insert.run({
      id: itemIds[index],
      quote_id: quoteId,
      position: item.position,
      description: item.description,
      quantity_milli: item.quantityMilli,
      unit: item.unit,
      unit_price_cents: item.unitPriceCents,
      discount_bps: item.discountBps,
      vat_rate_bps: item.vatRateBps,
      taxable_cents: item.taxableCents,
      vat_cents: item.vatCents,
      total_cents: item.totalCents,
    });
  });
}

export function replaceQuoteDraft(
  db: Database,
  params: {
    id: string;
    partyId: string;
    customer: QuoteCustomerSnapshot;
    issueDate: string;
    dueDate: string | null;
    notes: string | null;
    computed: ComputedQuoteDocument;
    itemIds: string[];
  },
): QuoteDto | null {
  const result = db
    .prepare(
      `UPDATE quotes SET
        party_id = @party_id,
        customer_name = @customer_name,
        customer_address = @customer_address,
        customer_tax_code = @customer_tax_code,
        customer_vat_number = @customer_vat_number,
        customer_email = @customer_email,
        customer_phone = @customer_phone,
        issue_date = @issue_date,
        due_date = @due_date,
        notes = @notes,
        taxable_cents = @taxable_cents,
        vat_cents = @vat_cents,
        total_cents = @total_cents,
        updated_at = datetime('now')
      WHERE id = @id
        AND lifecycle_status = 'draft'
        AND archived = 0`,
    )
    .run({
      id: params.id,
      party_id: params.partyId,
      customer_name: params.customer.name,
      customer_address: params.customer.address,
      customer_tax_code: params.customer.taxCode,
      customer_vat_number: params.customer.vatNumber,
      customer_email: params.customer.email,
      customer_phone: params.customer.phone,
      issue_date: params.issueDate,
      due_date: params.dueDate,
      notes: params.notes,
      taxable_cents: params.computed.taxableCents,
      vat_cents: params.computed.vatCents,
      total_cents: params.computed.totalCents,
    });

  if (result.changes === 0) {
    return null;
  }

  db.prepare(`DELETE FROM quote_items WHERE quote_id = ?`).run(params.id);
  insertItems(db, params.id, params.computed, params.itemIds);
  return findQuoteById(db, params.id);
}

export function setQuoteLifecycleStatus(
  db: Database,
  id: string,
  lifecycleStatus: QuoteLifecycleStatus,
): QuoteDto | null {
  const result = db
    .prepare(
      `UPDATE quotes SET
        lifecycle_status = @lifecycle_status,
        updated_at = datetime('now')
      WHERE id = @id AND archived = 0`,
    )
    .run({ id, lifecycle_status: lifecycleStatus });
  if (result.changes === 0) {
    return null;
  }
  return findQuoteById(db, id);
}

export function setQuoteArchived(
  db: Database,
  id: string,
  archived: boolean,
): QuoteDto | null {
  const result = db
    .prepare(
      `UPDATE quotes SET
        archived = @archived,
        updated_at = datetime('now')
      WHERE id = @id`,
    )
    .run({ id, archived: archived ? 1 : 0 });
  if (result.changes === 0) {
    return null;
  }
  return findQuoteById(db, id);
}

export function listQuotes(
  db: Database,
  query: QuoteListQuery,
): QuoteListResult {
  const where: string[] = [];
  const params: Record<string, string | number> = {};

  if (query.archive === "active") {
    where.push("archived = 0");
  } else if (query.archive === "archived") {
    where.push("archived = 1");
  }

  if (query.lifecycleStatus !== "all") {
    where.push("lifecycle_status = @lifecycle_status");
    params.lifecycle_status = query.lifecycleStatus;
  }

  if (query.search.length > 0) {
    where.push(`(
      number LIKE @pattern ESCAPE '\\' COLLATE NOCASE
      OR customer_name LIKE @pattern ESCAPE '\\' COLLATE NOCASE
    )`);
    params.pattern = `%${escapeLikePattern(query.search)}%`;
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM quotes ${whereSql}`)
    .get(params) as { c: number };
  const total = Number(totalRow.c) || 0;

  const rows = db
    .prepare(
      `SELECT * FROM quotes
       ${whereSql}
       ORDER BY issue_date DESC, number DESC, id ASC
       LIMIT @limit OFFSET @offset`,
    )
    .all({
      ...params,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    }) as QuoteRow[];

  return {
    items: rows.map(mapListRow),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}
