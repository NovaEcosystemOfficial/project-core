declare module "better-sqlite3" {
  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  interface Statement {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): RunResult;
  }

  interface BackupMetadata {
    totalPages: number;
    remainingPages: number;
  }

  class Database {
    constructor(
      filename: string,
      options?: {
        readonly?: boolean;
        fileMustExist?: boolean;
        timeout?: number;
      },
    );
    prepare(source: string): Statement;
    exec(source: string): this;
    pragma(source: string, options?: { simple?: boolean }): unknown;
    transaction<T>(fn: () => T): () => T;
    backup(
      filename: string,
      options?: {
        progress?: (progress: BackupMetadata) => number | undefined;
        attached?: string;
      },
    ): Promise<BackupMetadata>;
    close(): void;
    readonly open: boolean;
    readonly name: string;
  }

  export default Database;
}
