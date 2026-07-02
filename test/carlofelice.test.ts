// genoa-events design §4.6 — Teatro Carlo Felice collector on the live fixture.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  makeCarlofeliceCollector,
  parseCarlofeliceHtml,
} from '../src/collectors/carlofelice.ts';
import { parseSeasonDate } from '../src/collectors/italian-dates.ts';

const html = readFileSync(
  join(import.meta.dirname, 'fixtures', 'carlofelice-list.html'),
  'utf8',
);

describe('parseSeasonDate', () => {
  test('shared-month range', () => {
    assert.deepEqual(parseSeasonDate('Dal 16 al 25 ottobre 2026'), {
      startDate: '2026-10-16',
      endDate: '2026-10-25',
    });
  });
  test("elided Dall' range", () => {
    assert.deepEqual(parseSeasonDate('Dall’11 al 13 dicembre 2026'), {
      startDate: '2026-12-11',
      endDate: '2026-12-13',
    });
  });
  test('single full-month date', () => {
    assert.deepEqual(parseSeasonDate('22 ottobre 2026'), { startDate: '2026-10-22' });
    assert.deepEqual(parseSeasonDate('1 gennaio 2027'), { startDate: '2027-01-01' });
  });
  test('garbage → undefined', () => {
    assert.equal(parseSeasonDate('prossimamente'), undefined);
  });
});

describe('parseCarlofeliceHtml (fixture)', () => {
  test('extracts dated season shows at the opera house, deduped', async () => {
    const events = await parseCarlofeliceHtml(html);
    assert.ok(events.length >= 10, `expected ≥10 shows, got ${events.length}`);
    const urls = new Set(events.map((event) => event.url));
    assert.equal(urls.size, events.length); // no slider duplicates
    for (const event of events) {
      assert.match(event.startDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(event.url, /operacarlofelicegenova\.it\/spettacolo\//);
      assert.equal(event.source, 'carlofelice');
      assert.equal(event.venue, 'Teatro Carlo Felice');
      assert.equal(event.categoryHint, 'music');
    }
    const figaro = events.find((event) => event.title.includes('NOZZE DI FIGARO'));
    assert.ok(figaro !== undefined);
    assert.equal(figaro.startDate, '2026-10-16');
    assert.equal(figaro.endDate, '2026-10-25');
  });
});

describe('makeCarlofeliceCollector', () => {
  test('reports failed on errors without throwing (AC-1.3)', async () => {
    const dead = async (): Promise<Response> => new Response('x', { status: 500 });
    const outcome = await makeCarlofeliceCollector(dead)();
    assert.equal(outcome.failed, true);
  });
});
