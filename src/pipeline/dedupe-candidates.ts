/**
 * Cheap pre-filter for fuzzy cross-source dedupe (AC-1.9). Pairs go to the
 * LLM only when they overlap in dates, come via different links, and share
 * a significant title token or a venue — everything else is assumed
 * distinct without spending a model call.
 */
import { normalizeTitle } from '../domain/event.ts';
import type { CompactEvent } from '../domain/event.ts';

/** Generic words that make Italian event titles look alike. */
const STOPWORDS = new Set([
  'festival',
  'genova',
  'teatro',
  'mostra',
  'estate',
  'edizione',
  'stagione',
  'evento',
  'eventi',
  'internazionale',
  'della',
  'dello',
  'delle',
]);

export const significantTokens = (title: string): ReadonlySet<string> =>
  new Set(
    normalizeTitle(title)
      .split(' ')
      .filter((token) => token.length >= 5 && !STOPWORDS.has(token) && !/^\d+$/.test(token)),
  );

const overlaps = (a: CompactEvent, b: CompactEvent): boolean =>
  a.s <= (b.e ?? b.s) && b.s <= (a.e ?? a.s);

const jaccard = (a: ReadonlySet<string>, b: ReadonlySet<string>): number => {
  const shared = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : shared / union;
};

const sameVenue = (a: CompactEvent, b: CompactEvent): boolean =>
  a.v !== undefined && b.v !== undefined && normalizeTitle(a.v) === normalizeTitle(b.v);

const knownUrls = (event: CompactEvent): readonly string[] => [
  event.u,
  ...(event.l ?? []).map((link) => link.url),
];

/** Already-linked pairs (shared url) are the SAME record's aliases — skip. */
const alreadyLinked = (a: CompactEvent, b: CompactEvent): boolean =>
  knownUrls(a).some((url) => knownUrls(b).includes(url));

/**
 * Likelihood ranking: title similarity dominates, identical dates and a
 * shared venue reinforce. Long-running events overlap everything by date, so
 * date terms alone can never reach the threshold.
 */
export const pairScore = (a: CompactEvent, b: CompactEvent): number =>
  jaccard(significantTokens(a.t), significantTokens(b.t)) * 4 +
  Number(a.s === b.s) * 2 +
  Number((a.e ?? a.s) === (b.e ?? b.s)) +
  Number(sameVenue(a, b));

const THRESHOLD = 2;

export type CandidatePair = Readonly<{ a: CompactEvent; b: CompactEvent; score: number }>;

/**
 * Two index entries sharing a url ARE the same event with certainty — a
 * duplicate resurrected before the alias map existed. Merged without any
 * LLM call.
 */
export const urlDuplicates = (index: readonly CompactEvent[]): readonly CandidatePair[] =>
  index.flatMap((a, i) =>
    index
      .slice(i + 1)
      .filter((b) => alreadyLinked(a, b))
      .map((b) => ({ a, b, score: Number.POSITIVE_INFINITY })),
  );

export const dedupeCandidates = (
  index: readonly CompactEvent[],
  cap = 20,
): readonly CandidatePair[] =>
  index
    .flatMap((a, i) =>
      index
        .slice(i + 1)
        .filter((b) => overlaps(a, b) && !alreadyLinked(a, b))
        .map((b) => ({ a, b, score: pairScore(a, b) })),
    )
    .filter((pair) => pair.score >= THRESHOLD)
    .toSorted((x, y) => y.score - x.score)
    .slice(0, cap);
