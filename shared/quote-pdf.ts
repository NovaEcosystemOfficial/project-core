/** Public PDF export outcomes — never include absolute paths or HTML. */
export type QuotePdfExportResult =
  | { status: "completed"; fileName: string }
  | { status: "cancelled" };
