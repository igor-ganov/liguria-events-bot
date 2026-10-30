/**
 * The holiday job: the model names the holidays near today, the code keeps
 * the allowed ones, then the model sorts the events on those days into
 * "for the holiday" or not. The result is published as /holidays.json.
 */
import { addDays } from '../pipeline/clock.ts';
import { chunk } from '../llm/enrich.ts';
import { extractJson } from '../llm/client.ts';
import { CLASSIFY_BATCH, candidatesFor, classifyInput, namesHoliday, parseMembers } from './candidates.ts';
import { HORIZON_DAYS } from './holiday.ts';
import { parseHolidays } from './parse-holidays.ts';
import { CALENDAR_SYSTEM, calendarInput, classifySystem } from './prompts.ts';
import { writeHolidays } from './store.ts';
import type { ChatFn } from '../llm/client.ts';
import type { CompactEvent } from '../domain/event.ts';
import type { KvLike } from '../pipeline/store.ts';
import type { Holiday, HolidaysPayload, Rejection } from './holiday.ts';

export type HolidaysDeps = Readonly<{
  chat: ChatFn;
  kv: KvLike;
  index: readonly CompactEvent[];
  today: string;
  nowIso: string;
}>;

export type HolidaysRun = Readonly<{
  payload: HolidaysPayload;
  rejected: readonly Rejection[];
  candidates: Readonly<Record<string, number>>;
  failedBatches: number;
}>;

/** Classification calls in flight at once — the provider rate-limits bursts. */
const PARALLEL = 4;

type BatchResult = Readonly<{ ids: readonly string[]; failed: boolean }>;

const classifyBatch =
  (chat: ChatFn, holiday: Holiday) =>
  async (batch: readonly CompactEvent[]): Promise<BatchResult> => {
    try {
      const reply = await chat(classifySystem(holiday), JSON.stringify({ events: classifyInput(batch) }));
      return { ids: parseMembers(extractJson(reply), batch), failed: false };
    } catch {
      // A failed batch costs its events this run, never the holiday.
      return { ids: [], failed: true };
    }
  };

/** Runs `work` over `items`, `PARALLEL` at a time, results in input order. */
const inWaves = async <T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<readonly R[]> =>
  chunk(items, PARALLEL).reduce<Promise<readonly R[]>>(
    async (done, wave) => [...(await done), ...(await Promise.all(wave.map(work)))],
    Promise.resolve([]),
  );

// What the model chose, joined by every candidate that names the holiday in
// its title, in candidate order.
const membersOf = (holiday: Holiday, candidates: readonly CompactEvent[], chosen: readonly string[]): readonly string[] =>
  candidates.filter((event) => chosen.includes(event.id) || namesHoliday(holiday)(event)).map((event) => event.id);

type Classified = Readonly<{ holiday: Holiday; candidates: number; failed: number }>;

const classify =
  (deps: HolidaysDeps) =>
  async (holiday: Holiday): Promise<Classified> => {
    const candidates = candidatesFor(holiday, deps.index, deps.today);
    const results = await inWaves(chunk(candidates, CLASSIFY_BATCH), classifyBatch(deps.chat, holiday));
    return {
      holiday: { ...holiday, events: membersOf(holiday, candidates, results.flatMap((result) => result.ids)) },
      candidates: candidates.length,
      failed: results.filter((result) => result.failed).length,
    };
  };

/** Throws when the calendar call fails, leaving the stored payload as it was. */
export const runHolidays = async (deps: HolidaysDeps): Promise<HolidaysRun> => {
  const reply = await deps.chat(CALENDAR_SYSTEM, calendarInput(deps.today, addDays(deps.today, HORIZON_DAYS)));
  const { accepted, rejected } = parseHolidays(extractJson(reply), deps.today);
  const classified = await inWaves(accepted, classify(deps));
  const payload: HolidaysPayload = {
    generatedAt: deps.nowIso,
    holidays: classified.map((one) => one.holiday),
  };
  await writeHolidays(deps.kv, payload);
  return {
    payload,
    rejected,
    candidates: Object.fromEntries(classified.map((one) => [one.holiday.id, one.candidates])),
    failedBatches: classified.reduce((sum, one) => sum + one.failed, 0),
  };
};
