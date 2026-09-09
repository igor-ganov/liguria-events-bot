/**
 * LLM judge for fuzzy dedupe (AC-1.9): given candidate pairs, decide which
 * describe the same real-world event. Conservative by prompt — uncertainty
 * means "different", a wrong merge is worse than a duplicate listing.
 */
import { extractJson } from './client.ts';
import type { ChatFn } from './client.ts';
import type { CandidatePair } from '../pipeline/dedupe-candidates.ts';
import type { CompactEvent } from '../domain/event.ts';
import { chunk } from './enrich.ts';
import { asArray, asBoolean, asNumber, readProp } from '../util/json.ts';

const JUDGE_BATCH = 8;

const JUDGE_SYSTEM = [
  'You deduplicate a Genoa events database. For every numbered pair decide',
  'whether A and B describe the SAME real-world event (the same happening,',
  'listed by two different websites under different titles).',
  'Two listings of one happening rarely agree on wording. Weigh the evidence',
  'you are given, not the titles alone: the same town, the same day and the',
  'same start time is a strong signal, and so is the same poster or two',
  'descriptions that open on the same sentence. One site naming the whole town',
  'and another naming the square inside it is one event, not two.',
  'A part of a festival that stands on its own — its own venue, its own',
  'ticket, an artist billed by name — is NOT the same as the festival.',
  'But a line of a festival programme with no separate identity (a procession,',
  'a mass, a flag-raising, a fireworks night, "day two") IS the same event as',
  'the festival it belongs to: it must not stand in a feed as its own card.',
  'A one-off event on a different day is a different occurrence → NOT the same.',
  'BUT a multi-day run quoted with slightly different start/end dates is the',
  'same event when the ranges heavily overlap and the title + venue match — e.g.',
  '"Gothica" 2–26 Jul at Parco X vs "Gothica, the immersive show at Parco X"',
  '3–26 Jul is ONE event (same show, sources just quote the start a day apart).',
  'The same tour playing two towns is two events.',
  'When the evidence is thin, answer false.',
  'Respond with STRICT valid JSON, no markdown:',
  '{ "pairs": [ { "i": <pair index>, "same": true|false } ] }',
].join('\n');

/** Enough of the text to see whether two sources are retelling one press
 *  release, and little enough that eight pairs still fit in one call. */
const OPENING = 220;

const host = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

const artwork = (event: CompactEvent): string => (event.img ?? '').split('?')[0] ?? '';

const side = (event: CompactEvent): Readonly<Record<string, string>> => ({
  title: event.t,
  dates: `${event.s}..${event.e ?? event.s}`,
  time: event.h ?? '',
  venue: event.v ?? '',
  town: event.ct ?? '',
  source: host(event.u),
  opening: (event.d?.en ?? '').replace(/\s+/g, ' ').slice(0, OPENING),
  ...(event.p === undefined ? {} : { programme: event.p.map((row) => row.title).join('; ') }),
});

/** The two facts that live in the pair rather than in either side. */
const shared = (pair: CandidatePair): Readonly<Record<string, string>> => ({
  poster: artwork(pair.a) !== '' && artwork(pair.a) === artwork(pair.b) ? 'same' : 'different',
});

const pairLine = (pair: CandidatePair, index: number): string =>
  JSON.stringify({ i: index, ...shared(pair), a: side(pair.a), b: side(pair.b) });

/** Returns the pairs confirmed as duplicates; a failed batch confirms none. */
export const makeJudgeSameEvent =
  (chat: ChatFn) =>
  async (pairs: readonly CandidatePair[]): Promise<readonly CandidatePair[]> => {
    const results = await Promise.all(
      chunk(pairs, JUDGE_BATCH).map(async (batch, batchIndex) => {
        try {
          const offset = batchIndex * JUDGE_BATCH;
          const reply = await chat(
            JUDGE_SYSTEM,
            batch.map((pair, i) => pairLine(pair, offset + i)).join('\n'),
          );
          const verdicts = asArray(readProp(extractJson(reply), 'pairs')) ?? [];
          return verdicts.flatMap((verdict): readonly CandidatePair[] => {
            const i = asNumber(readProp(verdict, 'i'));
            const same = asBoolean(readProp(verdict, 'same'));
            const pair = i === undefined ? undefined : pairs[i];
            return same === true && pair !== undefined ? [pair] : [];
          });
        } catch {
          return [];
        }
      }),
    );
    return results.flat();
  };
