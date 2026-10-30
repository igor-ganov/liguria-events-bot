/**
 * Which corpus events the model is asked about for a holiday, what it sees
 * of each, and how its answer is read back.
 */
import { asArray, asString, readProp } from '../util/json.ts';
import type { CompactEvent } from '../domain/event.ts';
import type { Holiday } from './holiday.ts';

/** One classification call: cheap enough to stay well inside the model's budget. */
export const CLASSIFY_BATCH = 20;
/** Hard ceiling on events asked about per holiday — bounds the run's calls. */
export const MAX_CANDIDATES = 400;
const TEXT_CHARS = 400;

const lastDay = (event: CompactEvent): string => event.e ?? event.s;

const spanDays = (event: CompactEvent): number =>
  (Date.parse(lastDay(event)) - Date.parse(event.s)) / 86_400_000;

/**
 * Upcoming events whose dates touch the holiday's window, shortest first: a
 * one-night party is likelier to be about the holiday than a season-long
 * exhibition, so it is the last thing the cap would cut.
 */
export const candidatesFor = (
  holiday: Holiday,
  index: readonly CompactEvent[],
  today: string,
): readonly CompactEvent[] => {
  const from = holiday.themeFrom > today ? holiday.themeFrom : today;
  return index
    .filter((event) => event.s <= holiday.themeTo && lastDay(event) >= from)
    .toSorted((a, b) => spanDays(a) - spanDays(b) || a.s.localeCompare(b.s))
    .slice(0, MAX_CANDIDATES);
};

export type ClassifyLine = Readonly<{ id: string; title: string; text: string }>;

export const classifyInput = (batch: readonly CompactEvent[]): readonly ClassifyLine[] =>
  batch.map((event) => ({
    id: event.id,
    title: event.tl?.en || event.t,
    text: (event.d?.en ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_CHARS),
  }));

// Words only: a quote and the text it came from are compared without the
// punctuation and spacing a model drops or adds ("Torino: Mariachi").
const plain = (text: string): string =>
  text.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Everything the model was shown of one event, as it was shown.
const shownOf = (event: CompactEvent): string =>
  plain([event.t, event.tl?.en ?? '', ...classifyInput([event]).map((line) => line.text)].join(' '));

/**
 * The members the model named, each kept only when the words it quotes as the
 * tie to the holiday are really in that event's own title or text. A model
 * that answers by id alone can name anything — the first run filed a talk by
 * a journalist from Gaza under Halloween — and a quote it has to find in the
 * text it was given is how that is caught.
 */
export const parseMembers = (value: unknown, batch: readonly CompactEvent[]): readonly string[] => {
  const quoted = new Map(
    (asArray(readProp(value, 'members')) ?? []).map((item) => [asString(readProp(item, 'id')) ?? '', plain(asString(readProp(item, 'evidence')) ?? '')]),
  );
  return batch
    .filter((event) => {
      const evidence = quoted.get(event.id) ?? '';
      return evidence.length >= 3 && shownOf(event).includes(evidence);
    })
    .map((event) => event.id);
};

/**
 * Whether an event's title names the holiday in any of its languages. Such an
 * event is the holiday's whatever the model answered: "Halloween 2026 a
 * Torino" was left out on a quote that missed by a colon.
 */
export const namesHoliday =
  (holiday: Holiday) =>
  (event: CompactEvent): boolean => {
    const title = ` ${plain([event.t, ...Object.values(event.tl ?? {})].join(' '))} `;
    return Object.values(holiday.name)
      .map(plain)
      .filter((name) => name.length >= 4)
      .some((name) => title.includes(` ${name} `));
  };
