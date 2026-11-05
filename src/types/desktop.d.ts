import type { DesktopAPI } from "../../shared/desktop-api.ts";

declare global {
  interface Window {
    desktopAPI?: DesktopAPI;
  }
}

export {};
