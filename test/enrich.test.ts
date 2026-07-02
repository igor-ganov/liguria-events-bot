// T8 — enrichment batching + post extraction (AC-2.1–2.4).
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { chunk, makeEnrichEvents, makeExtractFromPosts } from '../src/llm/enrich.ts';
import type { ChatFn } from '../src/llm/client.ts';
import type { RawPost } from '../src/collectors/types.ts';

describe('chunk', () => {
  test('splits into fixed-size batches', () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunk([], 2), []);
  });
});

describe('makeEnrichEvents', () => {
  test('maps valid ids, skips invalid categories, batches ≤15 (AC-2.4)', async () => {
    const calls: string[] = [];
    const chat: ChatFn = async (_system, user) => {
      calls.push(user);
      return JSON.stringify({
        events: [
          { id: 'one', categories: ['music'], description: 'A concert.' },
          { id: 'two', categories: ['not-a-category'], description: 'Bad.' },
          { id: '', categories: ['art'], description: 'No id.' },
        ],
      });
    };
    const events = Array.from({ length: 7 }, (_, i) => ({
      id: i === 0 ? 'one' : `id${i}`,
      title: `Event ${i}`,
      dates: '2026-07-10',
    }));
    const enriched = await makeEnrichEvents(chat)(events);
    assert.equal(calls.length, 2); // 7 events → two batches of ≤6
    assert.deepEqual(enriched.get('one'), { categories: ['music'], description: 'A concert.', unusual: false });
    assert.equal(enriched.has('two'), false);
  });

  test('a failing batch degrades to an empty map (AC-2.3)', async () => {
    const chat: ChatFn = async () => {
      throw new Error('llm down');
    };
    const enriched = await makeEnrichEvents(chat)([
      { id: 'one', title: 'X', dates: '2026-07-10' },
    ]);
    assert.equal(enriched.size, 0);
  });
});

describe('makeExtractFromPosts', () => {
  const posts: readonly RawPost[] = [
    { channel: 'genova', messageId: 42, date: 1_780_000_000, text: 'Concerto sabato!' },
  ];

  test('valid events get t.me links; past and malformed are dropped', async () => {
    const chat: ChatFn = async () =>
      JSON.stringify({
        events: [
          {
            title: 'Concerto al Porto',
            startDate: '2026-07-04',
            time: '21:00',
            post: 'genova/42',
          },
          { title: 'Past thing', startDate: '2026-06-01', post: 'genova/42' },
          { title: 'No post ref', startDate: '2026-07-04', post: 'not a ref' },
          { title: 'Bad date', startDate: '04/07/2026', post: 'genova/42' },
        ],
      });
    const events = await makeExtractFromPosts(chat)(posts, '2026-07-01');
    assert.equal(events.length, 1);
    assert.equal(events[0]?.url, 'https://t.me/genova/42');
    assert.equal(events[0]?.source, 'tg:genova');
    assert.equal(events[0]?.time, '21:00');
  });

  test('no posts → no LLM call', async () => {
    let called = false;
    const chat: ChatFn = async () => {
      called = true;
      return '{}';
    };
    assert.deepEqual(await makeExtractFromPosts(chat)([], '2026-07-01'), []);
    assert.equal(called, false);
  });
});
