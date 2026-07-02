// genoa-events design §4.5 — Porto Antico via the open WP REST API.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  makePortoanticoCollector,
  parseLocations,
  parsePortoanticoPosts,
} from '../src/collectors/portoantico.ts';
import { parseJson } from '../src/util/json.ts';
import { parseItalianDateInfo } from '../src/collectors/italian-dates.ts';

const fixture = (name: string): unknown =>
  parseJson(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8'));

const posts = fixture('portoantico-eventi.json');
const locations = parseLocations(fixture('portoantico-locations.json'));

describe('parseItalianDateInfo — full month names', () => {
  test('body header line with weekday and dotted time', () => {
    const info = parseItalianDateInfo('GUERRE STELLARI Martedì 21 luglio 2026 – ore 21.30 Arena');
    assert.equal(info?.startDate, '2026-07-21');
    assert.equal(info?.time, '21:30');
  });
});

describe('parseLocations', () => {
  test('maps term ids to names', () => {
    assert.ok(locations.size >= 20);
    assert.equal(locations.get(2773), 'Arena del mare');
  });
});

describe('parsePortoanticoPosts (fixture)', () => {
  test('extracts dated events with venue from the taxonomy', () => {
    const events = parsePortoanticoPosts(posts, locations);
    assert.ok(events.length >= 5, `expected ≥5 events, got ${events.length}`);
    for (const event of events) {
      assert.match(event.startDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(event.url, /^https:\/\/portoantico\.it\//);
      assert.equal(event.source, 'portoantico');
      assert.ok(event.rawDescription !== undefined);
    }
    const starWars = events.find((event) => event.title.includes('Guerre Stellari'));
    assert.ok(starWars !== undefined);
    assert.equal(starWars.startDate, '2026-07-21');
    assert.equal(starWars.time, '21:30');
    assert.equal(starWars.venue, 'Arena del mare');
  });
});

describe('makePortoanticoCollector', () => {
  test('reports failed when the API is down (AC-1.3)', async () => {
    const dead = async (): Promise<Response> => new Response('x', { status: 500 });
    const outcome = await makePortoanticoCollector(dead)();
    assert.equal(outcome.failed, true);
  });
  test('missing locations degrade to events without venue', async () => {
    const eventiBody = readFileSync(
      join(import.meta.dirname, 'fixtures', 'portoantico-eventi.json'),
      'utf8',
    );
    const flaky = async (input: string): Promise<Response> =>
      input.includes('/location-eventi?')
        ? new Response('x', { status: 500 })
        : new Response(eventiBody);
    const outcome = await makePortoanticoCollector(flaky)();
    assert.equal(outcome.failed, false);
    assert.ok(outcome.events.length >= 5);
    assert.ok(outcome.events.every((event) => event.venue === undefined));
  });
});
