// T13 — saved events + reminders (AC-6.4–6.5).
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { dueReminders, readSaved, toggleSaved, writeSaved } from '../src/pipeline/saved.ts';
import type { CompactEvent } from '../src/domain/event.ts';
import { makeKvStub } from './kv-stub.ts';

const compact = (id: string, s: string): CompactEvent => ({
  id,
  t: `Event ${id}`,
  s,
  c: ['other'],
  u: 'https://example.org',
});

describe('toggleSaved (AC-6.5)', () => {
  test('save then unsave', () => {
    const on = toggleSaved([], 'a');
    assert.equal(on.nowSaved, true);
    assert.deepEqual(on.entries, [{ eventId: 'a' }]);
    const off = toggleSaved(on.entries, 'a');
    assert.equal(off.nowSaved, false);
    assert.deepEqual(off.entries, []);
  });
});

describe('saved persistence', () => {
  test('round-trip', async () => {
    const kv = makeKvStub();
    await writeSaved(kv, 7, [{ eventId: 'a', remindedFor: '2026-07-02' }]);
    assert.deepEqual(await readSaved(kv, 7), [{ eventId: 'a', remindedFor: '2026-07-02' }]);
  });
});

describe('dueReminders (AC-6.4)', () => {
  const index = [compact('tomorrow', '2026-07-02'), compact('later', '2026-07-09')];

  test('fires for tomorrow only, marks as reminded', () => {
    const { due, entries } = dueReminders(
      [{ eventId: 'tomorrow' }, { eventId: 'later' }],
      index,
      '2026-07-01',
    );
    assert.deepEqual(due.map((event) => event.id), ['tomorrow']);
    assert.deepEqual(entries, [
      { eventId: 'tomorrow', remindedFor: '2026-07-02' },
      { eventId: 'later' },
    ]);
  });

  test('idempotent across ticks', () => {
    const { due } = dueReminders(
      [{ eventId: 'tomorrow', remindedFor: '2026-07-02' }],
      index,
      '2026-07-01',
    );
    assert.deepEqual(due, []);
  });

  test('prunes entries whose events vanished or passed', () => {
    const { entries } = dueReminders([{ eventId: 'gone' }], index, '2026-07-01');
    assert.deepEqual(entries, []);
  });
});
