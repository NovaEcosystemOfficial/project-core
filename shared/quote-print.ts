/** Public print outcome — never includes paths or document HTML. */
export type QuotePrintResult =
  | { status: "completed" }
  | { status: "cancelled" };
