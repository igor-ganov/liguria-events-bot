// Geocoding is a pass of its own, budgeted by wall clock and keyed by ADDRESS,
// not by event. The regressions it guards: a free-text "Città Vecchia, Genova"
// resolves to the old town of TRIESTE, and one such point dragged the map's
// opening bounds across half of Italy.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { distanceKm, misplaced, needsPoint, pendingJobs, runGeocode } from '../src/pipeline/geocode.ts';
import type { CompactEvent } from '../src/domain/event.ts';

const GENOVA = { lat: 44.4056, lng: 8.9463 };
const TRIESTE = { lat: 45.6472, lng: 13.7641 };

const event = (over: Partial<CompactEvent> & Pick<CompactEvent, 'id'>): CompactEvent => ({
  t: 'x',
  s: '2026-07-20',
  c: ['other'],
  u: `https://x/${over.id}`,
  ct: 'genova',
  ...over,
});

describe('misplaced', () => {
  test('a Genoa address answered with Trieste is refused', () => {
    assert.equal(misplaced('genova', TRIESTE), true);
    assert.equal(misplaced('genova', { lat: 44.41, lng: 8.95 }), false);
  });
  test('an unknown city cannot judge, so it accepts', () => {
    assert.equal(misplaced('atlantis', TRIESTE), false);
  });
  test('distance separates the two cities by hundreds of km', () => {
    assert.ok(distanceKm(GENOVA, TRIESTE) > 350);
  });
});

describe('needsPoint', () => {
  test('an event with no address is not geocodable', () => {
    assert.equal(needsPoint(event({ id: 'a' })), false);
  });
  test('an event with an address and no point is', () => {
    assert.equal(needsPoint(event({ id: 'a', a: 'Teatro, Genova' })), true);
  });
  test('a good point is left alone', () => {
    assert.equal(needsPoint(event({ id: 'a', a: 'Teatro, Genova', g: [44.41, 8.95] })), false);
  });
  test('a point in the wrong city is not left alone', () => {
    assert.equal(
      needsPoint(event({ id: 'a', a: 'Città Vecchia, Genova', g: [TRIESTE.lat, TRIESTE.lng] })),
      true,
    );
  });
});

describe('pendingJobs', () => {
  test('events sharing a venue share one lookup', () => {
    const jobs = pendingJobs([
      event({ id: 'a', a: 'Teatro della Tosse, Genova' }),
      event({ id: 'b', a: 'Teatro della Tosse, Genova' }),
      event({ id: 'c', a: 'Palazzo Ducale, Genova' }),
    ]);
    assert.equal(jobs.length, 2, 'two addresses, not three events');
    assert.deepEqual(jobs[0]?.ids, ['a', 'b']);
  });
});

// A KV stub: distinct keys per address, so no write contention — the very thing
// that made the old per-event design answer 429 and take the crawl down.
const makeKv = (seed: Record<string, string> = {}) => {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    kv: {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => void store.set(key, value),
      delete: async (key: string) => void store.delete(key),
      list: async () => ({ keys: [], list_complete: true as const }),
    },
    store,
  };
};

const indexKey = 'events:index';
const recordKey = (id: string): string => `event:${id}`;

const record = (id: string, over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    id,
    title: 'x',
    startDate: '2026-07-20',
    categories: ['other'],
    descriptions: { en: 'd', it: 'd', ru: 'd' },
    url: `https://x/${id}`,
    source: 's',
    city: 'genova',
    address: 'Teatro della Tosse, Genova',
    enriched: true,
    addedAt: 1,
    ...over,
  });

describe('runGeocode', () => {
  test('resolves one address and points every event on it', async () => {
    const { kv, store } = makeKv({
      [indexKey]: JSON.stringify([
        event({ id: 'a', a: 'Teatro della Tosse, Genova' }),
        event({ id: 'b', a: 'Teatro della Tosse, Genova' }),
      ]),
      [recordKey('a')]: record('a'),
      [recordKey('b')]: record('b'),
    });
    const fetchFn = async (): Promise<Response> =>
      Response.json([{ lat: '44.4100', lon: '8.9300' }]);
    const summary = await runGeocode({ kv, fetchFn, now: () => 0, budgetMs: 10_000 });
    assert.equal(summary.pending, 1, 'one address');
    assert.equal(summary.resolved, 1);
    const index = JSON.parse(store.get(indexKey) ?? '[]') as CompactEvent[];
    assert.deepEqual(index.map((e) => e.g), [[44.41, 8.93], [44.41, 8.93]]);
  });

  test('erases a point that landed in the wrong city', async () => {
    const { kv, store } = makeKv({
      [indexKey]: JSON.stringify([
        event({ id: 'a', a: 'Città Vecchia, Genova', g: [TRIESTE.lat, TRIESTE.lng] }),
      ]),
      [recordKey('a')]: record('a', {
        address: 'Città Vecchia, Genova',
        lat: TRIESTE.lat,
        lng: TRIESTE.lng,
      }),
    });
    // Bounded to Genoa now, Nominatim finds nothing — better no pin than a pin
    // in Trieste.
    const fetchFn = async (): Promise<Response> => Response.json([]);
    const summary = await runGeocode({ kv, fetchFn, now: () => 0, budgetMs: 10_000 });
    assert.equal(summary.cleared, 1);
    const index = JSON.parse(store.get(indexKey) ?? '[]') as CompactEvent[];
    assert.equal(index[0]?.g, undefined);
  });

  test('a spent budget stops the pass instead of the clock stopping the worker', async () => {
    const { kv } = makeKv({
      [indexKey]: JSON.stringify([
        event({ id: 'a', a: 'One, Genova' }),
        event({ id: 'b', a: 'Two, Genova' }),
      ]),
      [recordKey('a')]: record('a'),
      [recordKey('b')]: record('b'),
    });
    let calls = 0;
    const fetchFn = async (): Promise<Response> => {
      calls += 1;
      return Response.json([{ lat: '44.41', lon: '8.93' }]);
    };
    let clock = 0;
    const summary = await runGeocode({
      kv,
      fetchFn,
      now: () => (clock += 5_000),
      budgetMs: 1,
    });
    assert.equal(calls, 0, 'the budget was spent before the first lookup');
    assert.equal(summary.pending, 2);
  });
});
