import { ALL_REGIONS } from '../domain/region.ts';
import { isLang } from '../domain/event.ts';
import { readProp } from '../util/json.ts';
import type { Lang } from '../domain/event.ts';

/** The reserved key for the channel that speaks for the whole country. It is
 *  not a region and must not be spelled like one: @dovegoit says Italy on the
 *  tin, and turning it into a Liguria channel would lie to its subscribers. */
export const WHOLE_COUNTRY = 'italia';

export type Channel = Readonly<{ region: string; chat: string; lang: Lang; hour: number }>;

export type ChannelDefaults = Readonly<{ lang: Lang; hour: number }>;

const isRegion = (region: string): boolean =>
  region === WHOLE_COUNTRY || ALL_REGIONS.some((one) => one.slug === region);

/** A bare string is the chat; an object may also carry its own hour and
 *  language, because a channel in one region need not post at the same minute
 *  as the rest. */
const chatOf = (value: unknown): string =>
  typeof value === 'string' ? value : String(readProp(value, 'chat') ?? '');

const langOf = (value: unknown, fallback: Lang): Lang => {
  const wanted = readProp(value, 'lang');
  return isLang(wanted) ? wanted : fallback;
};

const hourOf = (value: unknown, fallback: number): number => {
  const hour = Number(readProp(value, 'hour') ?? Number.NaN);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : fallback;
};

/**
 * One entry of the channel registry, or the reason it is not one.
 *
 * A problem is returned rather than thrown or skipped. Throwing would cost the
 * whole tick for a typo in one secret; skipping is worse still — the channel
 * looks configured, posts nothing, and nobody finds out until somebody asks
 * why it has been quiet for a week.
 */
export const channelEntry = (
  region: string,
  value: unknown,
  defaults: ChannelDefaults,
): Channel | string => {
  const chat = chatOf(value);
  if (!isRegion(region)) return `unknown region "${region}"`;
  if (chat === '') return `channel "${region}" has no chat`;
  return { region, chat, lang: langOf(value, defaults.lang), hour: hourOf(value, defaults.hour) };
};
