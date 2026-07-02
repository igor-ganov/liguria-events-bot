/**
 * Saved events + reminders (AC-6.4/6.5). `remindedFor` makes the day-before
 * reminder idempotent across cron ticks.
 */
import type { CompactEvent } from '../domain/event.ts';
import type { KvLike } from './store.ts';
import { addDays } from './clock.ts';
import { asArray, asNonEmptyString, parseJson, readProp } from '../util/json.ts';

export type SavedEntry = Readonly<{ eventId: string; remindedFor?: string }>;

const savedKey = (userId: number): string => `user:${userId}:saved`;

const parseEntry = (value: unknown): readonly SavedEntry[] => {
  const eventId = asNonEmptyString(readProp(value, 'eventId'));
  if (eventId === undefined) return [];
  const remindedFor = asNonEmptyString(readProp(value, 'remindedFor'));
  return [{ eventId, ...(remindedFor === undefined ? {} : { remindedFor }) }];
};

export const readSaved = async (kv: KvLike, userId: number): Promise<readonly SavedEntry[]> => {
  const raw = await kv.get(savedKey(userId));
  if (raw === null) return [];
  return (asArray(parseJson(raw)) ?? []).flatMap(parseEntry);
};

export const writeSaved = async (
  kv: KvLike,
  userId: number,
  entries: readonly SavedEntry[],
): Promise<void> => kv.put(savedKey(userId), JSON.stringify(entries));

export const toggleSaved = (
  entries: readonly SavedEntry[],
  eventId: string,
): Readonly<{ entries: readonly SavedEntry[]; nowSaved: boolean }> => {
  const exists = entries.some((entry) => entry.eventId === eventId);
  return exists
    ? { entries: entries.filter((entry) => entry.eventId !== eventId), nowSaved: false }
    : { entries: [...entries, { eventId }], nowSaved: true };
};

export type DueReminders = Readonly<{
  due: readonly CompactEvent[];
  /** Saved list with reminded marks set and dead entries pruned. */
  entries: readonly SavedEntry[];
}>;

/** Events starting tomorrow whose reminder wasn't sent yet (AC-6.4). */
export const dueReminders = (
  entries: readonly SavedEntry[],
  index: readonly CompactEvent[],
  today: string,
): DueReminders => {
  const tomorrow = addDays(today, 1);
  const byId = new Map(index.map((event) => [event.id, event]));
  const due: CompactEvent[] = [];
  const next: SavedEntry[] = [];
  for (const entry of entries) {
    const event = byId.get(entry.eventId);
    if (event === undefined || (event.e ?? event.s) < today) continue; // prune dead
    if (event.s === tomorrow && entry.remindedFor !== tomorrow) {
      due.push(event);
      next.push({ eventId: entry.eventId, remindedFor: tomorrow });
    } else {
      next.push(entry);
    }
  }
  return { due, entries: next };
};
