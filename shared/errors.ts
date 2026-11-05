/**
 * Stable public error codes for desktop IPC.
 * Keep messages free of SQL, paths, and stack traces.
 */
export const DESKTOP_ERROR_CODES = [
  "VALIDATION_FAILED",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL_ERROR",
] as const;

export type DesktopErrorCode = (typeof DESKTOP_ERROR_CODES)[number];

/** Payload safe to show in the renderer. */
export type DesktopErrorPayload = {
  code: DesktopErrorCode;
  message: string;
};

/**
 * Electron IPC Error serialization typically preserves `message` reliably,
 * not custom enumerable fields. We therefore encode the public payload inside
 * `Error.message` with an explicit marker the renderer can parse.
 */
export const DESKTOP_ERROR_MARKER = "PC_ERR:";

export function isDesktopErrorCode(value: unknown): value is DesktopErrorCode {
  return (
    typeof value === "string" &&
    (DESKTOP_ERROR_CODES as readonly string[]).includes(value)
  );
}

export function encodeDesktopErrorMessage(payload: DesktopErrorPayload): string {
  return `${DESKTOP_ERROR_MARKER}${JSON.stringify({
    code: payload.code,
    message: payload.message,
  })}`;
}

export function tryParseDesktopErrorPayload(
  message: string,
): DesktopErrorPayload | null {
  // Electron often wraps IPC errors as:
  // `Error invoking remote method '…': Error: PC_ERR:{…}`
  const markerIndex = message.indexOf(DESKTOP_ERROR_MARKER);
  if (markerIndex < 0) {
    return null;
  }

  try {
    const encoded = message.slice(markerIndex + DESKTOP_ERROR_MARKER.length);
    const parsed: unknown = JSON.parse(encoded);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("code" in parsed) ||
      !("message" in parsed) ||
      !isDesktopErrorCode(parsed.code) ||
      typeof parsed.message !== "string"
    ) {
      return null;
    }

    return {
      code: parsed.code,
      message: parsed.message,
    };
  } catch {
    return null;
  }
}
