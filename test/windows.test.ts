// T3 — Rome clock and date windows (AC-1.5, AC-3.1–3.5).
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { addDays, romeDate, romeHour, weekdayOf } from '../src/pipeline/clock.ts';
import {
  categoryEvents,
  coversDay,
  eventsInWindow,
  freeEvents,
  pruneIndex,
  todayWindow,
  tonightEvents,
  weekendWindow,
} from '../src/pipeline/windows.ts';
import type { CompactEvent } from '../src/domain/event.ts';

const make = (overrides: Partial<CompactEvent> & Pick<CompactEvent, 'id' | 's'>): CompactEvent => ({
  t: `Event ${overrides.id}`,
  c: 'other',
  u: 'https://example.org',
  ...overrides,
});

describe('clock', () => {
  test('romeDate handles CEST offset (UTC 22:30 is already tomorrow in Rome)', () => {
    assert.equal(romeDate(Date.parse('2026-07-04T22:30:00Z')), '2026-07-05');
  });
  test('romeHour maps UTC to Rome local (CEST = UTC+2)', () => {
    assert.equal(romeHour(Date.parse('2026-07-04T15:00:00Z')), 17);
  });
  test('addDays crosses month boundaries', () => {
    assert.equal(addDays('2026-07-31', 1), '2026-08-01');
  });
  test('weekdayOf: 2026-07-04 is a Saturday', () => {
    assert.equal(weekdayOf('2026-07-04'), 6);
  });
});

describe('weekendWindow', () => {
  test('midweek → upcoming Sat..Sun', () => {
    assert.deepEqual(weekendWindow('2026-07-01'), { from: '2026-07-04', to: '2026-07-05' });
  });
  test('on Saturday → current Sat..Sun', () => {
    assert.deepEqual(weekendWindow('2026-07-04'), { from: '2026-07-04', to: '2026-07-05' });
  });
  test('on Sunday → what is left of the weekend', () => {
    assert.deepEqual(weekendWindow('2026-07-05'), { from: '2026-07-05', to: '2026-07-05' });
  });
});

describe('window queries', () => {
  const index: readonly CompactEvent[] = [
    make({ id: 'past', s: '2026-06-20', e: '2026-06-30' }),
    make({ id: 'today', s: '2026-07-01' }),
    make({ id: 'span', s: '2026-06-01', e: '2026-08-31' }),
    make({ id: 'sat', s: '2026-07-04', h: '21:00', c: 'nightlife' }),
    make({ id: 'freebie', s: '2026-07-03', f: true }),
    make({ id: 'far', s: '2026-09-01', c: 'music' }),
  ];

  test('coversDay covers multi-day ranges', () => {
    const span = index.find((event) => event.id === 'span');
    assert.ok(span !== undefined);
    assert.equal(coversDay(span, '2026-07-15'), true);
    assert.equal(coversDay(span, '2026-09-01'), false);
  });

  test('today window includes single-day and spanning events', () => {
    const ids = eventsInWindow(index, todayWindow('2026-07-01')).map((event) => event.id);
    assert.deepEqual([...ids].sort(), ['span', 'today']);
  });

  test('tonight = evening starts or nightlife/music covering today', () => {
    const ids = tonightEvents(index, '2026-07-04').map((event) => event.id);
    assert.deepEqual(ids, ['sat']);
  });

  test('free filter', () => {
    const ids = freeEvents(index, '2026-07-01').map((event) => event.id);
    assert.deepEqual(ids, ['freebie']);
  });

  test('category filter respects 14-day horizon', () => {
    assert.deepEqual(categoryEvents(index, 'music', '2026-07-01'), []);
    const near = categoryEvents(index, 'nightlife', '2026-07-01').map((event) => event.id);
    assert.deepEqual(near, ['sat']);
  });

  test('pruneIndex drops fully past events (AC-1.5)', () => {
    const ids = pruneIndex(index, '2026-07-01').map((event) => event.id);
    assert.equal(ids.includes('past'), false);
    assert.equal(ids.includes('span'), true);
  });
});
