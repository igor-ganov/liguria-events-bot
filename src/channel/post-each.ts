import { postChannel } from './post-channel.ts';
import type { Channel } from './channel-entry.ts';
import type { ChannelResult } from './post-channel.ts';
import type { CompactEvent } from '../domain/event.ts';
import type { Env } from '../config.ts';
import type { FetchFn } from '../util/http.ts';

/**
 * Every channel in turn, each one answering for itself.
 *
 * One at a time rather than all at once: Telegram counts messages per second
 * across a bot, and twenty channels firing together is how a broadcast earns a
 * 429 on the one morning it matters. A channel that throws is caught here — a
 * chat the bot was removed from must not cost the other nineteen their post.
 */
export const postEach = async (
  env: Env,
  channels: readonly Channel[],
  index: readonly CompactEvent[],
  today: string,
  fetchFn: FetchFn = fetch,
): Promise<readonly ChannelResult[]> => {
  const results: ChannelResult[] = [];
  for (const channel of channels) {
    const result = await postChannel(env, channel, index, today, fetchFn).catch(
      (error: unknown): ChannelResult => ({
        region: channel.region,
        kind: 'failed',
        error: String(error),
      }),
    );
    results.push(result);
  }
  return results;
};
