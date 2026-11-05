import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { toIpcThrownError } from "../errors/app-error.ts";

/**
 * Registers an invoke handler that converts unexpected/AppError failures into
 * an explicitly serializable IPC Error payload.
 *
 * Supports sync and async handlers. Diagnostic handlers that intentionally
 * return fallback values should keep their local try/catch instead.
 */
export function handleIpc<Args extends unknown[], Result>(
  channel: string,
  handler: (
    event: IpcMainInvokeEvent,
    ...args: Args
  ) => Result | Promise<Result>,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...(args as Args));
    } catch (error) {
      throw toIpcThrownError(error);
    }
  });
}
