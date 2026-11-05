/** Public backup/restore outcomes — never include filesystem paths. */
export type DatabaseBackupResult =
  | { status: "completed"; fileName: string }
  | { status: "cancelled" };

export type DatabaseRestoreResult =
  | { status: "completed"; schemaVersion: number }
  | { status: "cancelled" };
