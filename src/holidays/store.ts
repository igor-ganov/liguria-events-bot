/**
 * The published holidays artifact in KV, and the view of it that is served.
 */
import { romeDate } from '../pipeline/clock.ts';
import { asArray, asNonEmptyString, asString, parseJson, readProp } from '../util/json.ts';
import { isMotif } from './holiday.ts';
import type { Holiday, HolidaysPayload, Theme } from './holiday.ts';
import type { KvLike } from '../pipeline/store.ts';
import type { LocalizedText } from '../domain/event.ts';

export const HOLIDAYS_KEY = 'holidays';

const textOf = (raw: unknown): LocalizedText | undefined => {
  const en = asString(readProp(raw, 'en'));
  const it = asString(readProp(raw, 'it'));
  const ru = asString(readProp(raw, 'ru'));
  return en === undefined || it === undefined || ru === undefined ? undefined : { en, it, ru };
};

const themeOf = (raw: unknown): Theme | undefined => {
  const accent = asNonEmptyString(readProp(raw, 'accent'));
  const accentDark = asNonEmptyString(readProp(raw, 'accentDark'));
  const motif = readProp(raw, 'motif');
  return accent === undefined || accentDark === undefined || !isMotif(motif)
    ? undefined
    : { accent, accentDark, motif };
};

const holidayOf = (raw: unknown): readonly Holiday[] => {
  const id = asNonEmptyString(readProp(raw, 'id'));
  const name = textOf(readProp(raw, 'name'));
  const themeFrom = asNonEmptyString(readProp(raw, 'themeFrom'));
  const themeTo = asNonEmptyString(readProp(raw, 'themeTo'));
  const theme = themeOf(readProp(raw, 'theme'));
  const events = (asArray(readProp(raw, 'events')) ?? []).flatMap((one) => asNonEmptyString(one) ?? []);
  return id === undefined || name === undefined || themeFrom === undefined || themeTo === undefined || theme === undefined
    ? []
    : [{ id, name, themeFrom, themeTo, theme, events }];
};

export const parsePayload = (raw: unknown): HolidaysPayload | undefined => {
  const generatedAt = asString(readProp(raw, 'generatedAt'));
  const holidays = asArray(readProp(raw, 'holidays'));
  return generatedAt === undefined || holidays === undefined
    ? undefined
    : { generatedAt, holidays: holidays.flatMap(holidayOf) };
};

export const readHolidays = async (kv: KvLike): Promise<HolidaysPayload | undefined> => {
  const raw = (await kv.get(HOLIDAYS_KEY)) ?? undefined;
  return raw === undefined ? undefined : parsePayload(parseJson(raw));
};

export const writeHolidays = async (kv: KvLike, payload: HolidaysPayload): Promise<void> =>
  kv.put(HOLIDAYS_KEY, JSON.stringify(payload));

/** What is served: a holiday whose window has closed is not a holiday any more. */
export const currentHolidays = (payload: HolidaysPayload, today: string): HolidaysPayload => ({
  generatedAt: payload.generatedAt,
  holidays: payload.holidays.filter((holiday) => holiday.themeTo >= today),
});

/** The job runs once per Rome day. */
export const holidaysDue = (payload: HolidaysPayload | undefined, today: string): boolean => {
  const at = Date.parse(payload?.generatedAt ?? '');
  return !Number.isFinite(at) || romeDate(at) !== today;
};
