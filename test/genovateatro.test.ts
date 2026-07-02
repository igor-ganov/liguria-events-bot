// genoa-events design §4.3 — genovateatro collector on the live-captured fixture.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  makeGenovateatroCollector,
  parseGenovateatroHtml,
} from '../src/collectors/genovateatro.ts';

const html = readFileSync(
  join(import.meta.dirname, 'fixtures', 'genovateatro-list.html'),
  'utf8',
);

describe('parseGenovateatroHtml (fixture)', () => {
  test('extracts theatre events with ranges and abstracts', async () => {
    const events = await parseGenovateatroHtml(html);
    assert.ok(events.length >= 5, `expected ≥5 events, got ${events.length}`);
    for (const event of events) {
      assert.match(event.startDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(event.url, /^https:\/\/www\.genovateatro\.it\/eventi\//);
      assert.equal(event.categoryHint, 'theatre');
      assert.equal(event.source, 'genovateatro');
    }
    const gothica = events.find((event) => event.title === 'Gothica');
    assert.ok(gothica !== undefined);
    assert.equal(gothica.startDate, '2026-07-02');
    assert.equal(gothica.endDate, '2026-07-26');
    assert.ok(gothica.rawDescription !== undefined && gothica.rawDescription.includes('immersiva'));
  });
});

describe('makeGenovateatroCollector', () => {
  test('reports failed on errors without throwing (AC-1.3)', async () => {
    const dead = async (): Promise<Response> => {
      throw new Error('down');
    };
    const outcome = await makeGenovateatroCollector(dead)();
    assert.equal(outcome.failed, true);
  });
});
