/**
 * Reproject every stored record into the index, repairing what a rule can
 * repair without a model on the way (design: `?force=rebuild`).
 *
 * The index is otherwise carried forward untouched for events no listing
 * shows again, so a new projected field, or a repair rule, would never reach
 * them. The repair is deterministic and idempotent: a second pass finds
 * nothing to write.
 */
import { parseSessions, toCompact, withDerivedSpan } from '../domain/event.ts';
import type { EventRecord } from '../domain/event.ts';
import { withExactSchedule } from '../schedule/exact-schedule.ts';
import { romeDate } from './clock.ts';
import { readAllRecords, writeEventRecord, writeIndex } from './store.ts';
import type { KvLike } from './store.ts';
import { pruneIndex } from './windows.ts';
import { sameJson } from '../util/json.ts';

export type RebuildResult = Readonly<{
  rebuilt: number;
  records: number;
  repaired: number;
  /** Records still to be written; the next pass writes them. */
  pending: number;
}>;

/** One record repaired: the programme read again (which drops the evenings
 *  older runs stored twice), the days and hour its own text gives
 *  (withExactSchedule), and a container's run derived from its programme. */
export const repairedRecord = (record: EventRecord): EventRecord => {
  const sessions = parseSessions(record.sessions);
  return withDerivedSpan(withExactSchedule(sessions === undefined ? record : { ...record, sessions }));
};

const byStart = (a: Readonly<{ s: string; t: string }>, b: Readonly<{ s: string; t: string }>): number =>
  a.s < b.s ? -1 : a.s > b.s ? 1 : a.t.localeCompare(b.t);

/** Writes at most `limit` repaired records: KV's free tier allows a thousand
 *  writes a day, and every record is written twice (working copy, archive). */
export const rebuildCorpus = async (
  kv: KvLike,
  nowMs: number,
  limit = Number.POSITIVE_INFINITY,
): Promise<RebuildResult> => {
  const stored = await readAllRecords(kv);
  const records = stored.map(repairedRecord);
  const repaired = records.filter((record, i) => !sameJson(stored[i], record));
  const written = repaired.slice(0, limit);
  await Promise.all(written.map((record) => writeEventRecord(kv, record, nowMs)));
  const index = pruneIndex(records.map(toCompact), romeDate(nowMs)).toSorted(byStart);
  await writeIndex(kv, index);
  return { rebuilt: index.length, records: records.length, repaired: written.length, pending: repaired.length - written.length };
};
