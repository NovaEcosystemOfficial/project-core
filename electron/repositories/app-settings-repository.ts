import type Database from "better-sqlite3";
import {
  APP_SETTINGS_KEYS,
  DEFAULT_APP_SETTINGS,
  deserializeAppSettingValue,
  serializeAppSettingValue,
  type AppSettings,
  type AppSettingsKey,
} from "../../shared/app-settings.ts";

type SettingRow = {
  key: string;
  value: string;
};

export function readAppSettings(db: Database): AppSettings {
  const rows = db
    .prepare(`SELECT key, value FROM app_settings WHERE key IN (?, ?, ?)`)
    .all(...APP_SETTINGS_KEYS) as SettingRow[];

  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const settings: AppSettings = { ...DEFAULT_APP_SETTINGS };

  for (const key of APP_SETTINGS_KEYS) {
    const raw = byKey.get(key);
    if (raw === undefined) {
      continue;
    }
    const value = deserializeAppSettingValue(key, raw);
    assignSetting(settings, key, value);
  }

  return settings;
}

export function writeAppSettings(db: Database, settings: AppSettings): void {
  const upsert = db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (@key, @value, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
  );

  for (const key of APP_SETTINGS_KEYS) {
    upsert.run({
      key,
      value: serializeAppSettingValue(key, settings),
    });
  }
}

function assignSetting(
  settings: AppSettings,
  key: AppSettingsKey,
  value: AppSettings[AppSettingsKey],
): void {
  if (key === "appearance") {
    settings.appearance = value as AppSettings["appearance"];
    return;
  }
  if (key === "accentColor") {
    settings.accentColor = value as AppSettings["accentColor"];
    return;
  }
  settings.compactMode = value as boolean;
}
