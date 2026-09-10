// The archive: every page the site has ever published stays published.
//
// A shared link had to outlive the evening it pointed at, so a second copy of
// the record was kept — for 400 days, after which the page died anyway. And
// nothing ever listed those pages, so a crawler that had them forgot them.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { archiveEntry, mergedArchive } from '../src/pipeline/archive-index.ts';
import type { CompactEvent } from '../src/domain/event.ts';

const event = (id: string, s: string, t = `Event ${id}`): CompactEvent => ({
  id,
  t,
  s,
  c: ['music'],
  u: `https://example.org/${id}`,
  v: 'Teatro di Prova',
  cr: 1_700_000_000,
});

describe('archiveEntry', () => {
  test('keeps what an address is built from, and nothing else', () => {
    // The list is one KV value and it only ever grows, so it carries what a
    // sitemap needs to spell the URL — not the descriptions, which are three
    // languages of prose per event and would fill it in a season.
    assert.deepEqual(archiveEntry({ ...event('a', '2026-08-01'), e: '2026-08-03', ct: 'genova' }), {
      id: 'a',
      t: 'Event a',
      v: 'Teatro di Prova',
      s: '2026-08-01',
      e: '2026-08-03',
      ct: 'genova',
      cr: 1_700_000_000,
    });
  });

  test('an event with no venue and no end date carries neither', () => {
    const { v: _v, cr: _cr, ...bare } = event('b', '2026-08-01', 'Bare');
    assert.deepEqual(archiveEntry(bare), { id: 'b', t: 'Bare', s: '2026-08-01' });
  });
});

describe('mergedArchive', () => {
  const held = [archiveEntry(event('a', '2026-08-01'))];

  test('what left the feed today joins what left it before', () => {
    const next = mergedArchive(held, [event('b', '2026-08-02')]);
    assert.deepEqual(next.map((entry) => entry.id).toSorted(), ['a', 'b']);
  });

  test('an event that leaves twice is listed once', () => {
    // A re-collection can prune the same event on two consecutive runs; the
    // list would otherwise grow by a duplicate a day.
    const next = mergedArchive(held, [event('a', '2026-08-01'), event('a', '2026-08-01')]);
    assert.equal(next.length, 1);
  });

  test('the newest entry wins, so a corrected title reaches the address', () => {
    const next = mergedArchive(held, [event('a', '2026-08-01', 'Event a, corrected')]);
    assert.equal(next.at(0)?.t, 'Event a, corrected');
  });

  test('nothing pruned leaves the list exactly as it was', () => {
    assert.deepEqual(mergedArchive(held, []), held);
  });
});
