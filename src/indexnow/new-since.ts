import type { CompactEvent } from '../domain/event.ts';

/** Events first seen after the watermark, oldest first and bounded. IndexNow
 *  accepts 10 000 URLs per request and throttles well below that: 900 URLs in
 *  one go came back 429. A crawl adds a handful of events an hour, so this cap
 *  is a backstop, not a working limit. */
export const newSince = (
  index: readonly CompactEvent[],
  watermark: number,
  limit = 50,
): readonly CompactEvent[] =>
  index
    .filter((event) => (event.cr ?? 0) > watermark)
    .toSorted((a, b) => (a.cr ?? 0) - (b.cr ?? 0))
    .slice(0, limit);
