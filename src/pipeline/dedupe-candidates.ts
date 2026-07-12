/**
 * Cheap pre-filter for fuzzy cross-source dedupe (AC-1.9). Pairs go to the
 * LLM only when they overlap in dates, come via different links, and share
 * a significant title token or a venue — everything else is assumed
 * distinct without spending a model call.
 */
import { normalizeTitle } from '../domain/event.ts';
import type { CompactEvent } from '../domain/event.ts';

/**
 * Words that make Italian event titles look alike without saying anything
 * about WHICH event this is. Two village sagre share "sagra", "festa" and
 * "musica" and nothing else; a venue name shared through the title ("porto
 * antico", "palazzo ducale") is the venue talking, not the event. Both used
 * to pass for title similarity.
 */
const STOPWORDS = new Set([
  'festival',
  'genova',
  'teatro',
  'mostra',
  'estate',
  'edizione',
  'stagione',
  'estiva',
  'estivo',
  'evento',
  'eventi',
  'internazionale',
  'della',
  'dello',
  'delle',
  // generic event vocabulary
  'sagra',
  'festa',
  'feste',
  'musica',
  'concerto',
  'concerti',
  'spettacolo',
  'spettacoli',
  'gastronomia',
  'gastronomici',
  'gastronomico',
  'degustazione',
  'cinema',
  'aperto',
  'rassegna',
  'appuntamento',
  'programma',
  'biglietti',
  'notte',
  'danza',
  // venue words that travel inside titles
  'porto',
  'antico',
  'palazzo',
  'ducale',
  'piazza',
  'centro',
  'storico',
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

/**
 * A venue plus a date is NOT evidence: an opera house runs a different opera
 * every night and a museum runs six exhibitions at once, so venue+date alone
 * used to manufacture ~90 bogus pairs per run. They outranked the real
 * cross-source duplicates, ate the whole cap, and the real ones were never
 * judged. Two listings of one happening always share at least one significant
 * word, so demand that before anything else counts.
 */
const sharesTitleToken = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  [...a].some((token) => b.has(token));

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
  cap = 60,
): readonly CandidatePair[] => {
  const tokens = new Map(index.map((event) => [event.id, significantTokens(event.t)]));
  const shares = (a: CompactEvent, b: CompactEvent): boolean =>
    sharesTitleToken(tokens.get(a.id) ?? new Set(), tokens.get(b.id) ?? new Set());
  return index
    .flatMap((a, i) =>
      index
        .slice(i + 1)
        .filter((b) => overlaps(a, b) && shares(a, b) && !alreadyLinked(a, b))
        .map((b) => ({ a, b, score: pairScore(a, b) })),
    )
    .filter((pair) => pair.score >= THRESHOLD)
    .toSorted((x, y) => y.score - x.score)
    .slice(0, cap);
};
