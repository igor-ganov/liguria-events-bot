/**
 * Europe/Rome calendar math via Intl — no hand-rolled DST offsets (design §2).
 * All date arithmetic happens on ISO 'YYYY-MM-DD' strings anchored at UTC noon
 * so day boundaries never wobble.
 */

const ROME_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Rome',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const ROME_HOUR = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Rome',
  hour: '2-digit',
  hourCycle: 'h23',
});

export const romeDate = (unixMs: number): string => ROME_DATE.format(new Date(unixMs));

export const romeHour = (unixMs: number): number => Number(ROME_HOUR.format(new Date(unixMs)));

export const addDays = (isoDate: string, days: number): string =>
  new Date(Date.parse(`${isoDate}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** 0 = Sunday … 6 = Saturday. */
export const weekdayOf = (isoDate: string): number =>
  new Date(`${isoDate}T12:00:00Z`).getUTCDay();
