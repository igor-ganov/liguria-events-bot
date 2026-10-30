/**
 * The model proposes holidays; this decides which of them reach the site.
 * Everything a proposal carries is checked here — the name, the window, the
 * policy and the colours — so a wrong answer costs a holiday, never the page.
 */
import { addDays } from '../pipeline/clock.ts';
import { asArray, asNonEmptyString, readProp } from '../util/json.ts';
import { DARK_BACKGROUND, LIGHT_BACKGROUND, normalHex, readableOn } from './contrast.ts';
import { deniedReason } from './deny-list.ts';
import { HORIZON_DAYS, MAX_WINDOW_DAYS, isMotif } from './holiday.ts';
import type { Holiday, Motif, Palette, Rejection, Theme } from './holiday.ts';
import type { LocalizedText } from '../domain/event.ts';

/** Readable fallbacks, one per motif: ≥ 4.5:1 on #ffffff and on #121212. */
export const DEFAULT_PALETTES: Readonly<Record<Motif, Palette>> = {
  pumpkin: { accent: '#b34700', accentDark: '#ff9a3c' },
  bat: { accent: '#5b2a86', accentDark: '#c39bea' },
  leaf: { accent: '#8a4b08', accentDark: '#e8a85a' },
  star: { accent: '#1f4e9c', accentDark: '#8fb8ff' },
  snowflake: { accent: '#1d5f8a', accentDark: '#9fd3f5' },
  heart: { accent: '#b0123b', accentDark: '#ff8fab' },
  confetti: { accent: '#a1176b', accentDark: '#f59ad1' },
  flower: { accent: '#8e2d7a', accentDark: '#f0a6e0' },
  sun: { accent: '#8a5200', accentDark: '#ffc94d' },
  none: { accent: '#1f5f8b', accentDark: '#8cc6f0' },
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isIsoDate = (value: string | undefined): value is string =>
  value !== undefined &&
  ISO_DATE.test(value) &&
  new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

const nameOf = (raw: unknown): LocalizedText | undefined => {
  const text = (lang: string): string | undefined => asNonEmptyString(readProp(raw, lang))?.trim() || undefined;
  const en = text('en');
  return en === undefined ? undefined : { en, it: text('it') ?? en, ru: text('ru') ?? en };
};

const slug = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-?\d{4}$/, '');

/** A stable id: the slug of what the model called it, plus the year. */
const idOf = (rawId: string | undefined, name: LocalizedText, themeFrom: string): string =>
  `${slug(rawId ?? '') || slug(name.en) || 'holiday'}-${themeFrom.slice(0, 4)}`;

const colour = (raw: unknown, readable: (value: string) => boolean, fallback: string): string => {
  const hex = normalHex(asNonEmptyString(raw) ?? '');
  return hex !== undefined && readable(hex) ? hex : fallback;
};

const themeOf = (raw: unknown): Theme => {
  const motifRaw = readProp(raw, 'motif');
  const motif: Motif = isMotif(motifRaw) ? motifRaw : 'none';
  const palette = DEFAULT_PALETTES[motif];
  return {
    accent: colour(readProp(raw, 'accent'), readableOn(LIGHT_BACKGROUND), palette.accent),
    accentDark: colour(readProp(raw, 'accentDark'), readableOn(DARK_BACKGROUND), palette.accentDark),
    motif,
  };
};

/** Why a window is unusable for today, or undefined when it is fine. */
const windowProblem = (from: string | undefined, to: string | undefined, today: string): string | undefined => {
  if (!isIsoDate(from) || !isIsoDate(to)) return 'malformed window';
  if (to < from) return 'window ends before it starts';
  if (daysBetween(from, to) > MAX_WINDOW_DAYS) return `window longer than ${MAX_WINDOW_DAYS} days`;
  if (to < today || from > addDays(today, HORIZON_DAYS)) return 'window not near today';
  return undefined;
};

type Verdict = Readonly<{ holiday: Holiday }> | Readonly<{ rejection: Rejection }>;

const reject = (name: string, reason: string): Verdict => ({ rejection: { name, reason } });

const judge =
  (today: string) =>
  (raw: unknown): Verdict => {
    const rawId = asNonEmptyString(readProp(raw, 'id'));
    const name = nameOf(readProp(raw, 'name'));
    if (name === undefined) return reject(rawId ?? '?', 'no English name');
    const denied = deniedReason([rawId ?? '', name.en, name.it, name.ru]);
    if (denied !== undefined) return reject(name.en, `denied: ${denied}`);
    const themeFrom = asNonEmptyString(readProp(raw, 'themeFrom'));
    const themeTo = asNonEmptyString(readProp(raw, 'themeTo'));
    const problem = windowProblem(themeFrom, themeTo, today);
    if (problem !== undefined || themeFrom === undefined || themeTo === undefined) {
      return reject(name.en, problem ?? 'malformed window');
    }
    return {
      holiday: {
        id: idOf(rawId, name, themeFrom),
        name,
        themeFrom,
        themeTo,
        theme: themeOf(readProp(raw, 'theme')),
        events: [],
      },
    };
  };

export type ParsedHolidays = Readonly<{ accepted: readonly Holiday[]; rejected: readonly Rejection[] }>;

/** The model's `{ holidays: [...] }` → the ones the policy lets through. */
export const parseHolidays = (value: unknown, today: string): ParsedHolidays => {
  const verdicts = (asArray(readProp(value, 'holidays')) ?? []).map(judge(today));
  const holidays = verdicts.flatMap((verdict) => ('holiday' in verdict ? [verdict.holiday] : []));
  return {
    accepted: holidays.filter((holiday, i) => holidays.findIndex((one) => one.id === holiday.id) === i),
    rejected: verdicts.flatMap((verdict) => ('rejection' in verdict ? [verdict.rejection] : [])),
  };
};
