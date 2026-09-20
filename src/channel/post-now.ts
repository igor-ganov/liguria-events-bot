import { channelsOf } from './channels.ts';
import { postEach } from './post-each.ts';
import type { BroadcastResult } from './post-daily.ts';
import type { CompactEvent } from '../domain/event.ts';
import type { Env } from '../config.ts';
import type { FetchFn } from '../util/http.ts';

/**
 * Post now, regardless of the hour — the operator's lever.
 *
 * Named region, or all of them when none is named: checking a deploy should be
 * one command, and pulling a single region back into line should not mean
 * waiting until tomorrow morning. A region with no channel is reported rather
 * than silently doing nothing, which is what a typo in the query string would
 * otherwise look like.
 */
export const postNow = async (
  env: Env,
  index: readonly CompactEvent[],
  today: string,
  region: string,
  fetchFn: FetchFn = fetch,
): Promise<BroadcastResult> => {
  const { channels, problems } = channelsOf(env);
  const wanted = region === '' ? channels : channels.filter((one) => one.region === region);
  const missing = region !== '' && wanted.length === 0 ? [`no channel for "${region}"`] : [];
  return {
    channels: await postEach(env, wanted, index, today, fetchFn),
    problems: [...problems, ...missing],
  };
};
