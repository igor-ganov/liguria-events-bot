// What the bot shows depends on where the reader is. Without this every list
// was the whole country: a person in Genova got a market in Bari.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { eventsInPlace } from '../src/pipeline/place-filter.ts';
import type { CompactEvent } from '../src/domain/event.ts';

const event = (id: string, place?: Readonly<{ ct: string; rg: string }>): CompactEvent => ({
  id,
  t: `Event ${id}`,
  s: '2026-09-12',
  c: ['music'],
  u: `https://example.org/${id}`,
  ...(place ?? {}),
});

const index = [
  event('a', { ct: 'genova', rg: 'liguria' }),
  event('b', { ct: 'savona', rg: 'liguria' }),
  event('c', { ct: 'milano', rg: 'lombardia' }),
  event('d'),
];

describe('eventsInPlace', () => {
  test('a city keeps that city alone', () => {
    assert.deepEqual(eventsInPlace(index, 'city:genova').map((e) => e.id), ['a']);
  });

  test('a region keeps every city in it', () => {
    assert.deepEqual(eventsInPlace(index, 'region:liguria').map((e) => e.id), ['a', 'b']);
  });

  test('everywhere keeps everything, including what was never located', () => {
    // An event the geocoder could not place still belongs in an unfiltered
    // list; dropping it would hide a real event because of our own gap.
    assert.deepEqual(eventsInPlace(index, '').map((e) => e.id), ['a', 'b', 'c', 'd']);
  });

  test('a place with nothing on returns nothing, rather than everything', () => {
    // The failure that matters: a filter that falls back to the whole country
    // when it matches nothing is worse than an empty list, because it looks
    // like it worked.
    assert.deepEqual(eventsInPlace(index, 'city:bari'), []);
  });
});
