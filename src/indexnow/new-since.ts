import type { CompactEvent } from '../domain/event.ts';

/** Events first seen after the watermark, oldest first and bounded. IndexNow
 *  accepts 10 000 URLs per request, but a run that submits a whole backlog at
 *  once is also a run that retries the whole backlog when it fails. */
export const newSince = (
  index: readonly CompactEvent[],
  watermark: number,
  limit = 300,
): readonly CompactEvent[] =>
  index
    .filter((event) => (event.cr ?? 0) > watermark)
    .toSorted((a, b) => (a.cr ?? 0) - (b.cr ?? 0))
    .slice(0, limit);
