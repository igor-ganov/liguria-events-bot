import { channelsOf } from './channels.ts';
import { postEach } from './post-each.ts';
import type { ChannelResult } from './post-channel.ts';
import type { CompactEvent } from '../domain/event.ts';
import type { Env } from '../config.ts';
import type { FetchFn } from '../util/http.ts';

export type BroadcastResult = Readonly<{
  channels: readonly ChannelResult[];
  problems: readonly string[];
}>;

/**
 * The day's digests, one per channel.
 *
 * A channel is per region because a reader is: somebody in Palermo who opens a
 * post whose first three quarters are Liguria does not scroll to find their
 * own city, they leave. Each channel comes due at its own hour, so a region
 * can post when its readers are awake rather than when Genoa is.
 *
 * Problems with the registry travel with the answer instead of being logged
 * and lost — a mistyped region is a channel that looks configured and stays
 * empty, and the only place that shows is here.
 */
export const postDaily = async (
  env: Env,
  index: readonly CompactEvent[],
  today: string,
  hour: number,
  fetchFn: FetchFn = fetch,
): Promise<BroadcastResult> => {
  const { channels, problems } = channelsOf(env);
  const due = channels.filter((channel) => channel.hour === hour);
  return { channels: await postEach(env, due, index, today, fetchFn), problems };
};
