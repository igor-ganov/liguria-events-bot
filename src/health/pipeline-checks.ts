import { asNumber, readProp } from '../util/json.ts';
import type { CheckResult } from './types.ts';
import type { CompactEvent } from '../domain/event.ts';

const HOUR_MS = 3_600_000;

/** The crawl is alive: a run finished recently, and it was not all failures. */
export const lastRunCheck = (entries: readonly unknown[], nowMs: number): readonly CheckResult[] => {
  const last = entries.at(0);
  const at = (asNumber(readProp(last, 'at')) ?? 0) * 1000;
  const ageHours = Math.round((nowMs - at) / HOUR_MS);
  const okCount = asNumber(readProp(last, 'enrichedOk')) ?? 0;
  const failed = asNumber(readProp(last, 'enrichFailed')) ?? 0;
  // Name the dominant reason: a rate limit and a model answering prose need
  // different fixes, and the count alone cannot tell them apart.
  const reasons = Object(readProp(last, 'enrichErrors'));
  const worst = Object.entries(reasons)
    .map(([reason, count]) => `${reason}×${String(count)}`)
    .sort()
    .slice(0, 3)
    .join(', ');
  return [
    {
      id: 'crawl-recent',
      title: 'The crawler ran recently',
      status: at === 0 ? 'fail' : ageHours > 12 ? 'fail' : ageHours > 8 ? 'warn' : 'ok',
      detail: at === 0 ? 'no run has ever been logged' : `last run ${ageHours}h ago`,
    },
    {
      id: 'enrich-health',
      title: 'Enrichment is succeeding more than it fails',
      status: failed > okCount && failed > 3 ? 'fail' : failed > 0 ? 'warn' : 'ok',
      detail: `${okCount} enriched, ${failed} failed on the last run${worst === '' ? '' : ` (${worst})`}`,
    },
  ];
};

/** The index the whole site reads is populated and looking forward. */
export const indexCheck = (index: readonly CompactEvent[], today: string): readonly CheckResult[] => {
  const upcoming = index.filter((event) => (event.e ?? event.s) >= today);
  const located = index.filter((event) => event.g !== undefined);
  return [
    {
      id: 'index-size',
      title: 'The index has events to show',
      status: upcoming.length === 0 ? 'fail' : upcoming.length < 100 ? 'warn' : 'ok',
      detail: `${upcoming.length} upcoming of ${index.length} indexed`,
    },
    {
      id: 'index-located',
      title: 'Most events can be put on the map',
      status: index.length === 0 || located.length / index.length < 0.7 ? 'warn' : 'ok',
      detail: `${located.length} of ${index.length} have coordinates`,
    },
  ];
};
