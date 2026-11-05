import {
  encodeDesktopErrorMessage,
  type DesktopErrorCode,
  type DesktopErrorPayload,
} from "../../shared/errors.ts";

/**
 * Domain/application error for the main process.
 * Convert to a public IPC payload before crossing into the renderer.
 */
export class AppError extends Error {
  readonly code: DesktopErrorCode;
  readonly publicMessage: string;

  constructor(code: DesktopErrorCode, publicMessage: string, options?: { cause?: unknown }) {
    super(publicMessage, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.publicMessage = publicMessage;
  }

  toPublicPayload(): DesktopErrorPayload {
    return {
      code: this.code,
      message: this.publicMessage,
    };
  }

  static validation(message: string, cause?: unknown): AppError {
    return new AppError("VALIDATION_FAILED", message, cause !== undefined ? { cause } : undefined);
  }

  static notFound(message: string, cause?: unknown): AppError {
    return new AppError("NOT_FOUND", message, cause !== undefined ? { cause } : undefined);
  }

  static conflict(message: string, cause?: unknown): AppError {
    return new AppError("CONFLICT", message, cause !== undefined ? { cause } : undefined);
  }

  static internal(message = "Si è verificato un errore interno.", cause?: unknown): AppError {
    return new AppError("INTERNAL_ERROR", message, cause !== undefined ? { cause } : undefined);
  }
}

export function logMainError(scope: string, error: unknown): void {
  if (error instanceof Error) {
    console.error(`[${scope}]`, error.stack ?? error.message);
    return;
  }
  console.error(`[${scope}]`, error);
}

/**
 * Builds an Error whose `message` carries an explicit public payload.
 * Custom fields on Error are not reliable across Electron IPC serialization.
 */
export function toIpcThrownError(error: unknown): Error {
  if (error instanceof AppError) {
    return new Error(encodeDesktopErrorMessage(error.toPublicPayload()));
  }

  logMainError("ipc", error);
  return new Error(
    encodeDesktopErrorMessage({
      code: "INTERNAL_ERROR",
      message: "Si è verificato un errore interno. Riprova oppure consulta la diagnostica.",
    }),
  );
}
