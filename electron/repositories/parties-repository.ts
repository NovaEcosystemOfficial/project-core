import type Database from "better-sqlite3";
import type { PartyExportFilter } from "../../shared/parties-csv-export.ts";
import type {
  PartyDto,
  PartyListQuery,
  PartyListResult,
  PartyListStatusFilter,
  PartyStatus,
  PartyWriteFields,
} from "../../shared/parties.ts";

type PartyRow = {
  id: string;
  display_name: string;
  is_customer: number;
  is_supplier: number;
  email: string | null;
  phone: string | null;
  address: string | null;
  tax_code: string | null;
  vat_number: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

const PARTY_SELECT = `
  SELECT
    id,
    display_name,
    is_customer,
    is_supplier,
    email,
    phone,
    address,
    tax_code,
    vat_number,
    notes,
    status,
    created_at,
    updated_at
  FROM parties
`;

function escapeLikePattern(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

function mapRow(row: PartyRow): PartyDto {
  const status: PartyStatus =
    row.status === "archived" ? "archived" : "active";
  return {
    id: row.id,
    displayName: row.display_name,
    isCustomer: row.is_customer === 1,
    isSupplier: row.is_supplier === 1,
    email: row.email,
    phone: row.phone,
    address: row.address,
    taxCode: row.tax_code,
    vatNumber: row.vat_number,
    notes: row.notes,
    status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function findPartyById(db: Database, id: string): PartyDto | null {
  const row = db.prepare(`${PARTY_SELECT} WHERE id = ?`).get(id) as
    | PartyRow
    | undefined;
  return row ? mapRow(row) : null;
}

export function insertParty(
  db: Database,
  id: string,
  fields: PartyWriteFields,
): PartyDto {
  db.prepare(
    `INSERT INTO parties (
      id,
      display_name,
      is_customer,
      is_supplier,
      email,
      phone,
      address,
      tax_code,
      vat_number,
      notes,
      status,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @display_name,
      @is_customer,
      @is_supplier,
      @email,
      @phone,
      @address,
      @tax_code,
      @vat_number,
      @notes,
      'active',
      datetime('now'),
      datetime('now')
    )`,
  ).run({
    id,
    display_name: fields.displayName,
    is_customer: fields.isCustomer ? 1 : 0,
    is_supplier: fields.isSupplier ? 1 : 0,
    email: fields.email,
    phone: fields.phone,
    address: fields.address,
    tax_code: fields.taxCode,
    vat_number: fields.vatNumber,
    notes: fields.notes,
  });

  const created = findPartyById(db, id);
  if (!created) {
    throw new Error("Insert party failed to re-read.");
  }
  return created;
}

export function updatePartyFields(
  db: Database,
  id: string,
  fields: PartyWriteFields,
): PartyDto | null {
  const result = db
    .prepare(
      `UPDATE parties SET
        display_name = @display_name,
        is_customer = @is_customer,
        is_supplier = @is_supplier,
        email = @email,
        phone = @phone,
        address = @address,
        tax_code = @tax_code,
        vat_number = @vat_number,
        notes = @notes,
        updated_at = datetime('now')
      WHERE id = @id`,
    )
    .run({
      id,
      display_name: fields.displayName,
      is_customer: fields.isCustomer ? 1 : 0,
      is_supplier: fields.isSupplier ? 1 : 0,
      email: fields.email,
      phone: fields.phone,
      address: fields.address,
      tax_code: fields.taxCode,
      vat_number: fields.vatNumber,
      notes: fields.notes,
    });

  if (result.changes === 0) {
    return null;
  }
  return findPartyById(db, id);
}

export function setPartyStatus(
  db: Database,
  id: string,
  status: PartyStatus,
): PartyDto | null {
  const result = db
    .prepare(
      `UPDATE parties SET
        status = @status,
        updated_at = datetime('now')
      WHERE id = @id`,
    )
    .run({ id, status });

  if (result.changes === 0) {
    return null;
  }
  return findPartyById(db, id);
}

type PartyFilterClause = {
  whereSql: string;
  params: Record<string, string | number>;
};

/**
 * Shared filter semantics for list and export (search + status).
 * Ordering is deterministic: display_name COLLATE NOCASE, then id.
 */
function buildPartyFilterClause(filter: {
  search: string;
  status: PartyListStatusFilter;
}): PartyFilterClause {
  const where: string[] = [];
  const params: Record<string, string | number> = {};

  if (filter.status !== "all") {
    where.push("status = @status");
    params.status = filter.status;
  }

  if (filter.search.length > 0) {
    where.push(`(
      display_name LIKE @pattern ESCAPE '\\' COLLATE NOCASE
      OR IFNULL(email, '') LIKE @pattern ESCAPE '\\' COLLATE NOCASE
      OR IFNULL(phone, '') LIKE @pattern ESCAPE '\\' COLLATE NOCASE
      OR IFNULL(tax_code, '') LIKE @pattern ESCAPE '\\' COLLATE NOCASE
      OR IFNULL(vat_number, '') LIKE @pattern ESCAPE '\\' COLLATE NOCASE
    )`);
    params.pattern = `%${escapeLikePattern(filter.search)}%`;
  }

  return {
    whereSql: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

/** Server-side search + pagination. */
export function listParties(
  db: Database,
  query: PartyListQuery,
): PartyListResult {
  const { whereSql, params } = buildPartyFilterClause(query);
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM parties ${whereSql}`)
    .get(params) as { c: number };
  const total = Number(totalRow.c) || 0;

  const pageParams: Record<string, string | number> = {
    ...params,
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  };

  const rows = db
    .prepare(
      `${PARTY_SELECT}
       ${whereSql}
       ORDER BY display_name COLLATE NOCASE ASC, id ASC
       LIMIT @limit OFFSET @offset`,
    )
    .all(pageParams) as PartyRow[];

  return {
    items: rows.map(mapRow),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export type PartyExportQueryResult = {
  items: PartyDto[];
  total: number;
};

/**
 * All rows matching export filters (no UI page window).
 * Applies `maxRows` as a hard SELECT cap; caller must compare with `total`.
 */
export function listPartiesForExport(
  db: Database,
  filter: PartyExportFilter,
  maxRows: number,
): PartyExportQueryResult {
  const { whereSql, params } = buildPartyFilterClause(filter);
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM parties ${whereSql}`)
    .get(params) as { c: number };
  const total = Number(totalRow.c) || 0;

  const rows = db
    .prepare(
      `${PARTY_SELECT}
       ${whereSql}
       ORDER BY display_name COLLATE NOCASE ASC, id ASC
       LIMIT @limit`,
    )
    .all({ ...params, limit: maxRows }) as PartyRow[];

  return {
    items: rows.map(mapRow),
    total,
  };
}
