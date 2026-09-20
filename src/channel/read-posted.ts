import { LEGACY_POSTED_KEY, postedKey } from './posted-key.ts';
import { WHOLE_COUNTRY } from './channel-entry.ts';
import { asArray, parseJson } from '../util/json.ts';
import type { Env } from '../config.ts';

/** The history from when there was only one channel — inherited by the
 *  whole-country channel and by nobody else, since a regional channel's events
 *  were never sent to its readers. */
const inherited = async (env: Env, region: string): Promise<string | undefined> =>
  region === WHOLE_COUNTRY ? ((await env.EVENTS.get(LEGACY_POSTED_KEY)) ?? undefined) : undefined;

/**
 * What this channel has already said.
 *
 * Read per channel so that the day the registry arrives does not replay a week
 * of posts into a channel that already ran them.
 */
export const readPosted = async (env: Env, region: string): Promise<readonly string[]> => {
  const own = await env.EVENTS.get(postedKey(region));
  const raw = own ?? (await inherited(env, region)) ?? '[]';
  return (asArray(parseJson(raw)) ?? []).filter((value): value is string => typeof value === 'string');
};
