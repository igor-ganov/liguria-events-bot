// T4 — KV store: round-trips, TTLs, lock, run-log cap (AC-1.1, AC-1.5, AC-8.2).
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  acquireLock,
  appendRunLog,
  readEventRecord,
  readIndex,
  readRunLog,
  recordTtlSeconds,
  releaseLock,
  writeEventRecord,
  writeIndex,
} from '../src/pipeline/store.ts';
import { toCompact } from '../src/domain/event.ts';
import type { EventRecord } from '../src/domain/event.ts';
import { makeKvStub } from './kv-stub.ts';

const record: EventRecord = {
  id: 'aaaabbbbcccc',
  title: 'Test',
  startDate: '2026-07-10',
  endDate: '2026-07-12',
  categories: ['art'],
  descriptions: { en: 'A test event.', it: 'Un evento.', ru: 'Событие.' },
  url: 'https://example.org',
  source: 'visitgenoa',
  enriched: true,
  addedAt: 1,
};

describe('store', () => {
  test('index round-trip', async () => {
    const kv = makeKvStub();
    assert.deepEqual(await readIndex(kv), []);
    await writeIndex(kv, [toCompact(record)]);
    const index = await readIndex(kv);
    assert.equal(index.length, 1);
    assert.equal(index[0]?.id, record.id);
  });

  test('event record round-trip with TTL past the end date', async () => {
    const kv = makeKvStub();
    const nowMs = Date.parse('2026-07-01T00:00:00Z');
    await writeEventRecord(kv, record, nowMs);
    assert.deepEqual(await readEventRecord(kv, record.id), record);
    const ttl = kv.ttls.get(`event:${record.id}`);
    assert.ok(ttl !== undefined && ttl > 13 * 86_400 && ttl < 16 * 86_400);
  });

  test('recordTtlSeconds never drops under an hour', () => {
    const { endDate: _end, ...noEnd } = record;
    const past: EventRecord = { ...noEnd, startDate: '2020-01-01' };
    assert.equal(recordTtlSeconds(past, Date.parse('2026-07-01T00:00:00Z')), 3600);
  });

  test('lock: second acquire fails until released (AC-8.2)', async () => {
    const kv = makeKvStub();
    assert.equal(await acquireLock(kv), true);
    assert.equal(await acquireLock(kv), false);
    await releaseLock(kv);
    assert.equal(await acquireLock(kv), true);
  });

  test('run log is capped at 20 entries, newest first (AC-8.3)', async () => {
    const kv = makeKvStub();
    for (let i = 0; i < 25; i += 1) {
      await appendRunLog(kv, { i });
    }
    const log = await readRunLog(kv);
    assert.equal(log.length, 20);
    assert.deepEqual(log[0], { i: 24 });
  });
});
