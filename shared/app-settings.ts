export const APP_APPEARANCES = ["dark", "light"] as const;
export const APP_ACCENT_COLORS = [
  "teal",
  "slate",
  "amber",
  "indigo",
  "rose",
] as const;

export type AppAppearance = (typeof APP_APPEARANCES)[number];
export type AppAccentColor = (typeof APP_ACCENT_COLORS)[number];

export type AppSettings = {
  appearance: AppAppearance;
  accentColor: AppAccentColor;
  compactMode: boolean;
};

export const APP_SETTINGS_KEYS = [
  "appearance",
  "accentColor",
  "compactMode",
] as const;

export type AppSettingsKey = (typeof APP_SETTINGS_KEYS)[number];

export const DEFAULT_APP_SETTINGS: AppSettings = {
  appearance: "dark",
  accentColor: "teal",
  compactMode: false,
};

const KEY_SET = new Set<string>(APP_SETTINGS_KEYS);

function isAppearance(value: unknown): value is AppAppearance {
  return (
    typeof value === "string" &&
    (APP_APPEARANCES as readonly string[]).includes(value)
  );
}

function isAccentColor(value: unknown): value is AppAccentColor {
  return (
    typeof value === "string" &&
    (APP_ACCENT_COLORS as readonly string[]).includes(value)
  );
}

/**
 * Strict parser for settings payloads.
 * Rejects missing fields, wrong types, and unknown properties.
 */
export function parseAppSettings(input: unknown): AppSettings {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Le impostazioni devono essere un oggetto.");
  }

  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);

  for (const key of keys) {
    if (!KEY_SET.has(key)) {
      throw new Error(`Proprietà non consentita: ${key}`);
    }
  }

  for (const key of APP_SETTINGS_KEYS) {
    if (!(key in record)) {
      throw new Error(`Campo obbligatorio mancante: ${key}`);
    }
  }

  if (!isAppearance(record.appearance)) {
    throw new Error('Valore non valido per "appearance".');
  }
  if (!isAccentColor(record.accentColor)) {
    throw new Error('Valore non valido per "accentColor".');
  }
  if (typeof record.compactMode !== "boolean") {
    throw new Error('Valore non valido per "compactMode".');
  }

  return {
    appearance: record.appearance,
    accentColor: record.accentColor,
    compactMode: record.compactMode,
  };
}

export function serializeAppSettingValue(
  key: AppSettingsKey,
  settings: AppSettings,
): string {
  return JSON.stringify(settings[key]);
}

export function deserializeAppSettingValue(
  key: AppSettingsKey,
  raw: string,
): AppSettings[AppSettingsKey] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Valore impostazione non valido per ${key}.`);
  }

  if (key === "appearance") {
    if (!isAppearance(parsed)) {
      throw new Error('Valore non valido per "appearance".');
    }
    return parsed;
  }
  if (key === "accentColor") {
    if (!isAccentColor(parsed)) {
      throw new Error('Valore non valido per "accentColor".');
    }
    return parsed;
  }
  if (typeof parsed !== "boolean") {
    throw new Error('Valore non valido per "compactMode".');
  }
  return parsed;
}

export function settingsEqual(a: AppSettings, b: AppSettings): boolean {
  return (
    a.appearance === b.appearance &&
    a.accentColor === b.accentColor &&
    a.compactMode === b.compactMode
  );
}
