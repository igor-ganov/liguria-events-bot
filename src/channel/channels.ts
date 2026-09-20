import { channelEntry, WHOLE_COUNTRY } from './channel-entry.ts';
import { channelHourOf } from '../config.ts';
import { isLang } from '../domain/event.ts';
import { isRecord, parseJson } from '../util/json.ts';
import type { Channel } from './channel-entry.ts';
import type { Env } from '../config.ts';
import type { Lang } from '../domain/event.ts';

export { WHOLE_COUNTRY } from './channel-entry.ts';
export type { Channel } from './channel-entry.ts';

export type Registry = Readonly<{
  channels: readonly Channel[];
  problems: readonly string[];
}>;

/** What is configured, in the order it was written. The single-channel setting
 *  is read as the whole-country entry so that a deploy of this code needs no
 *  secret changed in the same breath — otherwise the rollout has a dark
 *  minute in which the channel is configured by neither. */
const configured = (env: Env): Readonly<Record<string, unknown>> => {
  const registry = parseJson(env.CHANNEL_CHATS ?? '');
  const legacy = env.CHANNEL_CHAT_ID ?? '';
  return isRecord(registry) ? registry : legacy === '' ? {} : { [WHOLE_COUNTRY]: legacy };
};

const defaultsOf = (env: Env): Readonly<{ lang: Lang; hour: number }> => {
  const wanted = env.CHANNEL_LANG ?? 'it';
  return { lang: isLang(wanted) ? wanted : 'it', hour: channelHourOf(env) };
};

/**
 * Every channel the broadcast speaks to, and everything wrong with the ones it
 * cannot. Both halves are returned: a registry that quietly drops a mistyped
 * region is a channel that stays empty with nobody the wiser.
 */
export const channelsOf = (env: Env): Registry => {
  const defaults = defaultsOf(env);
  const parsed = Object.entries(configured(env)).map(([region, value]) =>
    channelEntry(region, value, defaults),
  );
  return {
    channels: parsed.filter((one): one is Channel => typeof one !== 'string'),
    problems: parsed.filter((one): one is string => typeof one === 'string'),
  };
};
