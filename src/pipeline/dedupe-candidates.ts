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
  // What a listing does, not which listing it is. A museum runs "Visita con
  // Degustazione" and "Visita della Poesia" on one afternoon: they share
  // "visita" and nothing else, and that one word scored them a perfect title
  // match and filled the whole candidate cap with pairs of different tours.
  'visita',
  'visite',
  'visitare',
  'guidata',
  'guidate',
  'escursione',
  'escursioni',
  'passeggiata',
  'itinerario',
  'laboratorio',
  'laboratori',
  'aperitivo',
  'aperitivi',
  'incontro',
  'incontri',
  'presentazione',
  'proiezione',
  'esposizione',
  'inaugurazione',
  'bambini',
  'famiglie',
  'gratuito',
  'gratuita',
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

/** One happening does not move: an Oktoberfest in Genova and one in Padova on
 *  the same weekend are two, and so is a tour on consecutive nights. A town we
 *  failed to work out is not evidence of anything, so an unplaced event still
 *  pairs — our own gap must not keep two listings of one evening apart. */
const twoTowns = (a: CompactEvent, b: CompactEvent): boolean =>
  a.ct !== undefined && b.ct !== undefined && a.ct !== b.ct;

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

// One title's significant words being a subset of the other's — "Gothica" ⊂
// "Gothica, the immersive show at Parco X". Jaccard alone punishes this (the
// longer title dilutes the overlap), yet it is a strong same-event signal, so
// the pair must not fall below the cap and skip the judge.
const contained = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  return small.size > 0 && [...small].every((token) => big.has(token));
};

/** Artwork identity, without the cache-buster the sources hang off it. */
const artwork = (event: CompactEvent): string => (event.img ?? '').split('?')[0] ?? '';

/**
 * One photo, one town.
 *
 * A programme published as separate listings — a flag-raising, a blessing, the
 * fireworks — shares no word between its titles, so nothing but the picture
 * says they are one festival. Across towns the same picture means a tour, so
 * the town has to match too. Where a venue reuses one poster for its whole
 * season, dropSharedArtwork has already stripped all but the earliest, and
 * this sees nothing.
 */
const samePoster = (a: CompactEvent, b: CompactEvent): boolean =>
  artwork(a) !== '' && artwork(a) === artwork(b) && a.ct !== undefined && a.ct === b.ct;

/**
 * Likelihood ranking: title similarity dominates, identical dates and a
 * shared venue reinforce. Long-running events overlap everything by date, so
 * date terms alone can never reach the threshold.
 */
export const pairScore = (
  a: CompactEvent,
  b: CompactEvent,
  aTokens?: ReadonlySet<string>,
  bTokens?: ReadonlySet<string>,
): number => {
  const ta = aTokens ?? significantTokens(a.t);
  const tb = bTokens ?? significantTokens(b.t);
  return (
    jaccard(ta, tb) * 4 +
    Number(a.s === b.s) * 2 +
    Number((a.e ?? a.s) === (b.e ?? b.s)) +
    Number(sameVenue(a, b)) +
    Number(contained(ta, tb)) * 2 +
    Number(samePoster(a, b)) * 2
  );
};

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

/** Past this many events, a word is describing the town, the season or the
 *  venue rather than the event. Measured on the live corpus: at four, the
 *  candidate list stops being led by "MILANO CUP" against "TORNEI CLUB
 *  MILANO", and a sagra named twice by two sources still pairs. */
const CROWD = 4;

/**
 * The words too many listings share to mean anything.
 *
 * A festival brand is on twenty concerts, a town name is in every title from
 * that town, a venue's name is in every event it hosts. Each of those scored a
 * perfect title match between events that have nothing to do with each other,
 * and those pairs led the candidate list — the judge spent its calls on them
 * while the real cross-source duplicates waited behind.
 */
export const crowdedTokens = (index: readonly CompactEvent[]): ReadonlySet<string> => {
  const seen = new Map<string, number>();
  for (const event of index) {
    for (const token of significantTokens(event.t)) seen.set(token, (seen.get(token) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, count]) => count > CROWD).map(([token]) => token));
};

/** The words a place puts into a title. Castello D'Albertis runs a dozen
 *  unrelated things and its name is in every one of their titles: shared with
 *  the venue, a word says where, not what. */
const placeWords = (event: CompactEvent): ReadonlySet<string> =>
  new Set(
    normalizeTitle(`${event.v ?? ''} ${event.ct ?? ''}`)
      .split(' ')
      .filter((word) => word.length >= 5),
  );

/** What a title says beyond where it happens. */
const distinctive = (event: CompactEvent, place: ReadonlySet<string>): ReadonlySet<string> =>
  new Set([...significantTokens(event.t)].filter((token) => !place.has(token)));

/** Two shared words, because one is a coincidence: "aperitivo" is on four
 *  listings a night in Genova. */
const NAMED = 2;

const sameHappening = (a: CompactEvent, b: CompactEvent): boolean => {
  const place = new Set([...placeWords(a), ...placeWords(b)]);
  const ta = distinctive(a, place);
  const tb = distinctive(b, place);
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  const shared = [...small].filter((token) => big.has(token));
  return shared.length >= NAMED && shared.length === small.size;
};

/**
 * Pairs certain enough to merge without asking anything.
 *
 * Same town, same day, same minute, and one title's own words entirely inside
 * the other's: nothing else runs at that address at that minute under that
 * name. The judge was asked about exactly these pairs for months and kept
 * answering "different" — on a prompt that was never shown the hour or the
 * city — so the reader got two cards for one night out. A model's caution is
 * not a rule; this is a rule.
 */
export const certainDuplicates = (index: readonly CompactEvent[]): readonly CandidatePair[] =>
  index.flatMap((a, i) =>
    index
      .slice(i + 1)
      .filter((b) => a.ct !== undefined && a.ct === b.ct)
      .filter((b) => a.s === b.s && a.h !== undefined && a.h === b.h)
      .filter((b) => !alreadyLinked(a, b))
      .filter((b) => sameHappening(a, b))
      .map((b) => ({ a, b, score: Number.POSITIVE_INFINITY })),
  );

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
  const crowded = crowdedTokens(index);
  const tokens = new Map(
    index.map((event) => [
      event.id,
      new Set([...significantTokens(event.t)].filter((token) => !crowded.has(token))),
    ]),
  );
  const shares = (a: CompactEvent, b: CompactEvent): boolean =>
    sharesTitleToken(tokens.get(a.id) ?? new Set(), tokens.get(b.id) ?? new Set());
  return index
    .flatMap((a, i) =>
      index
        .slice(i + 1)
        .filter(
          (b) =>
            overlaps(a, b) && !twoTowns(a, b) && (shares(a, b) || samePoster(a, b)) && !alreadyLinked(a, b),
        )
        .map((b) => ({ a, b, score: pairScore(a, b, tokens.get(a.id), tokens.get(b.id)) })),
    )
    .filter((pair) => pair.score >= THRESHOLD)
    .toSorted((x, y) => y.score - x.score)
    .slice(0, cap);
};
