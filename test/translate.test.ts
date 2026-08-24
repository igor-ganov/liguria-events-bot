// Enrichment asked one call for a structured Markdown article in three
// languages. On the slowest sources both providers timed out — a third of the
// batches on some runs — because the completion was three articles long. The
// work is now split: one call reads the source and writes English, two short
// calls translate what it produced.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { parseTranslation } from '../src/llm/parse-translation.ts';
import { makeTranslate } from '../src/llm/translate.ts';
import type { ChatFn } from '../src/llm/client.ts';

const reply = (value: unknown): ChatFn => async () => JSON.stringify(value);

describe('parseTranslation', () => {
  test('takes the title and the article', () => {
    assert.deepEqual(parseTranslation({ title: 'Concerto', description: 'Un concerto.' }), {
      title: 'Concerto',
      description: 'Un concerto.',
    });
  });

  test('a missing title is allowed — the pipeline falls back to the original', () => {
    assert.deepEqual(parseTranslation({ description: 'Un concerto.' }), { description: 'Un concerto.' });
  });

  test('no article means no translation, not an empty one', () => {
    assert.equal(parseTranslation({ title: 'Concerto' }), undefined);
    assert.equal(parseTranslation({ description: '   ' }), undefined);
    assert.equal(parseTranslation('nonsense'), undefined);
  });

  test('rejects a hallucinated CJK glyph, as the enrichment parser does', () => {
    // A model that slips into Chinese for one word used to reach the corpus.
    assert.equal(parseTranslation({ description: 'Un concerto 音楽 sul mare.' }), undefined);
  });
});

describe('makeTranslate', () => {
  const source = { title: 'Seaside Concert', description: 'A concert.\n\n## [tickets] Tickets\nFree.' };

  test('returns what the model produced for the asked language', async () => {
    const translate = makeTranslate(reply({ title: 'Concerto sul mare', description: 'Un concerto.' }));
    assert.deepEqual(await translate('it')(source), {
      title: 'Concerto sul mare',
      description: 'Un concerto.',
    });
  });

  test('names the target language in the request, so one prompt serves both', async () => {
    const seen: string[] = [];
    const chat: ChatFn = async (system, user) => {
      seen.push(`${system}\n${user}`);
      return JSON.stringify({ description: 'x' });
    };
    await makeTranslate(chat)('ru')(source);
    assert.ok(seen[0]?.includes('Russian'), seen[0]?.slice(0, 200));
    // The structure has to survive: the site styles sections by their tag.
    assert.ok(seen[0]?.includes('[tickets]'));
  });

  test('a provider failure is undefined, not a throw — the event simply retries', async () => {
    const failing: ChatFn = async () => {
      throw new Error('all llm providers failed: workers-ai=timeout');
    };
    assert.equal(await makeTranslate(failing)('it')(source), undefined);
  });

  test('an unusable answer is undefined too', async () => {
    assert.equal(await makeTranslate(reply({ nothing: true }))('it')(source), undefined);
  });
});
