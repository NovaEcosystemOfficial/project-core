import type { AppSettings } from "../../shared/app-settings.ts";

/** Applies persisted/draft preferences to the document root via data attributes. */
export function applyAppSettingsToDocument(settings: AppSettings): void {
  const root = document.documentElement;
  root.dataset.theme = settings.appearance;
  root.dataset.accent = settings.accentColor;
  root.dataset.compact = settings.compactMode ? "true" : "false";
  root.style.colorScheme = settings.appearance;
}
