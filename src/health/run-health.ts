import { corpusChecks } from './corpus-checks.ts';
import { eventMarkupCheck, hreflangCheck } from './markup-checks.ts';
import { indexCheck, lastRunCheck } from './pipeline-checks.ts';
import { httpSemanticsCheck, pastEventCheck, robotsCheck, sitemapCheck } from './site-checks.ts';
import { worstOf } from './types.ts';
import type { CompactEvent } from '../domain/event.ts';
import type { FetchFn } from '../collectors/types.ts';
import type { HealthReport } from './types.ts';

export type HealthDeps = Readonly<{
  fetchFn: FetchFn;
  origin: string;
  index: readonly CompactEvent[];
  runLog: readonly unknown[];
  /** An id that has left the index — what proves a shared link still opens. */
  archivedId: string | undefined;
  /** An id of ours that resolves nowhere — what proves 410 rather than 404. */
  goneId: string | undefined;
  today: string;
  nowMs: number;
}>;

// Sampled rather than exhaustive: the point is to notice a class of breakage
// within the hour, not to crawl the site. The pages chosen are the ones whose
// hreflang was actually wrong.
const HREFLANG_SAMPLE = ['/terms/', '/privacy/', '/liguria/'];

/** Everything we know how to check, run together. */
export const runHealth = async (deps: HealthDeps): Promise<HealthReport> => {
  const sample = deps.index.at(0)?.id ?? '';
  const remote = await Promise.all([
    sitemapCheck(deps.fetchFn, deps.origin),
    robotsCheck(deps.fetchFn, deps.origin),
    pastEventCheck(deps.fetchFn, deps.origin, deps.archivedId),
    eventMarkupCheck(deps.fetchFn, deps.origin, sample),
    hreflangCheck(deps.fetchFn, deps.origin, HREFLANG_SAMPLE),
    httpSemanticsCheck(deps.fetchFn, deps.origin, deps.goneId),
  ]);
  const checks = [
    ...remote,
    ...indexCheck(deps.index, deps.today),
    ...corpusChecks(deps.index),
    ...lastRunCheck(deps.runLog, deps.nowMs),
  ];
  return { at: Math.floor(deps.nowMs / 1000), status: worstOf(checks), checks };
};
