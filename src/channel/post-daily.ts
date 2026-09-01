import { channelHourOf } from '../config.ts';
import { eventUrl } from './event-url.ts';
import { isLang } from '../domain/event.ts';
import { pickDigest } from './pick-digest.ts';
import { postText } from './post-text.ts';
import { rememberPosted } from './remember-posted.ts';
import { renderDigest } from './render-digest.ts';
import { asArray, parseJson } from '../util/json.ts';
import type { CompactEvent } from '../domain/event.ts';
import type { Env } from '../config.ts';
import type { FetchFn } from '../util/http.ts';

const POSTED_KEY = 'channel:posted';
const MEMORY = 400;
/** Below this the day has nothing to report, and a digest of one line is worse
 *  than no post at all. */
const MINIMUM = 3;

const readPosted = async (env: Env): Promise<readonly string[]> =>
  (asArray(parseJson((await env.EVENTS.get(POSTED_KEY)) ?? '[]')) ?? []).filter(
    (value): value is string => typeof value === 'string',
  );

/**
 * The day's digest to the public channel.
 *
 * One event a day was a channel about whichever listing happened to be
 * soonest. A digest is a reason to open the channel: several things worth
 * doing, grouped by city, so a reader scans for their own and finds answers
 * rather than a single roll of the dice.
 *
 * It stays silent when the day has nothing to report. A channel that posts
 * filler is a channel people mute.
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
  const events = pickDigest(index, today, posted);
  if (events.length < MINIMUM) return { kind: 'nothing-to-say', found: events.length };
  const wanted = env.CHANNEL_LANG ?? 'it';
  const lang = isLang(wanted) ? wanted : 'it';
  // The picture comes from the first event's own page: Telegram renders its
  // og:image, which is already our 1200x630 crop on our own origin.
  const sent = await postText(
    env.BOT_TOKEN,
    chat,
    renderDigest(events, lang, today),
    eventUrl(events[0] ?? { id: '', t: '', s: '' }, lang),
    fetchFn,
  );
  // Remember only what was actually said. Recording a failed send as posted is
  // how the first channel post vanished: the run reported success, the events
  // were struck off, and the channel stayed empty.
  if (!sent.ok) return { kind: 'failed', error: sent.error };
  const remembered = events.reduce(
    (list: readonly string[], event) => rememberPosted(list, event.id, MEMORY),
    posted,
  );
  await env.EVENTS.put(POSTED_KEY, JSON.stringify(remembered));
  return { kind: 'posted', events: events.length, messageId: sent.messageId };
};
