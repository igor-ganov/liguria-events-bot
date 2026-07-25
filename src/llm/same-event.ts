/**
 * LLM judge for fuzzy dedupe (AC-1.9): given candidate pairs, decide which
 * describe the same real-world event. Conservative by prompt — uncertainty
 * means "different", a wrong merge is worse than a duplicate listing.
 */
import { extractJson } from './client.ts';
import type { ChatFn } from './client.ts';
import type { CandidatePair } from '../pipeline/dedupe-candidates.ts';
import { chunk } from './enrich.ts';
import { asArray, asBoolean, asNumber, readProp } from '../util/json.ts';

const JUDGE_BATCH = 8;

const JUDGE_SYSTEM = [
  'You deduplicate a Genoa events database. For every numbered pair decide',
  'whether A and B describe the SAME real-world event (the same happening,',
  'listed by two different websites under different titles).',
  'Same festival edition listed whole vs. one specific show inside it → NOT',
  'the same.',
  'A one-off event on a different day is a different occurrence → NOT the same.',
  'BUT a multi-day run quoted with slightly different start/end dates is the',
  'same event when the ranges heavily overlap and the title + venue match — e.g.',
  '"Gothica" 2–26 Jul at Parco X vs "Gothica, the immersive show at Parco X"',
  '3–26 Jul is ONE event (same show, sources just quote the start a day apart).',
  'Be conservative: when uncertain answer false.',
  'Respond with STRICT valid JSON, no markdown:',
  '{ "pairs": [ { "i": <pair index>, "same": true|false } ] }',
].join('\n');

const pairLine = (pair: CandidatePair, index: number): string =>
  JSON.stringify({
    i: index,
    a: { title: pair.a.t, dates: `${pair.a.s}..${pair.a.e ?? pair.a.s}`, venue: pair.a.v ?? '' },
    b: { title: pair.b.t, dates: `${pair.b.s}..${pair.b.e ?? pair.b.s}`, venue: pair.b.v ?? '' },
  });

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
