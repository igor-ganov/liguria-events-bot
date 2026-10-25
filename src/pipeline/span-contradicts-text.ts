/** What the check reads: a span and its English article. A stored record has
 *  this shape, and so does an index entry once its keys are spelled out. */
type Spanned = Readonly<{ startDate: string; endDate?: string; descriptions: Readonly<{ en: string }> }>;

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
] as const;

const DATE = /(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?/g;
const DAY_MS = 86_400_000;

// Days the English article's "When" section names, read as dates. A day with
// no year takes the year the record starts in.
const whenDates = (event: Spanned): readonly string[] => {
  const when = event.descriptions.en.split('## [when]')[1]?.split('\n## ')[0] ?? '';
  return [...when.toLowerCase().matchAll(DATE)].flatMap((match) => {
    const month = MONTHS.findIndex((name) => name === match[2]) + 1;
    const year = match[3] ?? event.startDate.slice(0, 4);
    return month === 0 ? [] : [`${year}-${String(month).padStart(2, '0')}-${(match[1] ?? '').padStart(2, '0')}`];
  });
};

const daysBetween = (from: string, to: string): number => (Date.parse(to) - Date.parse(from)) / DAY_MS;

/**
 * Whether a record's span is wider than the days its own article names: it
 * starts days before the first of them, or ends over a week after the last.
 *
 * Such a span came from a listing, not from the page — the Festival della
 * Scienza stored 14 October to 24 February while its article said 22 October
 * to 1 November. It is a reason to read the page again, not proof: an article
 * may name one evening of a months-long exhibition.
 */
export const spanContradictsText = (event: Spanned): boolean => {
  const named = whenDates(event).toSorted();
  const [first, last] = [named[0], named.at(-1)];
  return (
    first !== undefined &&
    last !== undefined &&
    (daysBetween(event.startDate, first) > 3 || daysBetween(last, event.endDate ?? event.startDate) > 8)
  );
};
