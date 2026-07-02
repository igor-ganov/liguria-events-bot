// genoa-events design §4.4 — palazzoducale collector on the live-captured fixture.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  makePalazzoducaleCollector,
  mapDucaleType,
  parsePalazzoducaleHtml,
} from '../src/collectors/palazzoducale.ts';
import { parseItalianDateInfo } from '../src/collectors/italian-dates.ts';

const html = readFileSync(
  join(import.meta.dirname, 'fixtures', 'palazzoducale-list.html'),
  'utf8',
);

describe('parseItalianDateInfo', () => {
  test('venue prefix, month names, time', () => {
    assert.deepEqual(
      parseItalianDateInfo('Palazzo Ducale Cortile Maggiore 04 lug 2026 — 05 lug 2026, ore 21:30'),
      {
        startDate: '2026-07-04',
        endDate: '2026-07-05',
        time: '21:30',
        prefix: 'Palazzo Ducale Cortile Maggiore',
      },
    );
  });
  test('same-day range collapses; missing time omitted', () => {
    assert.deepEqual(parseItalianDateInfo('Munizioniere 06 lug 2026 — 06 lug 2026'), {
      startDate: '2026-07-06',
      prefix: 'Munizioniere',
    });
  });
  test('no date → undefined', () => {
    assert.equal(parseItalianDateInfo('solo testo'), undefined);
  });
});

describe('mapDucaleType', () => {
  test('maps type labels to taxonomy hints', () => {
    assert.equal(mapDucaleType('Evento | Cinema'), 'culture');
    assert.equal(mapDucaleType('Mostra'), 'art');
    assert.equal(mapDucaleType('Evento'), undefined);
  });
});

describe('parsePalazzoducaleHtml (fixture)', () => {
  test('extracts upcoming events with venue and time', async () => {
    const events = await parsePalazzoducaleHtml(html);
    assert.ok(events.length >= 10, `expected ≥10 events, got ${events.length}`);
    for (const event of events) {
      assert.match(event.startDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(event.url, /^https:\/\/palazzoducale\.genova\.it\//);
      assert.equal(event.source, 'palazzoducale');
    }
    // Venue and time are card-dependent — require them on most, not all.
    const withVenue = events.filter((event) => (event.venue?.length ?? 0) > 3);
    assert.ok(withVenue.length >= Math.ceil(events.length / 2));
    const withImage = events.filter((event) => event.image !== undefined);
    assert.ok(withImage.length >= 5, 'expected card images');
    const timed = events.filter((event) => event.time !== undefined);
    assert.ok(timed.length >= 5, 'expected timed events with `ore HH:MM`');
  });
});

describe('makePalazzoducaleCollector', () => {
  test('reports failed on HTTP errors without throwing (AC-1.3)', async () => {
    const dead = async (): Promise<Response> => new Response('x', { status: 500 });
    const outcome = await makePalazzoducaleCollector(dead)();
    assert.equal(outcome.failed, true);
  });
});
