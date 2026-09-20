import { WHOLE_COUNTRY } from './channel-entry.ts';
import type { CompactEvent } from '../domain/event.ts';

/**
 * The slice of the corpus a channel speaks for.
 *
 * Filtering here rather than inside `pickDigest` keeps the per-city caps
 * meaning what they say: three per city out of one region, not three per city
 * out of the country with the region hoping to survive the cut.
 */
export const inRegion = (
  index: readonly CompactEvent[],
  region: string,
): readonly CompactEvent[] =>
  region === WHOLE_COUNTRY ? index : index.filter((event) => (event.rg ?? '') === region);
