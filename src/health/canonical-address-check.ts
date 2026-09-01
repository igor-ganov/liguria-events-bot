import { eventSlug } from '../domain/event-slug.ts';
import { fetchStatus } from './fetch-text.ts';
import { bad, ok } from './result.ts';
import type { CheckResult } from './types.ts';
import type { CompactEvent } from '../domain/event.ts';
import type { FetchFn } from '../collectors/types.ts';

/**
 * Everything this worker publishes is a link — the channel post, the digest,
 * the IndexNow ping — and the rule that builds one lives in two repositories at
 * once: here, and in the site that has to answer it. Nothing but this check
 * stops them drifting apart, and drift is silent: the site would still resolve
 * the link, by redirect, and we would spend every announcement on a URL that
 * moves.
 *
 * So it asks for the address this worker would publish and insists on a plain
 * 200. A 301 means the site spells it differently now.
 */
export const canonicalAddressCheck = async (
  fetchFn: FetchFn,
  origin: string,
  event: CompactEvent | undefined,
): Promise<CheckResult> => {
  const id = 'canonical-address';
  const title = 'The addresses we publish are the ones the site answers at';
  if (event === undefined) {
    return { id, title, status: 'warn', detail: 'no event in the index to check with' };
  }
  const path = `/event/${eventSlug(event)}/`;
  const status = await fetchStatus(fetchFn, `${origin}${path}`, 'manual');
  return status === 200
    ? ok(id, title, `${path} answers 200`)
    : bad(id, title, `${path} answered ${status} — the site spells this address differently`);
};
