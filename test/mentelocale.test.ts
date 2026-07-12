// genoa-events design §4.2 — mentelocale collector on the live-captured fixture.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  makeMentelocaleCollector,
  parseMentelocaleHtml,
} from '../src/collectors/mentelocale.ts';
import { parseDateRange } from '../src/collectors/italian-dates.ts';

const html = readFileSync(
  join(import.meta.dirname, 'fixtures', 'mentelocale-list.html'),
  'utf8',
);

describe('parseDateRange — Italian "al" separator', () => {
  test('Dal … al … ranges', () => {
    assert.deepEqual(parseDateRange('Dal 09/07/2026 al 12/07/2026'), {
      startDate: '2026-07-09',
      endDate: '2026-07-12',
    });
  });
});

describe('parseMentelocaleHtml (fixture)', () => {
  test('extracts dated events with absolute detail urls', async () => {
    const events = await parseMentelocaleHtml(html, 'genova');
    assert.ok(events.length >= 10, `expected ≥10 events, got ${events.length}`);
    for (const event of events) {
      assert.match(event.startDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(event.url, /^https:\/\/www\.mentelocale\.it\/genova\//);
      assert.ok(event.title.length > 3);
      assert.equal(event.source, 'mentelocale');
    }
    const withImage = events.filter((event) => event.image !== undefined);
    assert.ok(withImage.length >= 5, 'expected card images');
    const ranged = events.find((event) => event.endDate !== undefined);
    assert.ok(ranged !== undefined, 'expected at least one multi-day event');
    const trincia = events.find((event) => event.title.includes('sette isole'));
    assert.ok(trincia !== undefined);
    assert.equal(trincia.startDate, '2026-07-06');
  });
});

describe('makeMentelocaleCollector', () => {
  test('reports failed on HTTP errors without throwing (AC-1.3)', async () => {
    const dead = async (): Promise<Response> => new Response('x', { status: 500 });
    const outcome = await makeMentelocaleCollector(dead, 'genova')();
    assert.equal(outcome.failed, true);
    assert.deepEqual(outcome.events, []);
  });
});
