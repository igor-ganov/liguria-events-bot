/**
 * Holidays the site dresses up for. The shapes here are the public contract
 * of GET /holidays.json — the site reads them field for field.
 */
import type { LocalizedText } from '../domain/event.ts';

export const MOTIFS = [
  'pumpkin',
  'bat',
  'leaf',
  'star',
  'snowflake',
  'heart',
  'confetti',
  'flower',
  'sun',
  'none',
] as const;

export type Motif = (typeof MOTIFS)[number];

export const isMotif = (value: unknown): value is Motif => MOTIFS.some((motif) => motif === value);

export type Palette = Readonly<{ accent: string; accentDark: string }>;

export type Theme = Palette & Readonly<{ motif: Motif }>;

export type Holiday = Readonly<{
  id: string;
  name: LocalizedText;
  /** 'YYYY-MM-DD', Europe/Rome — first day the site wears the theme. */
  themeFrom: string;
  /** 'YYYY-MM-DD', Europe/Rome — last day, inclusive. */
  themeTo: string;
  theme: Theme;
  /** Ids of upcoming corpus events the model judged to belong to it. */
  events: readonly string[];
}>;

export type HolidaysPayload = Readonly<{ generatedAt: string; holidays: readonly Holiday[] }>;

/** A holiday the model proposed and the code refused, with why. */
export type Rejection = Readonly<{ name: string; reason: string }>;

/** How far ahead the job looks, and the longest theme window it accepts. */
export const HORIZON_DAYS = 14;
export const MAX_WINDOW_DAYS = 14;
