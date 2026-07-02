// T2 — domain: normalization, id stability, merge semantics (AC-1.2, AC-1.4).
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  eventIdOf,
  freeFromPrice,
  mergeEvent,
  mergeRaw,
  normalizeTitle,
  parseEventRecord,
  parseIndex,
  toCompact,
} from '../src/domain/event.ts';
import type { EventRecord, RawEvent } from '../src/domain/event.ts';

const record: EventRecord = {
  id: 'abc123def456',
  title: 'Electropark Festival',
  startDate: '2026-07-10',
  category: 'music',
  description: 'Electronic music festival.',
  url: 'https://www.visitgenoa.it/en/node/26370',
  source: 'visitgenoa',
  enriched: true,
  addedAt: 1_700_000_000,
};

describe('normalizeTitle', () => {
  test('lowercases, strips accents and punctuation', () => {
    assert.equal(normalizeTitle('Città dei Bambini — «Estate»!'), 'citta dei bambini estate');
  });
  test('collapses whitespace', () => {
    assert.equal(normalizeTitle('  A   B  '), 'a b');
  });
});

describe('eventIdOf', () => {
  test('is stable for equivalent titles', async () => {
    const a = await eventIdOf('Electropark  Festival!', '2026-07-10');
    const b = await eventIdOf('electropark festival', '2026-07-10');
    assert.equal(a, b);
    assert.equal(a.length, 12);
  });
  test('differs across dates', async () => {
    const a = await eventIdOf('Electropark', '2026-07-10');
    const b = await eventIdOf('Electropark', '2026-07-11');
    assert.notEqual(a, b);
  });
});

describe('mergeEvent', () => {
  const incoming: RawEvent = {
    title: 'Electropark Festival',
    startDate: '2026-07-10',
    venue: 'Porto Antico',
    priceInfo: 'ingresso gratuito',
    url: 'https://example.org',
    source: 'tg:genova',
  };
  test('fills gaps only and reports the change', () => {
    const { event, changed } = mergeEvent(record, incoming);
    assert.equal(changed, true);
    assert.equal(event.venue, 'Porto Antico');
    assert.equal(event.free, true);
    assert.equal(event.url, record.url); // existing fields never overwritten
    assert.equal(event.source, record.source);
  });
  test('does not overwrite present fields', () => {
    const withVenue: EventRecord = { ...record, venue: 'Teatro' };
    const { priceInfo: _dropped, ...noPrice } = incoming;
    const { event, changed } = mergeEvent(withVenue, noPrice);
    assert.equal(event.venue, 'Teatro');
    assert.equal(changed, false);
  });
});

describe('mergeRaw', () => {
  test('first sighting wins, gaps fill from the second', () => {
    const first: RawEvent = {
      title: 'A',
      startDate: '2026-07-10',
      url: 'https://a',
      source: 'visitgenoa',
    };
    const second: RawEvent = {
      title: 'A!',
      startDate: '2026-07-10',
      venue: 'Somewhere',
      url: 'https://b',
      source: 'tg:x',
    };
    const merged = mergeRaw(first, second);
    assert.equal(merged.url, 'https://a');
    assert.equal(merged.venue, 'Somewhere');
  });
});

describe('freeFromPrice', () => {
  test('detects free wording', () => {
    assert.equal(freeFromPrice('Ingresso gratuito'), true);
    assert.equal(freeFromPrice('ingresso libero'), true);
    assert.equal(freeFromPrice('Biglietto € 15,00'), false);
    assert.equal(freeFromPrice(undefined), false);
  });
});

describe('parseEventRecord / toCompact / parseIndex', () => {
  test('record survives a JSON round-trip', () => {
    const parsed = parseEventRecord(JSON.stringify(record));
    assert.deepEqual(parsed, record);
  });
  test('rejects malformed records', () => {
    assert.equal(parseEventRecord('{"id":"x"}'), undefined);
    assert.equal(parseEventRecord('not json'), undefined);
  });
  test('index round-trip keeps compact fields', () => {
    const compact = toCompact({ ...record, endDate: '2026-07-12', free: true, time: '21:00' });
    const parsed = parseIndex(JSON.stringify([compact, { bad: true }]));
    assert.deepEqual(parsed, [compact]);
  });
});
