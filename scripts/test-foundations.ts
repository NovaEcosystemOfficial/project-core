import { createRequire } from "node:module";
import type Database from "better-sqlite3";
import { withTransaction } from "../electron/db/transactions.ts";
import { AppError, toIpcThrownError } from "../electron/errors/app-error.ts";
import {
  encodeDesktopErrorMessage,
  tryParseDesktopErrorPayload,
} from "../shared/errors.ts";

const require = createRequire(import.meta.url);
type BetterSqlite3Constructor = new (filename: string) => Database;
const BetterSqlite3 = require("better-sqlite3") as BetterSqlite3Constructor;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function testTransactionRollback(): void {
  const db = new BetterSqlite3(":memory:");
  db.exec(`
    CREATE TABLE demo (
      id INTEGER PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  db.prepare(`INSERT INTO demo (id, value) VALUES (1, 'keep')`).run();

  let threw = false;
  try {
    withTransaction(db, (tx) => {
      tx.prepare(`INSERT INTO demo (id, value) VALUES (2, 'temp')`).run();
      const count = (
        tx.prepare(`SELECT COUNT(*) AS c FROM demo`).get() as { c: number }
      ).c;
      assert(count === 2, "expected two rows inside transaction before failure");
      throw new Error("forced-failure");
    });
  } catch (error) {
    threw = true;
    assert(
      error instanceof Error && error.message === "forced-failure",
      "transaction should rethrow the original error",
    );
  }

  assert(threw, "transaction should fail");
  const remaining = (
    db.prepare(`SELECT COUNT(*) AS c FROM demo`).get() as { c: number }
  ).c;
  assert(remaining === 1, "failed transaction must roll back inserts");
  db.close();
  console.log("OK  transaction rollback");
}

function testTransactionCommit(): void {
  const db = new BetterSqlite3(":memory:");
  db.exec(`CREATE TABLE demo (id INTEGER PRIMARY KEY, value TEXT NOT NULL);`);

  withTransaction(db, (tx) => {
    tx.prepare(`INSERT INTO demo (id, value) VALUES (1, 'a')`).run();
    tx.prepare(`INSERT INTO demo (id, value) VALUES (2, 'b')`).run();
  });

  const remaining = (
    db.prepare(`SELECT COUNT(*) AS c FROM demo`).get() as { c: number }
  ).c;
  assert(remaining === 2, "successful transaction must commit");
  db.close();
  console.log("OK  transaction commit");
}

function testErrorEncoding(): void {
  const payload = AppError.validation("Campo non valido.").toPublicPayload();
  const encoded = encodeDesktopErrorMessage(payload);
  const parsed = tryParseDesktopErrorPayload(encoded);
  assert(parsed?.code === "VALIDATION_FAILED", "code must round-trip");
  assert(parsed?.message === "Campo non valido.", "message must round-trip");

  const ipcError = toIpcThrownError(AppError.notFound("Elemento assente."));
  const fromIpc = tryParseDesktopErrorPayload(ipcError.message);
  assert(fromIpc?.code === "NOT_FOUND", "IPC thrown error must encode NOT_FOUND");
  assert(!ipcError.message.includes("SELECT"), "public message must not include SQL");
  assert(!ipcError.message.includes("C:\\"), "public message must not include paths");

  const wrapped = `Error invoking remote method 'desktop:registerDdt': Error: ${ipcError.message}`;
  const fromWrapped = tryParseDesktopErrorPayload(wrapped);
  assert(
    fromWrapped?.code === "NOT_FOUND",
    "Electron-wrapped IPC errors must still parse",
  );
  assert(
    fromWrapped?.message === "Elemento assente.",
    "wrapped payload keeps public message",
  );

  const originalError = console.error;
  console.error = () => undefined;
  const internal = toIpcThrownError(
    new Error("SQLITE_ERROR: no such table secretly_at C:\\secret\\db.sqlite"),
  );
  console.error = originalError;
  const internalPayload = tryParseDesktopErrorPayload(internal.message);
  assert(internalPayload?.code === "INTERNAL_ERROR", "unknown errors become INTERNAL_ERROR");
  assert(
    !internal.message.includes("SQLITE_ERROR"),
    "internal IPC payload must not leak SQL dialect text",
  );
  assert(
    !internal.message.includes("secret"),
    "internal IPC payload must not leak local paths",
  );
  console.log("OK  error encoding / sanitization");
}

testTransactionCommit();
testTransactionRollback();
testErrorEncoding();
console.log("All foundation tests passed.");
