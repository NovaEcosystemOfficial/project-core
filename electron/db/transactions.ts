import type Database from "better-sqlite3";

/**
 * Run `work` inside a better-sqlite3 transaction (synchronous).
 *
 * Use a transaction when multiple writes must succeed or fail together
 * (for example: insert parent + children, migrate meta + bump user_version).
 * Prefer plain statements for a single read or a single independent write.
 *
 * better-sqlite3 transactions are synchronous: do not await promises inside `work`.
 * On success the transaction commits; on throw it rolls back and rethrows.
 */
export function withTransaction<T>(
  db: Database,
  work: (db: Database) => T,
): T {
  const run = db.transaction(() => work(db));
  return run();
}
