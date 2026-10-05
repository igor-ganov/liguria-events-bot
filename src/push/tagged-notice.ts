import { pushUtm } from '../links/push-utm.ts';
import { withUtm } from '../links/with-utm.ts';
import type { Notice } from './digest-notice.ts';

/**
 * The notice as it is sent: the same words, and a link that says a
 * notification sent it.
 *
 * Tagged here rather than inside `digestNotice` so that the canonical address
 * stays the thing the digest computes — one function answers "where does this
 * reader belong", the other "how did they get here".
 */
export const taggedNotice = (notice: Notice | undefined, today: string): Notice | undefined =>
  [notice]
    .filter((one): one is Notice => one !== undefined)
    .map((one) => ({ ...one, url: withUtm(one.url, pushUtm(today)) }))
    .at(0);
