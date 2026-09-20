import { inRegion } from '../channel/in-region.ts';
import { onDay } from '../channel/on-day.ts';
import { ALL_REGIONS } from '../domain/region.ts';
import type { CheckResult } from './types.ts';
import type { CompactEvent } from '../domain/event.ts';
import type { Registry } from '../channel/channels.ts';

/** The same floor the broadcast posts above: below it a region has nothing
 *  worth a post, and neither a channel nor its absence is a fault. */
const MINIMUM = 3;

const onToday = (index: readonly CompactEvent[], region: string, today: string): number =>
  inRegion(index, region).filter((event) => onDay(event, today) && (event.ct ?? '') !== '').length;

/**
 * The two ways the regional broadcast goes wrong quietly.
 *
 * A mistyped region in the registry produces a channel that looks configured
 * and posts nothing — the failure has no symptom anywhere else, which is
 * exactly why it belongs in a check. And a region carrying a full day with
 * nobody to tell is not broken, but it is a week of readers walking past an
 * empty shelf, so it warns rather than fails.
 */
export const channelChecks = (
  registry: Registry,
  index: readonly CompactEvent[],
  today: string,
): readonly CheckResult[] => {
  const configured = new Set(registry.channels.map((channel) => channel.region));
  const uncovered = ALL_REGIONS.filter(
    (region) => !configured.has(region.slug) && onToday(index, region.slug, today) >= MINIMUM,
  ).map((region) => region.name);
  return [
    {
      id: 'channel-registry',
      title: 'Every configured channel is one the bot can post to',
      status: registry.problems.length === 0 ? 'ok' : 'fail',
      detail:
        registry.problems.length === 0
          ? `${configured.size} channels, all readable`
          : registry.problems.join('; '),
    },
    {
      id: 'channel-coverage',
      title: 'A region with a full day has somewhere to say so',
      status: uncovered.length === 0 ? 'ok' : 'warn',
      detail:
        uncovered.length === 0
          ? 'every region with events today has a channel'
          : `${uncovered.length} without a channel: ${uncovered.slice(0, 4).join(', ')}`,
    },
  ];
};
