// T8 — enrichment batching + post extraction (AC-2.1–2.4).
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { ENRICH_SYSTEM, chunk, makeEnrichEvents, makeExtractFromPosts } from '../src/llm/enrich.ts';
import type { ChatFn } from '../src/llm/client.ts';
import type { RawPost } from '../src/collectors/types.ts';

describe('chunk', () => {
  test('splits into fixed-size batches', () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunk([], 2), []);
  });
});

describe('makeEnrichEvents', () => {
  // One call reads the source in English; two short calls translate what it
  // produced. The old shape asked for three structured articles in one
  // completion, and on the longest sources both providers timed out.
  const answering = (calls: string[]): ChatFn => async (system, user) => {
    calls.push(system.slice(0, 40));
    return system.startsWith('You translate')
      ? JSON.stringify({ title: 'Concerto', description: 'Un concerto.' })
      : JSON.stringify({
          events: [
            { id: 'one', categories: ['music'], title: 'A concert', description: 'A concert.' },
            { id: 'two', categories: ['not-a-category'], description: 'Bad.' },
            { id: '', categories: ['art'], description: 'No id.' },
          ],
        });
  };

  const seven = Array.from({ length: 7 }, (_, i) => ({
    id: i === 0 ? 'one' : `id${i}`,
    title: `Event ${i}`,
    dates: '2026-07-10',
  }));

  test('reads once and translates twice, per event', async () => {
    const calls: string[] = [];
    await makeEnrichEvents(answering(calls))(seven);
    assert.equal(calls.filter((one) => one.startsWith('You are a data curator')).length, 7);
    assert.equal(calls.filter((one) => one.startsWith('You translate')).length, 14);
  });

  test('assembles the three languages from the analysis and its translations', async () => {
    const enriched = await makeEnrichEvents(answering([]))(seven);
    assert.deepEqual(enriched.get('one'), {
      categories: ['music'],
      descriptions: { en: 'A concert.', it: 'Un concerto.', ru: 'Un concerto.' },
      titles: { en: 'A concert', it: 'Concerto', ru: 'Concerto' },
      unusual: false,
    });
  });

  test('still drops an item with no usable category or id', async () => {
    const enriched = await makeEnrichEvents(answering([]))(seven);
    assert.equal(enriched.has('two'), false);
    assert.equal(enriched.has(''), false);
  });

  test('a failed translation drops the event rather than storing English as Italian', async () => {
    // Half a record looks enriched and would never be retried; an unenriched
    // one comes back on the next run.
    const chat: ChatFn = async (system) =>
      system.startsWith('You translate')
        ? 'not json at all'
        : JSON.stringify({ events: [{ id: 'one', categories: ['music'], description: 'A concert.' }] });
    const enriched = await makeEnrichEvents(chat)([{ id: 'one', title: 'X', dates: '2026-07-10' }]);
    assert.equal(enriched.size, 0);
  });

  test('a title the model declined to translate falls back to the English one', async () => {
    const chat: ChatFn = async (system) =>
      system.startsWith('You translate')
        ? JSON.stringify({ description: 'Un concerto.' })
        : JSON.stringify({
            events: [{ id: 'one', categories: ['music'], title: 'Rolling Stones', description: 'A concert.' }],
          });
    const enriched = await makeEnrichEvents(chat)([{ id: 'one', title: 'X', dates: '2026-07-10' }]);
    assert.deepEqual(enriched.get('one')?.titles, {
      en: 'Rolling Stones',
      it: 'Rolling Stones',
      ru: 'Rolling Stones',
    });
  });

  // A programme is read in English like everything else, and its titles were
  // the one thing never translated: an Italian page listed its own festival's
  // nights in English.
  const programme = (translated: (language: string) => unknown): ChatFn => async (system, user) =>
    system.startsWith('You translate')
      ? JSON.stringify(translated(system.includes('Italian') ? 'it' : 'ru'))
      : JSON.stringify({
          events: [
            {
              id: 'one',
              categories: ['music'],
              description: 'A festival.',
              kind: 'container',
              sessions: [
                { date: '2026-07-10', title: 'Round table' },
                { date: '2026-07-11' },
                { date: '2026-07-12', title: 'Closing concert' },
              ],
            },
          ],
        });

  test('the titles of a programme are translated with the rest', async () => {
    const chat = programme((language) => ({
      description: 'Un festival.',
      sessions: language === 'it' ? ['Tavola rotonda', 'Concerto finale'] : ['Круглый стол', 'Заключительный концерт'],
    }));
    const enriched = await makeEnrichEvents(chat)([{ id: 'one', title: 'X', dates: '2026-07-10' }]);
    assert.deepEqual(enriched.get('one')?.sessions, [
      { date: '2026-07-10', title: 'Round table', titles: { en: 'Round table', it: 'Tavola rotonda', ru: 'Круглый стол' } },
      { date: '2026-07-11' },
      { date: '2026-07-12', title: 'Closing concert', titles: { en: 'Closing concert', it: 'Concerto finale', ru: 'Заключительный концерт' } },
    ]);
  });

  test('the translator is handed the titles, in order, and nothing else of the programme', async () => {
    const asked: string[] = [];
    const chat: ChatFn = async (system, user) => {
      if (system.startsWith('You translate')) asked.push(user);
      return programme(() => ({ description: 'Un festival.', sessions: ['a', 'b'] }))(system, user);
    };
    await makeEnrichEvents(chat)([{ id: 'one', title: 'X', dates: '2026-07-10' }]);
    assert.deepEqual(JSON.parse(asked[0] ?? '{}').sessions, ['Round table', 'Closing concert']);
  });

  test('a list that came back the wrong length is not guessed at: the titles stay as read', async () => {
    const chat = programme(() => ({ description: 'Un festival.', sessions: ['Tavola rotonda'] }));
    const enriched = await makeEnrichEvents(chat)([{ id: 'one', title: 'X', dates: '2026-07-10' }]);
    assert.deepEqual(enriched.get('one')?.sessions?.[2]?.titles, {
      en: 'Closing concert',
      it: 'Closing concert',
      ru: 'Closing concert',
    });
  });

  test('a failing batch degrades to an empty map (AC-2.3)', async () => {
    const chat: ChatFn = async () => {
      throw new Error('llm down');
    };
    const enriched = await makeEnrichEvents(chat)([{ id: 'one', title: 'X', dates: '2026-07-10' }]);
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

describe('the enrichment prompt', () => {
  // The JSON example shows a description whose Markdown sections are separated
  // by escaped newlines. Written with a single backslash in the source, those
  // become REAL newlines in the prompt — so the example demonstrates a JSON
  // string broken across lines, the model copies it faithfully, and every reply
  // comes back unparseable. It did: 23 of 24 events lost in one run.
  const example = ENRICH_SYSTEM.split('\n').find((line) => line.includes('"events": [ { "id":')) ?? '';

  test('the example is on one line, as JSON requires', () => {
    assert.notEqual(example, '');
    assert.ok(!example.includes('\n'));
  });

  test('its newlines are escaped, not real', () => {
    const backslashN = String.fromCharCode(92) + 'n';
    assert.ok(example.includes(`up close.${backslashN}${backslashN}## [programme]`), example.slice(150, 320));
  });

  test('it asks for the flat English pair, not a three-language map', () => {
    assert.ok(example.includes('"description":'));
    assert.ok(!example.includes('"descriptions":'));
  });
});
