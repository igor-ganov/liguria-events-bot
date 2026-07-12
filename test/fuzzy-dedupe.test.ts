// AC-1.9 — fuzzy cross-source dedupe: candidates, judge parsing, record merge.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { dedupeCandidates, significantTokens } from '../src/pipeline/dedupe-candidates.ts';
import { makeJudgeSameEvent } from '../src/llm/same-event.ts';
import { mergeDuplicates } from '../src/domain/merge-duplicates.ts';
import type { ChatFn } from '../src/llm/client.ts';
import type { CompactEvent, EventRecord } from '../src/domain/event.ts';

const compact = (
  overrides: Partial<CompactEvent> & Pick<CompactEvent, 'id' | 't' | 's' | 'u'>,
): CompactEvent => ({ c: ['other'], ...overrides });

const fuoriA = compact({
  id: 'a',
  t: 'FuoriFormato 26. Festival internazionale di danza contemporanea e videodanza',
  s: '2026-06-30',
  e: '2026-07-03',
  u: 'https://www.visitgenoa.it/en/node/27181',
});
const fuoriB = compact({
  id: 'b',
  t: 'FuoriFormato Festival',
  s: '2026-06-30',
  e: '2026-07-03',
  u: 'https://www.genovateatro.it/eventi/2025-2026/comune/fuoriformato-festival.htm',
});
const unrelated = compact({
  id: 'z',
  t: 'Sagra del pesto a Rapallo',
  s: '2026-07-01',
  u: 'https://www.mentelocale.it/z.htm',
});

describe('significantTokens', () => {
  test('drops stopwords, short words and numbers', () => {
    assert.deepEqual(
      [...significantTokens('FuoriFormato 26. Festival internazionale di danza')].sort(),
      ['fuoriformato'],
    );
  });
  test('drops the generic event vocabulary two unrelated sagre share', () => {
    assert.deepEqual([...significantTokens('Sagra del raviolo con musica')].sort(), ['raviolo']);
  });
});

describe('dedupeCandidates', () => {
  test('pairs overlapping events sharing a significant token, skips unrelated', () => {
    const pairs = dedupeCandidates([fuoriA, fuoriB, unrelated]);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0]?.a.id, 'a');
    assert.equal(pairs[0]?.b.id, 'b');
  });
  test('skips pairs already linked via altLinks', () => {
    const linked = { ...fuoriA, l: [{ source: 'genovateatro', url: fuoriB.u }] };
    assert.deepEqual(dedupeCandidates([linked, fuoriB]), []);
  });
  test('urlDuplicates flags shared-url pairs as certain merges', async () => {
    const { urlDuplicates } = await import('../src/pipeline/dedupe-candidates.ts');
    const linked = { ...fuoriA, l: [{ source: 'genovateatro', url: fuoriB.u }] };
    const pairs = urlDuplicates([linked, fuoriB, unrelated]);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0]?.b.id, 'b');
    assert.deepEqual(urlDuplicates([fuoriA, unrelated]), []);
  });
  // A venue plus a date is not evidence: an opera house runs a different
  // opera every night. Pairing on that alone flooded the cap with false
  // positives and starved the real cross-source duplicates of a judge call.
  test('does not pair same-venue same-date events with nothing in the titles', () => {
    const v1 = compact({ id: 'v1', t: 'Rigoletto', s: '2026-07-05', u: 'https://x/1', v: 'Teatro Carlo Felice' });
    const v2 = compact({ id: 'v2', t: 'Tosca', s: '2026-07-05', u: 'https://y/2', v: 'Teatro Carlo Felice' });
    assert.deepEqual(dedupeCandidates([v1, v2]), []);
  });
  test('caps the output', () => {
    assert.equal(dedupeCandidates([fuoriA, fuoriB], 0).length, 0);
    assert.equal(dedupeCandidates([fuoriA, fuoriB]).length, 1);
  });
});

describe('makeJudgeSameEvent', () => {
  test('returns only confirmed pairs, tolerates junk verdicts', async () => {
    const chat: ChatFn = async () =>
      JSON.stringify({ pairs: [{ i: 0, same: true }, { i: 1, same: false }, { i: 99, same: true }] });
    const confirmed = await makeJudgeSameEvent(chat)([
      { a: fuoriA, b: fuoriB, score: 4 },
      { a: fuoriA, b: unrelated, score: 2 },
    ]);
    assert.equal(confirmed.length, 1);
    assert.equal(confirmed[0]?.b.id, 'b');
  });
  test('a failing chat confirms nothing (conservative)', async () => {
    const chat: ChatFn = async () => {
      throw new Error('down');
    };
    assert.deepEqual(await makeJudgeSameEvent(chat)([{ a: fuoriA, b: fuoriB, score: 4 }]), []);
  });
});

describe('mergeDuplicates', () => {
  const older: EventRecord = {
    id: 'a',
    title: 'FuoriFormato 26',
    startDate: '2026-06-30',
    endDate: '2026-07-03',
    categories: ['theatre'],
    descriptions: { en: 'LLM summary.', it: 'Sintesi.', ru: 'Сводка.' },
    url: 'https://www.visitgenoa.it/en/node/27181',
    source: 'visitgenoa',
    enriched: true,
    addedAt: 100,
  };
  const newer: EventRecord = {
    id: 'b',
    title: 'FuoriFormato Festival',
    startDate: '2026-06-30',
    categories: ['music', 'theatre'],
    descriptions: { en: 'Other summary.', it: 'Altro.', ru: 'Другое.' },
    venue: 'Teatro della Tosse',
    image: 'https://img/x.jpg',
    url: 'https://www.genovateatro.it/x.htm',
    source: 'genovateatro',
    enriched: true,
    addedAt: 200,
  };
  test('older stays primary; gaps fill; links and categories union', () => {
    const merged = mergeDuplicates(newer, older);
    assert.equal(merged.id, 'a');
    assert.equal(merged.descriptions.en, 'LLM summary.'); // primary's descriptions win
    assert.equal(merged.venue, 'Teatro della Tosse');
    assert.equal(merged.image, 'https://img/x.jpg');
    assert.deepEqual(merged.categories, ['theatre', 'music']);
    assert.deepEqual(merged.altLinks, [
      { source: 'genovateatro', url: 'https://www.genovateatro.it/x.htm' },
    ]);
  });
});
