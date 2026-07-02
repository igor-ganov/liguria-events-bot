// public-calendar C1 — ICS rendering and filters (AC-1.3–1.5, AC-2.x, AC-4.1).
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  buildIcs,
  escapeIcsText,
  filterEvents,
  filterFromQuery,
  foldIcsLine,
} from '../src/calendar/ics.ts';
import type { CompactEvent } from '../src/domain/event.ts';

const NOW = Date.parse('2026-07-02T10:00:00Z');

const allDay: CompactEvent = {
  id: 'aaa111',
  t: 'Mostra; lunga, bella \\ storica',
  s: '2026-07-10',
  e: '2026-07-20',
  c: ['art'],
  v: 'Palazzo Ducale',
  u: 'https://example.org/mostra',
};

const timed: CompactEvent = {
  id: 'bbb222',
  t: 'Concerto',
  s: '2026-07-04',
  h: '21:00',
  c: ['music'],
  f: true,
  u: 'https://example.org/concerto',
};

describe('escapeIcsText (AC-1.5)', () => {
  test('escapes backslash, semicolon, comma, newline', () => {
    assert.equal(escapeIcsText('a;b,c\\d\ne'), 'a\\;b\\,c\\\\d\\ne');
  });
});

describe('foldIcsLine (AC-1.5)', () => {
  test('folds long lines with space continuations', () => {
    const folded = foldIcsLine(`SUMMARY:${'x'.repeat(200)}`);
    assert.ok(folded.length >= 3);
    assert.ok(folded[0]!.length <= 74);
    for (const part of folded.slice(1)) {
      assert.ok(part.startsWith(' '));
      assert.ok(part.length <= 74);
    }
  });
  test('short lines untouched', () => {
    assert.deepEqual(foldIcsLine('VERSION:2.0'), ['VERSION:2.0']);
  });
});

describe('buildIcs (AC-1.1, AC-1.3, AC-1.4)', () => {
  const ics = buildIcs([allDay, timed], NOW);

  test('valid envelope with VTIMEZONE and CRLF endings', () => {
    assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
    assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
    assert.ok(ics.includes('TZID:Europe/Rome'));
    assert.ok(ics.includes('X-WR-CALNAME:Genoa Events'));
    assert.equal(ics.includes('\n\n'), false);
  });

  test('all-day event spans start..end inclusive (DTEND exclusive)', () => {
    assert.ok(ics.includes('DTSTART;VALUE=DATE:20260710'));
    assert.ok(ics.includes('DTEND;VALUE=DATE:20260721'));
  });

  test('timed event uses Europe/Rome and a 2h default duration', () => {
    assert.ok(ics.includes('DTSTART;TZID=Europe/Rome:20260704T210000'));
    assert.ok(ics.includes('DTEND;TZID=Europe/Rome:20260704T230000'));
  });

  test('carries UID, escaped SUMMARY, LOCATION, URL', () => {
    assert.ok(ics.includes('UID:aaa111@event-collecter'));
    assert.ok(ics.includes('Mostra\\; lunga\\, bella \\\\ storica'));
    assert.ok(ics.includes('LOCATION:Palazzo Ducale'));
    assert.ok(ics.includes('URL:https://example.org/concerto'));
  });

  test('late-evening times roll into the next day instead of hour 25', () => {
    const late = buildIcs([{ ...timed, h: '23:30' }], NOW);
    assert.ok(late.includes('DTSTART;TZID=Europe/Rome:20260704T233000'));
    assert.ok(late.includes('DTEND;TZID=Europe/Rome:20260705T013000'));
  });
});

describe('filters (AC-2.x)', () => {
  test('category and free filters compose', () => {
    assert.deepEqual(filterEvents([allDay, timed], { categories: ['music'] }), [timed]);
    assert.deepEqual(filterEvents([allDay, timed], { freeOnly: true }), [timed]);
    assert.deepEqual(
      filterEvents([allDay, timed], { categories: ['art'], freeOnly: true }),
      [],
    );
  });
  test('filterFromQuery ignores unknown tokens (AC-2.1)', () => {
    const filter = filterFromQuery(new URLSearchParams('cat=music,bogus&free=1'));
    assert.deepEqual(filter, { categories: ['music'], freeOnly: true });
    assert.deepEqual(filterFromQuery(new URLSearchParams('cat=bogus')), {});
  });
});
