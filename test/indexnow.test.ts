// IndexNow tells Bing, Yandex and Seznam about a new page the moment it exists,
// and needs no account anywhere — which matters, because Bing Webmaster Tools
// is the one channel still waiting on somebody to log in.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { newSince } from '../src/indexnow/new-since.ts';
import { eventUrls } from '../src/indexnow/event-urls.ts';
import { indexNowBody } from '../src/indexnow/index-now-body.ts';
import { pingIndexNow } from '../src/indexnow/ping-index-now.ts';
import { readProp } from '../src/util/json.ts';
import type { Env } from '../src/config.ts';
import type { KvLike } from '../src/pipeline/store.ts';
import type { FetchFn } from '../src/util/http.ts';
import { toCompact } from '../src/domain/event.ts';
import type { CompactEvent, EventRecord } from '../src/domain/event.ts';

const base: EventRecord = {
  id: 'aaaabbbbcccc',
  title: 'Concerto',
  startDate: '2026-09-01',
  categories: ['music'],
  descriptions: { en: 'A concert.', it: 'Un concerto.', ru: 'Концерт.' },
  url: 'https://example.org',
  source: 'visitgenoa',
  enriched: true,
  addedAt: 100,
};

const compact = (over: Partial<EventRecord> = {}): CompactEvent => toCompact({ ...base, ...over });

describe('newSince', () => {
  test('takes what was added after the watermark, and nothing else', () => {
    const events = [
      compact({ id: 'old', addedAt: 50 }),
      compact({ id: 'same', addedAt: 100 }),
      compact({ id: 'new', addedAt: 150 }),
    ];
    assert.deepEqual(newSince(events, 100).map((one) => one.id), ['new']);
  });

  test('a first run submits everything it can, not nothing', () => {
    const events = [compact({ id: 'a', addedAt: 50 }), compact({ id: 'b', addedAt: 150 })];
    assert.equal(newSince(events, 0).length, 2);
  });

  test('caps a run: 900 URLs in one submission came back 429', () => {
    const events = Array.from({ length: 500 }, (_, i) => compact({ id: `e${i}`, addedAt: 200 + i }));
    assert.equal(newSince(events, 0, 100).length, 100);
    assert.equal(newSince(events, 0).length, 50);
  });

  test('takes the oldest first, so the backlog drains in order', () => {
    const events = [compact({ id: 'later', addedAt: 300 }), compact({ id: 'sooner', addedAt: 200 })];
    assert.deepEqual(newSince(events, 0, 1).map((one) => one.id), ['sooner']);
  });
});

describe('eventUrls', () => {
  test('submits every locale the page is actually built in', () => {
    // The address the page answers at, not a bare id that only redirects to it.
    const event = { id: 'aaaabbbbcccc', t: 'Concerto in cortile', s: '2026-12-05', v: 'Palazzo Spinola' };
    assert.deepEqual(eventUrls(event), [
      'https://dovego.it/event/concerto-in-cortile-palazzo-spinola-2026-12-05-aaaabbbbcccc/',
      'https://dovego.it/it/event/concerto-in-cortile-palazzo-spinola-2026-12-05-aaaabbbbcccc/',
      'https://dovego.it/ru/event/concerto-in-cortile-palazzo-spinola-2026-12-05-aaaabbbbcccc/',
    ]);
  });
});

describe('indexNowBody', () => {
  test('carries the host, the key and where the key is proven', () => {
    const body = indexNowBody('k123', ['https://dovego.it/event/a/']);
    assert.equal(body.host, 'dovego.it');
    assert.equal(body.key, 'k123');
    assert.equal(body.keyLocation, 'https://dovego.it/k123.txt');
    assert.deepEqual(body.urlList, ['https://dovego.it/event/a/']);
  });
});

describe('pingIndexNow', () => {
  const NOW = 1_800_000_000_000;
  const index = [compact({ id: 'aaaabbbbcccc', addedAt: 150 })];

  const kv = (seed: Readonly<Record<string, string>>) => {
    const store = new Map(Object.entries(seed));
    const binding: KvLike = {
      get: async (key) => store.get(key) ?? null,
      put: async (key, value) => {
        store.set(key, value);
      },
      delete: async (key) => {
        store.delete(key);
      },
      list: async () => ({ keys: [], list_complete: true }),
    };
    return { store, binding };
  };

  const env = (key: string, binding: KvLike): Env => ({
    EVENTS: binding,
    AI: { run: async () => ({}) },
    BOT_TOKEN: '',
    WEBHOOK_SECRET: '',
    OWNER_CHAT_ID: '',
    INDEXNOW_KEY: key,
  });

  const answering = (status: number, seen: { body?: unknown }): FetchFn => async (_input, init) => {
    seen.body = JSON.parse(String(init?.body ?? '{}'));
    return new Response('', { status });
  };

  test('the first run starts the clock instead of offering the whole corpus', async () => {
    // 1 182 events x 3 locales is not a submission, it is a flood — and the
    // first attempt was answered 429, which would then repeat hourly for ever.
    const { binding, store } = kv({});
    const seen: { body?: unknown } = {};
    const result = await pingIndexNow(env('k123', binding), index, NOW, answering(200, seen));
    assert.deepEqual(result, { kind: 'primed', from: 150 });
    assert.equal(seen.body, undefined);
    assert.equal(store.get('indexnow:watermark'), '150');
  });

  test('an empty corpus on the first run primes at zero rather than -Infinity', async () => {
    const { binding, store } = kv({});
    await pingIndexNow(env('k123', binding), [], NOW, answering(200, {}));
    assert.equal(store.get('indexnow:watermark'), '0');
  });

  test('with no key configured it does nothing at all', async () => {
    const { binding } = kv({});
    assert.deepEqual(await pingIndexNow(env('', binding), index, NOW), { kind: 'off' });
  });

  test('submits every locale of a new event and remembers how far it got', async () => {
    const { binding, store } = kv({ 'indexnow:watermark': '100' });
    const seen: { body?: unknown } = {};
    const result = await pingIndexNow(env('k123', binding), index, NOW, answering(200, seen));
    assert.deepEqual(result, { kind: 'submitted', urls: 3, status: 200 });
    assert.equal(store.get('indexnow:watermark'), '150');
  });

  test('says nothing twice about the same event', async () => {
    const { binding } = kv({ 'indexnow:watermark': '150' });
    assert.deepEqual(await pingIndexNow(env('k123', binding), index, NOW), { kind: 'nothing-new' });
  });

  test('a refused batch is retried, not silently lost', async () => {
    // The watermark is the only record of what has been said; moving it past a
    // rejection would drop those URLs for good.
    const { binding, store } = kv({ 'indexnow:watermark': '100' });
    const seen: { body?: unknown } = {};
    const result = await pingIndexNow(env('k123', binding), index, NOW, answering(422, seen));
    assert.equal(readProp(result, 'kind'), 'refused');
    assert.equal(store.get('indexnow:watermark'), '100');
  });
});

describe('pingIndexNow backs off', () => {
  const NOW = 1_800_000_000_000;
  const index = [compact({ id: 'aaaabbbbcccc', addedAt: 150 })];

  const kv = (seed: Readonly<Record<string, string>>) => {
    const store = new Map(Object.entries(seed));
    const binding: KvLike = {
      // `null` because Cloudflare's KV answers a missing key with it, and the
      // double has to satisfy the same contract as the real binding.
      get: async (key) => store.get(key) ?? null,
      put: async (key, value) => {
        store.set(key, value);
      },
      delete: async (key) => {
        store.delete(key);
      },
      list: async () => ({ keys: [], list_complete: true }),
    };
    return { store, binding };
  };

  const env = (binding: KvLike): Env => ({
    EVENTS: binding,
    AI: { run: async () => ({}) },
    BOT_TOKEN: '',
    WEBHOOK_SECRET: '',
    OWNER_CHAT_ID: '',
    INDEXNOW_KEY: 'k123',
  });

  const answering = (status: number): FetchFn => async () => new Response('', { status });

  test('202 is acceptance — a key nobody has read yet gets exactly that', async () => {
    const { binding, store } = kv({ 'indexnow:watermark': '100' });
    const result = await pingIndexNow(env(binding), index, NOW, answering(202));
    assert.equal(readProp(result, 'kind'), 'submitted');
    assert.equal(store.get('indexnow:watermark'), '150');
  });

  test('a 429 stops the hourly retry that keeps a throttled host throttled', async () => {
    const { binding, store } = kv({ 'indexnow:watermark': '100' });
    const result = await pingIndexNow(env(binding), index, NOW, answering(429));
    assert.equal(readProp(result, 'kind'), 'throttled');
    assert.equal(Number(store.get('indexnow:retry-after')), NOW + 6 * 60 * 60 * 1000);
    assert.equal(store.get('indexnow:watermark'), '100');
  });

  test('while cooling off it does not even ask', async () => {
    const { binding } = kv({ 'indexnow:watermark': '100', 'indexnow:retry-after': String(NOW + 1000) });
    const refusing: FetchFn = async () => {
      throw new Error('should not have been called');
    };
    assert.equal(readProp(await pingIndexNow(env(binding), index, NOW, refusing), 'kind'), 'cooling-off');
  });

  test('once the cooldown has passed it tries again', async () => {
    const { binding } = kv({ 'indexnow:watermark': '100', 'indexnow:retry-after': String(NOW - 1) });
    const result = await pingIndexNow(env(binding), index, NOW, answering(200));
    assert.equal(readProp(result, 'kind'), 'submitted');
  });
});
