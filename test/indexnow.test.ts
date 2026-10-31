// IndexNow tells Bing, Yandex and Seznam about a new page the moment it exists,
// and needs no account anywhere — which matters, because Bing Webmaster Tools
// is the one channel still waiting on somebody to log in.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { newSince } from '../src/indexnow/new-since.ts';
import { eventUrls } from '../src/indexnow/event-urls.ts';
import { placeUrls } from '../src/indexnow/place-urls.ts';
import { placeSweep } from '../src/indexnow/place-sweep.ts';
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
      'https://dovego.it/en/event/concerto-in-cortile-palazzo-spinola-2026-12-05-aaaabbbbcccc/',
      'https://dovego.it/it/event/concerto-in-cortile-palazzo-spinola-2026-12-05-aaaabbbbcccc/',
      'https://dovego.it/ru/event/concerto-in-cortile-palazzo-spinola-2026-12-05-aaaabbbbcccc/',
    ]);
  });
});

describe('placeUrls', () => {
  // Until now IndexNow was offered event pages and nothing else, so the pages
  // that can actually rank for "cosa fare a Genova" — the city, its three
  // facets, the venue with a programme — were never announced to the one
  // engine that sends this site every search visit it gets.
  const located = (over: Partial<CompactEvent> = {}): CompactEvent =>
    ({ ...compact(), ct: 'genova', rg: 'liguria', v: 'Teatro Carlo Felice', ...over });

  test('a new event announces the pages it appears on, not just its own', () => {
    assert.deepEqual(placeUrls([located()]), [
      'https://dovego.it/it/liguria/genova/',
      'https://dovego.it/it/liguria/genova/today/',
      'https://dovego.it/it/liguria/genova/tomorrow/',
      'https://dovego.it/it/liguria/genova/this-weekend/',
      'https://dovego.it/it/liguria/genova/teatro-carlo-felice/',
    ]);
  });

  test('two events in one city announce that city once', () => {
    const urls = placeUrls([located(), located({ v: 'Teatro Carlo Felice' })]);
    assert.equal(urls.filter((url) => url.endsWith('/genova/')).length, 1);
  });

  test('an event the geocoder could not place announces nothing', () => {
    const { ct: _city, ...unplaced } = located();
    const { rg: _region, ...regionless } = located();
    assert.deepEqual(placeUrls([unplaced]), []);
    assert.deepEqual(placeUrls([regionless]), []);
  });

  test('a venue that is really the city, or a facet word, is not a venue page', () => {
    // The crawler fills the venue with the city's own name often enough to
    // matter, and a venue slug that collides with a facet would announce the
    // facet twice under a different meaning.
    const asCity = placeUrls([located({ v: 'Genova' })]);
    assert.equal(asCity.length, 4);
    const asFacet = placeUrls([located({ v: 'Today' })]);
    assert.equal(asFacet.length, 4);
  });

  test('it is bounded, because a submission that is too large is refused', () => {
    const many = Array.from({ length: 40 }, (_, i) => located({ ct: `city${i}` }));
    assert.ok(placeUrls(many).length <= 60);
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
    // The watermark does not move, because nothing new was said.
    const { binding, store } = kv({ 'indexnow:watermark': '150' });
    const seen: { body?: unknown } = {};
    await pingIndexNow(env('k123', binding), index, NOW, answering(200, seen));
    assert.equal(store.get('indexnow:watermark'), '150');
    const list = readProp(seen.body, 'urlList');
    assert.equal(
      (Array.isArray(list) ? list : []).some((url) => String(url).includes('/event/')),
      false,
    );
  });

  test('an hour with no new event re-announces the pages that change by themselves', async () => {
    // "What is on today" is a different page every morning with no event
    // added anywhere, and in ten days neither bingbot nor Googlebot fetched a
    // single facet page: announcing them only when an event appears in that
    // city was never going to reach them.
    const placed: CompactEvent = { ...compact({ addedAt: 150 }), rg: 'liguria', ct: 'genova' };
    const { binding, store } = kv({ 'indexnow:watermark': '150' });
    const seen: { body?: unknown } = {};
    const result = await pingIndexNow(env('k123', binding), [placed], NOW, answering(200, seen));
    assert.equal(readProp(result, 'kind'), 'swept');
    const list = readProp(seen.body, 'urlList');
    assert.deepEqual(Array.isArray(list) ? list : [], [
      'https://dovego.it/it/liguria/genova/',
      'https://dovego.it/it/liguria/genova/today/',
      'https://dovego.it/it/liguria/genova/tomorrow/',
      'https://dovego.it/it/liguria/genova/this-weekend/',
    ]);
    assert.equal(store.get('indexnow:place-cursor'), '0');
  });

  test('a swept batch that is refused leaves the cursor where it was', async () => {
    const placed: CompactEvent = { ...compact({ addedAt: 150 }), rg: 'liguria', ct: 'genova' };
    const { binding, store } = kv({ 'indexnow:watermark': '150', 'indexnow:place-cursor': '2' });
    const result = await pingIndexNow(env('k123', binding), [placed], NOW, answering(422, {}));
    assert.equal(readProp(result, 'kind'), 'refused');
    assert.equal(store.get('indexnow:place-cursor'), '2');
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

describe('placeSweep', () => {
  const city = (id: string, region: string, name: string): CompactEvent =>
    ({ ...compact({ id }), rg: region, ct: name });

  const corpus = [city('aaaabbbbccc1', 'liguria', 'genova'), city('aaaabbbbccc2', 'lombardia', 'milano')];

  test('offers a city and its three time facets, in a stable order', () => {
    assert.deepEqual(placeSweep(corpus, 0, 4).urls, [
      'https://dovego.it/it/liguria/genova/',
      'https://dovego.it/it/liguria/genova/today/',
      'https://dovego.it/it/liguria/genova/tomorrow/',
      'https://dovego.it/it/liguria/genova/this-weekend/',
    ]);
  });

  test('picks up where the last hour stopped', () => {
    const { urls, next } = placeSweep(corpus, 4, 2);
    assert.deepEqual(urls, ['https://dovego.it/it/lombardia/milano/', 'https://dovego.it/it/lombardia/milano/today/']);
    assert.equal(next, 6);
  });

  test('and wraps round, so every city is offered again rather than once', () => {
    const { urls, next } = placeSweep(corpus, 7, 2);
    assert.deepEqual(urls, [
      'https://dovego.it/it/lombardia/milano/this-weekend/',
      'https://dovego.it/it/liguria/genova/',
    ]);
    assert.equal(next, 1);
  });

  test('an event with no city of its own is not a place', () => {
    assert.deepEqual(placeSweep([compact({ id: 'aaaabbbbccc3' })], 0, 4), { urls: [], next: 0 });
  });
});
