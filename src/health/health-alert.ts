import type { CheckResult, HealthReport } from './types.ts';

const LINE = (check: CheckResult): string =>
  `${check.status === 'fail' ? '🔴' : '🟠'} <b>${check.title}</b>\n   ${check.detail}`;

/**
 * What to tell the operator, or nothing at all.
 *
 * Only the EDGE is reported: a message on every tick while a problem persists
 * trains its reader to ignore the channel, which is worse than not having one.
 * A recovery is worth saying out loud — it closes the loop on the alert that
 * opened it.
 */
export const healthAlert = (report: HealthReport, previous: string): string | undefined => {
  const broken = report.checks.filter((check) => check.status !== 'ok');
  if (report.status === previous) return undefined;
  if (report.status === 'ok') return '✅ <b>Site health restored</b>\nEvery check passes again.';
  return [
    report.status === 'fail' ? '🔴 <b>Site health: problems</b>' : '🟠 <b>Site health: warnings</b>',
    '',
    ...broken.map(LINE),
    '',
    'https://admin.dovego.it/',
  ].join('\n');
};
