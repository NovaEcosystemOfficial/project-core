import type Database from "better-sqlite3";
import { withTransaction } from "./transactions.ts";

export type Migration = {
  version: number;
  name: string;
  up: (db: Database) => void;
};

/**
 * Versioned schema upgrades.
 * Version 1: migration bookkeeping. Version 2: app settings.
 * Version 3: generic parties (anagrafiche).
 * Version 4: commercial quotes (preventivi) + yearly number sequences.
 * Version 5: articles catalog (magazzino) — single logical warehouse, no stock qty.
 * Version 6: stock_movements — immutable history; stock derived from movements only.
 * Version 7: DDT documents/lines/processings + link to stock movements.
 *
 * Timestamps use SQLite `datetime('now')` → UTC `YYYY-MM-DD HH:MM:SS`.
 * Money on quotes is stored as integer euro cents; quantities as milli-units.
 * Article codes are stored normalized (trim + uppercase); uniqueness is case-insensitive.
 * Stock quantities use the same milli-unit convention (1 unit = 1000).
 */
export const migrations: Migration[] = [
  {
    version: 1,
    name: "foundation_meta",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_meta (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );
      `);

      db.prepare(
        `INSERT INTO schema_meta (key, value) VALUES (@key, @value)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run({
        key: "initialized",
        value: "1",
      });
    },
  },
  {
    version: 2,
    name: "app_settings",
    // Already wrapped by runMigrations in a single transaction — do not nest.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL CHECK (length(value) > 0),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      const insert = db.prepare(
        `INSERT INTO app_settings (key, value)
         VALUES (@key, @value)
         ON CONFLICT(key) DO NOTHING`,
      );

      // Deterministic defaults as JSON literals.
      insert.run({ key: "appearance", value: JSON.stringify("dark") });
      insert.run({ key: "accentColor", value: JSON.stringify("teal") });
      insert.run({ key: "compactMode", value: JSON.stringify(false) });
    },
  },
  {
    version: 3,
    name: "parties",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS parties (
          id TEXT PRIMARY KEY NOT NULL,
          display_name TEXT NOT NULL
            CHECK (length(trim(display_name)) > 0),
          is_customer INTEGER NOT NULL DEFAULT 0
            CHECK (is_customer IN (0, 1)),
          is_supplier INTEGER NOT NULL DEFAULT 0
            CHECK (is_supplier IN (0, 1)),
          email TEXT,
          phone TEXT,
          address TEXT,
          tax_code TEXT,
          vat_number TEXT,
          notes TEXT,
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'archived')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          CHECK (is_customer = 1 OR is_supplier = 1)
        );

        CREATE INDEX IF NOT EXISTS idx_parties_status
          ON parties (status);
        CREATE INDEX IF NOT EXISTS idx_parties_display_name
          ON parties (display_name COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_parties_roles
          ON parties (is_customer, is_supplier);
      `);
    },
  },
  {
    version: 4,
    name: "quotes",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS quote_number_sequences (
          year INTEGER PRIMARY KEY NOT NULL,
          last_value INTEGER NOT NULL CHECK (last_value >= 0)
        );

        CREATE TABLE IF NOT EXISTS quotes (
          id TEXT PRIMARY KEY NOT NULL,
          number TEXT NOT NULL UNIQUE,
          party_id TEXT NOT NULL REFERENCES parties(id),
          customer_name TEXT NOT NULL
            CHECK (length(trim(customer_name)) > 0),
          customer_address TEXT,
          customer_tax_code TEXT,
          customer_vat_number TEXT,
          customer_email TEXT,
          customer_phone TEXT,
          issue_date TEXT NOT NULL
            CHECK (length(issue_date) = 10),
          due_date TEXT
            CHECK (due_date IS NULL OR length(due_date) = 10),
          lifecycle_status TEXT NOT NULL DEFAULT 'draft'
            CHECK (lifecycle_status IN (
              'draft', 'sent', 'accepted', 'rejected', 'expired'
            )),
          archived INTEGER NOT NULL DEFAULT 0
            CHECK (archived IN (0, 1)),
          notes TEXT,
          currency TEXT NOT NULL DEFAULT 'EUR'
            CHECK (currency = 'EUR'),
          taxable_cents INTEGER NOT NULL DEFAULT 0,
          vat_cents INTEGER NOT NULL DEFAULT 0,
          total_cents INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_quotes_party
          ON quotes (party_id);
        CREATE INDEX IF NOT EXISTS idx_quotes_lifecycle
          ON quotes (lifecycle_status);
        CREATE INDEX IF NOT EXISTS idx_quotes_archived
          ON quotes (archived);
        CREATE INDEX IF NOT EXISTS idx_quotes_issue_date
          ON quotes (issue_date);
        CREATE INDEX IF NOT EXISTS idx_quotes_number
          ON quotes (number);

        CREATE TABLE IF NOT EXISTS quote_items (
          id TEXT PRIMARY KEY NOT NULL,
          quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
          position INTEGER NOT NULL CHECK (position >= 1),
          description TEXT NOT NULL
            CHECK (length(trim(description)) > 0),
          quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
          unit TEXT,
          unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
          discount_bps INTEGER NOT NULL DEFAULT 0
            CHECK (discount_bps >= 0 AND discount_bps <= 10000),
          vat_rate_bps INTEGER NOT NULL CHECK (vat_rate_bps >= 0),
          taxable_cents INTEGER NOT NULL,
          vat_cents INTEGER NOT NULL,
          total_cents INTEGER NOT NULL,
          UNIQUE (quote_id, position)
        );

        CREATE INDEX IF NOT EXISTS idx_quote_items_quote
          ON quote_items (quote_id);
      `);
    },
  },
  {
    version: 5,
    name: "articles",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS articles (
          id TEXT PRIMARY KEY NOT NULL,
          code TEXT NOT NULL
            CHECK (length(trim(code)) > 0),
          description TEXT NOT NULL
            CHECK (length(trim(description)) > 0),
          category TEXT,
          unit TEXT NOT NULL
            CHECK (unit IN ('pcs', 'kg', 'g', 'l', 'm', 'm2')),
          min_stock REAL
            CHECK (min_stock IS NULL OR min_stock >= 0),
          notes TEXT,
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'archived')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Case-insensitive uniqueness via normalized stored code (uppercase).
        CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_code_unique
          ON articles (code);
        CREATE INDEX IF NOT EXISTS idx_articles_status
          ON articles (status);
        CREATE INDEX IF NOT EXISTS idx_articles_description
          ON articles (description COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_articles_category
          ON articles (category COLLATE NOCASE);
      `);
    },
  },
  {
    version: 6,
    name: "stock_movements",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS stock_movements (
          id TEXT PRIMARY KEY NOT NULL,
          article_id TEXT NOT NULL REFERENCES articles(id),
          movement_type TEXT NOT NULL
            CHECK (movement_type IN (
              'in', 'out', 'adjustment_in', 'adjustment_out'
            )),
          quantity_milli INTEGER NOT NULL
            CHECK (quantity_milli > 0),
          movement_date TEXT NOT NULL
            CHECK (length(movement_date) = 10),
          reason TEXT,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_stock_movements_article
          ON stock_movements (article_id);
        CREATE INDEX IF NOT EXISTS idx_stock_movements_type
          ON stock_movements (movement_type);
        CREATE INDEX IF NOT EXISTS idx_stock_movements_date
          ON stock_movements (movement_date);
        CREATE INDEX IF NOT EXISTS idx_stock_movements_created
          ON stock_movements (created_at);
      `);
    },
  },
  {
    version: 7,
    name: "ddt_documents",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ddt_documents (
          id TEXT PRIMARY KEY NOT NULL,
          document_type TEXT NOT NULL
            CHECK (document_type IN ('inbound', 'outbound')),
          document_number TEXT,
          document_date TEXT
            CHECK (document_date IS NULL OR length(document_date) = 10),
          counterparty_name TEXT,
          counterparty_party_id TEXT REFERENCES parties(id),
          order_reference TEXT,
          original_relative_path TEXT NOT NULL,
          original_file_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          content_sha256 TEXT NOT NULL,
          byte_size INTEGER NOT NULL CHECK (byte_size > 0),
          page_count INTEGER,
          status TEXT NOT NULL
            CHECK (status IN (
              'imported', 'processing', 'review_required', 'ready',
              'registered', 'failed', 'cancelled'
            )),
          ocr_status TEXT NOT NULL
            CHECK (ocr_status IN (
              'pending', 'native_text', 'ocr', 'manual', 'failed', 'skipped'
            )),
          document_key TEXT,
          notes TEXT,
          last_error TEXT,
          imported_at TEXT NOT NULL DEFAULT (datetime('now')),
          processed_at TEXT,
          registered_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_ddt_documents_sha256
          ON ddt_documents (content_sha256);
        CREATE INDEX IF NOT EXISTS idx_ddt_documents_status
          ON ddt_documents (status);
        CREATE INDEX IF NOT EXISTS idx_ddt_documents_date
          ON ddt_documents (document_date);
        CREATE INDEX IF NOT EXISTS idx_ddt_documents_number
          ON ddt_documents (document_number COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_ddt_documents_key
          ON ddt_documents (document_key);

        CREATE TABLE IF NOT EXISTS ddt_lines (
          id TEXT PRIMARY KEY NOT NULL,
          document_id TEXT NOT NULL REFERENCES ddt_documents(id) ON DELETE CASCADE,
          line_number INTEGER NOT NULL CHECK (line_number > 0),
          original_code TEXT,
          original_description TEXT,
          article_id TEXT REFERENCES articles(id),
          quantity_raw TEXT,
          quantity_milli INTEGER CHECK (quantity_milli IS NULL OR quantity_milli > 0),
          unit_raw TEXT,
          unit_normalized TEXT,
          source TEXT NOT NULL
            CHECK (source IN ('pdf_text', 'ocr', 'manual')),
          confidence REAL,
          warnings_json TEXT NOT NULL DEFAULT '[]',
          validation_status TEXT NOT NULL
            CHECK (validation_status IN ('ok', 'warning', 'error', 'unchecked')),
          page_number INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (document_id, line_number)
        );

        CREATE INDEX IF NOT EXISTS idx_ddt_lines_document
          ON ddt_lines (document_id);
        CREATE INDEX IF NOT EXISTS idx_ddt_lines_article
          ON ddt_lines (article_id);

        CREATE TABLE IF NOT EXISTS ddt_processings (
          id TEXT PRIMARY KEY NOT NULL,
          document_id TEXT NOT NULL REFERENCES ddt_documents(id) ON DELETE CASCADE,
          attempt INTEGER NOT NULL CHECK (attempt > 0),
          strategy TEXT NOT NULL
            CHECK (strategy IN ('native_text', 'ocr', 'manual_parse')),
          outcome TEXT NOT NULL
            CHECK (outcome IN ('success', 'partial', 'failed')),
          parser_version TEXT NOT NULL,
          message TEXT,
          started_at TEXT NOT NULL,
          finished_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_ddt_processings_document
          ON ddt_processings (document_id);

        CREATE TABLE IF NOT EXISTS ddt_line_stock_links (
          id TEXT PRIMARY KEY NOT NULL,
          line_id TEXT NOT NULL UNIQUE REFERENCES ddt_lines(id),
          stock_movement_id TEXT NOT NULL UNIQUE REFERENCES stock_movements(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
];

export function getSchemaVersion(db: Database): number {
  return Number(db.pragma("user_version", { simple: true }) ?? 0);
}

/** Highest schema version this build can open and migrate. */
export function getSupportedSchemaVersion(): number {
  return migrations.reduce(
    (max, migration) => Math.max(max, migration.version),
    0,
  );
}

export function runMigrations(db: Database): number {
  const current = getSchemaVersion(db);
  const pending = migrations
    .filter((migration) => migration.version > current)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    withTransaction(db, (txDb) => {
      migration.up(txDb);
      txDb.pragma(`user_version = ${migration.version}`);
    });
  }

  return getSchemaVersion(db);
}
