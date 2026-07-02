/**
 * Shared parsing for Italian-source date ranges and HTML entities
 * (design §4). Handles `01/07/2026 - 31/08/2026` (visitgenoa) and
 * `Dal 09/07/2026 al 12/07/2026` (mentelocale).
 */

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  quot: '"',
  lt: '<',
  gt: '>',
  nbsp: ' ',
};

export const decodeEntities = (text: string): string =>
  text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&(amp|quot|lt|gt|nbsp);/g, (_, name: string) => NAMED_ENTITIES[name] ?? '')
    .replace(/\s+/g, ' ')
    .trim();

export const DATE_RANGE =
  /(\d{2})\/(\d{2})\/(\d{4})(?:\s*(?:-|al)\s*(\d{2})\/(\d{2})\/(\d{4}))?/;

export type DateRange = Readonly<{ startDate: string; endDate?: string }>;

/** dd/mm/yyyy (optionally `- dd/mm/yyyy` or `al dd/mm/yyyy`) → ISO range. */
export const parseDateRange = (text: string): DateRange | undefined => {
  const match = DATE_RANGE.exec(text);
  if (match === null) return undefined;
  const [, d1, m1, y1, d2, m2, y2] = match;
  if (d1 === undefined || m1 === undefined || y1 === undefined) return undefined;
  const startDate = `${y1}-${m1}-${d1}`;
  if (d2 === undefined || m2 === undefined || y2 === undefined) return { startDate };
  const endDate = `${y2}-${m2}-${d2}`;
  return endDate === startDate ? { startDate } : { startDate, endDate };
};

const ITALIAN_MONTHS: Readonly<Record<string, string>> = {
  gen: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  mag: '05',
  giu: '06',
  lug: '07',
  ago: '08',
  set: '09',
  ott: '10',
  nov: '11',
  dic: '12',
};

const ITALIAN_DATE = /(\d{1,2})\s+(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)\w*\.?\s+(\d{4})/gi;
const TIME_OF_DAY = /ore\s+(\d{1,2})[:.](\d{2})/i;

export type DatedInfo = Readonly<{
  startDate: string;
  endDate?: string;
  time?: string;
  /** Text preceding the first date — venue on palazzoducale cards. */
  prefix: string;
}>;

/** `Palazzo Ducale … 01 lug 2026 — 03 lug 2026, ore 21:30` → ISO range + time. */
export const parseItalianDateInfo = (text: string): DatedInfo | undefined => {
  const matches = [...text.matchAll(ITALIAN_DATE)];
  const first = matches[0];
  if (first === undefined) return undefined;
  const toIso = (match: RegExpMatchArray): string | undefined => {
    const [, day, month, year] = match;
    const monthNumber = ITALIAN_MONTHS[(month ?? '').toLowerCase()];
    return day === undefined || monthNumber === undefined || year === undefined
      ? undefined
      : `${year}-${monthNumber}-${day.padStart(2, '0')}`;
  };
  const startDate = toIso(first);
  if (startDate === undefined) return undefined;
  const second = matches[1];
  const endDate = second === undefined ? undefined : toIso(second);
  const timeMatch = TIME_OF_DAY.exec(text);
  const time =
    timeMatch?.[1] === undefined || timeMatch[2] === undefined
      ? undefined
      : `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
  return {
    startDate,
    prefix: text.slice(0, first.index).trim(),
    ...(endDate === undefined || endDate === startDate ? {} : { endDate }),
    ...(time === undefined ? {} : { time }),
  };
};
