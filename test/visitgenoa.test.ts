// T5 — visitgenoa parsing against the live-captured fixtures (AC-1.1, AC-1.4).
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decodeEntities,
  makeVisitgenoaCollector,
  mapCategoryHint,
  parseDateRange,
  parseDetailHtml,
  parseListingHtml,
  stripLeadingDateRange,
} from '../src/collectors/visitgenoa.ts';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

describe('parseDateRange', () => {
  test('range', () => {
    assert.deepEqual(parseDateRange('01/07/2026 - 31/08/2026'), {
      startDate: '2026-07-01',
      endDate: '2026-08-31',
    });
  });
  test('single day', () => {
    assert.deepEqual(parseDateRange('01/07/2026'), { startDate: '2026-07-01' });
  });
  test('same-day range collapses', () => {
    assert.deepEqual(parseDateRange('01/07/2026 - 01/07/2026'), { startDate: '2026-07-01' });
  });
  test('garbage → undefined', () => {
    assert.equal(parseDateRange('no dates here'), undefined);
  });
});

describe('mapCategoryHint', () => {
  test('specific labels beat generic', () => {
    assert.equal(mapCategoryHint('CULTURA, MOSTRE'), 'art');
    assert.equal(mapCategoryHint('MUSICA E SPETTACOLO'), 'music');
    assert.equal(mapCategoryHint('BAMBINI E FAMIGLIA, TOUR'), 'family');
    assert.equal(mapCategoryHint('CULTURA'), 'culture');
  });
  test('unknown → undefined', () => {
    assert.equal(mapCategoryHint('EVENTI TOP'), undefined);
  });
});

describe('stripLeadingDateRange / decodeEntities', () => {
  test('removes the date span and decodes entities', () => {
    assert.equal(
      stripLeadingDateRange('01/02/2026 - 31/12/2026 Ventennale &quot;Rolli&quot;'),
      'Ventennale "Rolli"',
    );
    assert.equal(decodeEntities('Festival dell&#039;Acquedotto'), "Festival dell'Acquedotto");
  });
});

describe('parseListingHtml (fixture)', () => {
  test('extracts dated events with absolute urls and hints', async () => {
    const events = await parseListingHtml(fixture('visitgenoa-list.html'));
    assert.ok(events.length >= 10, `expected ≥10 events, got ${events.length}`);
    for (const event of events) {
      assert.match(event.startDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(event.url, /^https:\/\/www\.visitgenoa\.it\/en\/node\/\d+$/);
      assert.ok(event.title.length > 3);
      assert.equal(event.source, 'visitgenoa');
    }
    const unesco = events.find((event) => event.title.includes('Ventennale'));
    assert.ok(unesco !== undefined);
    assert.equal(unesco.startDate, '2026-02-01');
    assert.equal(unesco.endDate, '2026-12-31');
    assert.equal(unesco.categoryHint, 'culture');
  });
});

describe('parseDetailHtml (fixture)', () => {
  test('extracts venue, time and price', async () => {
    const details = await parseDetailHtml(fixture('visitgenoa-detail.html'));
    assert.equal(details.venue, 'Diocesan Museum');
    assert.equal(details.time, '17:30');
    assert.ok(details.priceInfo !== undefined && details.priceInfo.includes('15,00'));
    assert.ok(details.rawDescription !== undefined && details.rawDescription.length > 50);
  });
});

describe('makeVisitgenoaCollector', () => {
  test('marks the source failed only when every page fails (AC-1.3)', async () => {
    const listing = fixture('visitgenoa-list.html');
    const flaky = async (input: string): Promise<Response> =>
      input.endsWith('page=0')
        ? new Response(listing)
        : new Response('nope', { status: 500 });
    const outcome = await makeVisitgenoaCollector(flaky, 2)();
    assert.equal(outcome.failed, false);
    assert.ok(outcome.events.length >= 10);

    const dead = async (): Promise<Response> => new Response('nope', { status: 500 });
    const failed = await makeVisitgenoaCollector(dead, 2)();
    assert.equal(failed.failed, true);
    assert.deepEqual(failed.events, []);
  });
});
