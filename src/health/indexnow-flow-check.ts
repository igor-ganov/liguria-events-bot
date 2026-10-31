import type { CheckResult } from './types.ts';
import type { CompactEvent } from '../domain/event.ts';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Two days of events never announced is a submission that is not landing,
 *  not a quiet hour. */
const STUCK_MS = 2 * DAY_MS;
const LATE_MS = 12 * HOUR_MS;

type State = Readonly<{ watermark: number | undefined; retryAfterMs: number }>;

const ID = 'indexnow-flow';
const TITLE = 'What IndexNow has been told keeps up with what we have';

const said = (status: CheckResult['status'], detail: string): CheckResult => ({ id: ID, title: TITLE, status, detail });

const age = (ms: number): string =>
  ms >= DAY_MS ? `${String(Math.round(ms / DAY_MS))} days` : `${String(Math.round(ms / HOUR_MS))}h`;

/**
 * Whether the IndexNow backlog is draining.
 *
 * indexnow-key proves the key file is served, which is not the same as a
 * submission being accepted: on 2026-10-31 the watermark had not moved since
 * 2026-09-04 while 980 of 1 365 events were newer, and the cooldown key said
 * the last batch had been answered 429. Eight weeks of refusals, and the only
 * channel that reaches Bing without an account, with nothing anywhere saying
 * so. The watermark is the record of what has been said, so its distance from
 * the newest event we hold is the whole measure.
 */
export const indexNowFlowCheck = (state: State, index: readonly CompactEvent[], nowMs: number): CheckResult => {
  const cooling = state.retryAfterMs > nowMs;
  const refused = cooling ? ` — refused and cooling off for another ${age(state.retryAfterMs - nowMs)}` : '';
  const mark = state.watermark;
  if (mark === undefined) return said('ok', `not primed yet: the first run starts the clock${refused}`);
  const waiting = index.filter((event) => (event.cr ?? 0) > mark);
  const newest = Math.max(mark, ...index.map((event) => event.cr ?? 0));
  const behind = (newest - mark) * 1000;
  const detail = `${String(waiting.length)} events not announced, the newest ${age(behind)} past the watermark${refused}`;
  if (waiting.length > 0 && behind > STUCK_MS) return said('fail', detail);
  if (cooling || behind > LATE_MS) return said('warn', detail);
  return said('ok', `up to date: ${String(waiting.length)} events waiting, ${age(behind)} behind`);
};
