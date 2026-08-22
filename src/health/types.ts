/** One thing that can be true or not about the live site. */
export type CheckStatus = 'ok' | 'warn' | 'fail';

export type CheckResult = Readonly<{
  /** Stable key, so a check can be tracked across reports. */
  id: string;
  /** What is being asserted, phrased so a failure reads as the problem. */
  title: string;
  status: CheckStatus;
  /** What was actually found — the sentence that saves the reader a click. */
  detail: string;
}>;

export type HealthReport = Readonly<{
  at: number;
  status: CheckStatus;
  checks: readonly CheckResult[];
}>;

const RANK: Readonly<Record<CheckStatus, number>> = { ok: 0, warn: 1, fail: 2 };

/** The report is as bad as its worst check — a dashboard that averages its
 *  failures away is a dashboard nobody trusts. */
export const worstOf = (checks: readonly CheckResult[]): CheckStatus =>
  [...checks]
    .map((check) => check.status)
    .sort((a, b) => RANK[b] - RANK[a])
    .at(0) ?? 'ok';
