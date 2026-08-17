// T2 — domain: normalization, id stability, merge semantics (AC-1.2, AC-1.4).
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  eventIdOf,
  freeFromPrice,
  hasCjk,
  mergeEvent,
  mergeRaw,
  normalizeTitle,
  parseEventRecord,
  parseIndex,
  containerSpan,
  parseSessions,
  withDerivedSpan,
  toCompact,
} from '../src/domain/event.ts';
import type { EventRecord, RawEvent, Session } from '../src/domain/event.ts';

const record: EventRecord = {
  id: 'abc123def456',
  title: 'Electropark Festival',
  startDate: '2026-07-10',
  categories: ['music'],
  descriptions: { en: 'Electronic music festival.', it: 'Festival.', ru: 'Фестиваль.' },
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
    // The other source's link is preserved (AC-1.8).
    assert.deepEqual(event.altLinks, [{ source: 'tg:genova', url: 'https://example.org' }]);
  });
  test('does not overwrite present fields; a known link adds nothing', () => {
    const withVenue: EventRecord = {
      ...record,
      venue: 'Teatro',
      altLinks: [{ source: 'tg:genova', url: 'https://example.org' }],
    };
    const { priceInfo: _dropped, ...noPrice } = incoming;
    const { event, changed } = mergeEvent(withVenue, noPrice);
    assert.equal(event.venue, 'Teatro');
    assert.equal(changed, false);
  });
  test('a re-sighting fills a photo onto an existing image-less link', () => {
    const withLink: EventRecord = {
      ...record,
      altLinks: [{ source: 'tg:genova', url: 'https://example.org' }],
    };
    const withImage: RawEvent = { ...incoming, image: 'https://img/new.jpg' };
    const { event, changed } = mergeEvent(withLink, withImage);
    assert.equal(changed, true); // the added photo must count as a change, or it is dropped
    assert.deepEqual(event.altLinks, [
      { source: 'tg:genova', url: 'https://example.org', image: 'https://img/new.jpg' },
    ]);
  });
});

describe('mergeRaw', () => {
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
  test('first sighting wins, gaps fill from the second', () => {
    const merged = mergeRaw(first, second);
    assert.equal(merged.url, 'https://a');
    assert.equal(merged.venue, 'Somewhere');
  });
  test("keeps the second source's link and dedupes across chains (AC-1.8)", () => {
    const merged = mergeRaw(first, second);
    assert.deepEqual(merged.altLinks, [{ source: 'tg:x', url: 'https://b' }]);
    const third = mergeRaw(merged, { ...second, source: 'mentelocale', url: 'https://c' });
    assert.deepEqual(third.altLinks, [
      { source: 'tg:x', url: 'https://b' },
      { source: 'mentelocale', url: 'https://c' },
    ]);
    assert.deepEqual(mergeRaw(merged, second).altLinks, [{ source: 'tg:x', url: 'https://b' }]);
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

describe('hasCjk', () => {
  test('flags a stray CJK/kana/hangul glyph, passes clean Latin/Cyrillic', () => {
    assert.equal(hasCjk({ en: 'ok', it: 'ok', ru: 'уже近 тут' }), true);
    assert.equal(hasCjk({ en: 'カ', it: 'ok', ru: 'ok' }), true);
    assert.equal(hasCjk({ en: 'A concert', it: 'Un concerto', ru: 'Концерт — всё чисто' }), false);
  });
});

describe('parseSessions / sessions round-trip', () => {
  test('keeps valid dated items, drops undated ones, projects to compact `p`', () => {
    const sessions = parseSessions([
      { date: '2026-07-15', time: '21:00', title: 'Concerto A' },
      { date: 'not-a-date', time: '20:00' }, // dropped
      { date: '2026-07-20' }, // date only
    ]);
    assert.deepEqual(sessions, [
      { date: '2026-07-15', time: '21:00', title: 'Concerto A' },
      { date: '2026-07-20' },
    ]);
    const compact = toCompact({ ...record, endDate: '2026-10-31', sessions });
    assert.deepEqual(compact.p, sessions);
    // The compact `p` round-trips back through parseEventRecord.
    const back = parseEventRecord(JSON.stringify({ ...record, endDate: '2026-10-31', p: sessions }));
    assert.deepEqual(back?.sessions, sessions);
    // …and, crucially, survives the compact-index read (parseIndex/parseCompact),
    // which serves events.json — reconstructing the object field-by-field once
    // silently dropped the programme even though the stored blob carried it.
    const fromIndex = parseIndex(JSON.stringify([compact]));
    assert.deepEqual(fromIndex?.[0]?.p, sessions);
  });

  test('a bad start time on a session is dropped, the date kept', () => {
    assert.deepEqual(parseSessions([{ date: '2026-07-15', time: '25:99' }]), [{ date: '2026-07-15' }]);
  });

  test('an empty or non-array programme is undefined', () => {
    assert.equal(parseSessions([]), undefined);
    assert.equal(parseSessions('nope'), undefined);
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
  test('durationMin and enrichVersion survive the round-trip (not stripped on read)', () => {
    const withMeta: EventRecord = { ...record, durationMin: 90, enrichVersion: 4 };
    const parsed = parseEventRecord(JSON.stringify(withMeta));
    assert.equal(parsed?.durationMin, 90);
    assert.equal(parsed?.enrichVersion, 4);
    assert.equal(toCompact(withMeta).du, 90);
  });
  test('a source link keeps its gallery image through the round-trip', () => {
    const withGallery: EventRecord = {
      ...record,
      altLinks: [{ source: 'genovateatro', url: 'https://g/x', image: 'https://img/g.jpg' }],
    };
    const parsed = parseEventRecord(JSON.stringify(withGallery));
    assert.equal(parsed?.altLinks?.[0]?.image, 'https://img/g.jpg');
  });
  test('index round-trip keeps compact fields', () => {
    const compact = toCompact({ ...record, endDate: '2026-07-12', free: true, time: '21:00' });
    const parsed = parseIndex(JSON.stringify([compact, { bad: true }]));
    assert.deepEqual(parsed, [compact]);
  });
  test('cr projects the first-seen addedAt and survives the index round-trip', () => {
    const compact = toCompact(record);
    assert.equal(compact.cr, record.addedAt); // 1_700_000_000
    const parsed = parseIndex(JSON.stringify([compact]));
    assert.equal(parsed?.[0]?.cr, record.addedAt);
  });
});

describe('event kind: containers vs standalone events', () => {
  // Deliberately out of order: the span must not depend on the source's ordering.
  const sessions: readonly Session[] = [
    { date: '2026-08-20', time: '21:00' },
    { date: '2026-08-05' },
    { date: '2026-08-12' },
  ];

  test('containerSpan is first..last session date, whatever order they arrive in', () => {
    assert.deepEqual(containerSpan(sessions), { startDate: '2026-08-05', endDate: '2026-08-20' });
  });

  test('containerSpan is undefined without a programme to derive it from', () => {
    assert.equal(containerSpan(undefined), undefined);
    assert.equal(containerSpan([]), undefined);
  });

  test('a container takes its span from the programme, not from the source', () => {
    const derived = withDerivedSpan({
      ...record,
      kind: 'container',
      startDate: '2026-06-01', // the marketing window the source advertised
      endDate: '2026-09-30',
      sessions,
    });
    assert.equal(derived.startDate, '2026-08-05');
    assert.equal(derived.endDate, '2026-08-20');
  });

  test('a single-session container collapses to one day, with no end date', () => {
    const derived = withDerivedSpan({
      ...record,
      kind: 'container',
      sessions: [{ date: '2026-08-05' }],
    });
    assert.equal(derived.startDate, '2026-08-05');
    assert.equal(derived.endDate, undefined);
  });

  test('a standalone event keeps its own span even when it lists sessions', () => {
    const standalone = { ...record, startDate: '2026-06-01', endDate: '2026-09-30', sessions };
    assert.deepEqual(withDerivedSpan(standalone), standalone);
  });

  test('a container with no sessions is left alone rather than guessed at', () => {
    const bare = { ...record, kind: 'container' as const, startDate: '2026-06-01' };
    assert.deepEqual(withDerivedSpan(bare), bare);
  });

  test('the kind round-trips through the record and the compact index', () => {
    const container = { ...record, kind: 'container' as const, sessions };
    assert.equal(toCompact(container).k, true);
    assert.equal(toCompact(record).k, undefined); // standalone stays unmarked
    assert.equal(parseEventRecord(JSON.stringify(container))?.kind, 'container');
    assert.equal(parseIndex(JSON.stringify([toCompact(container)]))?.[0]?.k, true);
    assert.equal(parseIndex(JSON.stringify([toCompact(record)]))?.[0]?.k, undefined);
  });

  test('a junk kind reads as standalone — a bad value must never hide an event', () => {
    assert.equal(parseEventRecord(JSON.stringify({ ...record, kind: 'nonsense' }))?.kind, undefined);
  });
});
