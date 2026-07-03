/**
 * Per-user settings (US-7). `language: 'auto'` means "follow the user":
 * UI strings use the Telegram client hint, Q&A answers follow the question's
 * language (AC-4.4) — an explicit choice in /settings overrides both.
 */
import { isCategory, isLang } from '../domain/event.ts';
import type { Category, Lang } from '../domain/event.ts';
import type { KvLike } from './store.ts';
import { tomorrowWindow, weekendWindow } from './windows.ts';
import type { DateWindow } from './windows.ts';
import { weekdayOf } from './clock.ts';
import { asArray, asNumber, parseJson, readProp } from '../util/json.ts';

/** UI/answer language — the shared domain `Lang` (en/it/ru). */
export type Language = Lang;
export type LanguageChoice = Language | 'auto';
export type DigestMode = 'off' | 'daily' | 'weekly';

export type Settings = Readonly<{
  language: LanguageChoice;
  digest: DigestMode;
  digestHour: number;
  categories: readonly Category[];
}>;

export const DEFAULT_SETTINGS: Settings = {
  language: 'auto',
  digest: 'off',
  digestHour: 9,
  categories: [],
};

const settingsKey = (userId: number): string => `user:${userId}:settings`;

const isLanguageChoice = (value: unknown): value is LanguageChoice =>
  isLang(value) || value === 'auto';

const isDigestMode = (value: unknown): value is DigestMode =>
  value === 'off' || value === 'daily' || value === 'weekly';

export const parseSettings = (text: string): Settings => {
  const value = parseJson(text);
  const language = readProp(value, 'language');
  const digest = readProp(value, 'digest');
  const digestHour = asNumber(readProp(value, 'digestHour'));
  const categories = (asArray(readProp(value, 'categories')) ?? []).filter(isCategory);
  return {
    language: isLanguageChoice(language) ? language : DEFAULT_SETTINGS.language,
    digest: isDigestMode(digest) ? digest : DEFAULT_SETTINGS.digest,
    digestHour:
      digestHour !== undefined && Number.isInteger(digestHour) && digestHour >= 0 && digestHour <= 23
        ? digestHour
        : DEFAULT_SETTINGS.digestHour,
    categories,
  };
};

export const readSettings = async (kv: KvLike, userId: number): Promise<Settings> => {
  const raw = await kv.get(settingsKey(userId));
  return raw === null ? DEFAULT_SETTINGS : parseSettings(raw);
};

export const writeSettings = async (
  kv: KvLike,
  userId: number,
  settings: Settings,
): Promise<void> => kv.put(settingsKey(userId), JSON.stringify(settings));

export const toggleCategory = (settings: Settings, category: Category): Settings => ({
  ...settings,
  categories: settings.categories.includes(category)
    ? settings.categories.filter((existing) => existing !== category)
    : [...settings.categories, category],
});

/** UI language: explicit choice wins, else the Telegram client hint (AC-4.4). */
export const uiLanguage = (settings: Settings, hint: Language): Language =>
  settings.language === 'auto' ? hint : settings.language;

const FRIDAY = 5;

/**
 * The digest window due right now, or undefined (AC-5.1). Daily → tomorrow;
 * weekly → the coming weekend, pushed on Fridays.
 */
export const digestDueWindow = (
  settings: Settings,
  today: string,
  hour: number,
): DateWindow | undefined => {
  if (settings.digest === 'off' || hour !== settings.digestHour) return undefined;
  if (settings.digest === 'daily') return tomorrowWindow(today);
  return weekdayOf(today) === FRIDAY ? weekendWindow(today) : undefined;
};
