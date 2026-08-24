import { channelHourOf } from '../config.ts';
import { makeBot } from '../delivery/bot-api.ts';
import { pickPost } from './pick-post.ts';
import { rememberPosted } from './remember-posted.ts';
import { renderPost } from './render-post.ts';
import { asArray, parseJson } from '../util/json.ts';
import { isLang } from '../domain/event.ts';
import type { CompactEvent } from '../domain/event.ts';
import type { Env } from '../config.ts';
import type { FetchFn } from '../util/http.ts';

const POSTED_KEY = 'channel:posted';
const MEMORY = 400;

const readPosted = async (env: Env): Promise<readonly string[]> =>
  (asArray(parseJson((await env.EVENTS.get(POSTED_KEY)) ?? '[]')) ?? []).filter(
    (value): value is string => typeof value === 'string',
  );

/**
 * One post a day to the public channel.
 *
 * The bot has a handful of private subscribers, which is not an audience. A
 * channel is the only surface where this project can push rather than wait —
 * and it stays silent when there is nothing worth saying, because a channel
 * that posts filler is a channel people mute.
 */
export const postDaily = async (
  env: Env,
  index: readonly CompactEvent[],
  today: string,
  hour: number,
  fetchFn: FetchFn = fetch,
): Promise<unknown> => {
  const chat = env.CHANNEL_CHAT_ID ?? '';
  if (chat === '' || hour !== channelHourOf(env)) return { kind: 'not-due' };
  const posted = await readPosted(env);
  const event = pickPost(index, today, posted);
  if (event === undefined) return { kind: 'nothing-to-say' };
  const wanted = env.CHANNEL_LANG ?? 'it';
  const lang = isLang(wanted) ? wanted : 'it';
  const post = renderPost(event, lang);
  const bot = makeBot(env.BOT_TOKEN, chat, fetchFn);
  const messageId = await bot.sendPhoto(post.photo, `${post.caption}\n\n${post.url}`);
  await env.EVENTS.put(POSTED_KEY, JSON.stringify(rememberPosted(posted, event.id, MEMORY)));
  return { kind: 'posted', id: event.id, messageId };
};
