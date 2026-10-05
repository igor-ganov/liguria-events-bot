import { channelUtm } from '../links/channel-utm.ts';
import { eventUrl } from './event-url.ts';
import { withUtm } from '../links/with-utm.ts';
import { inRegion } from './in-region.ts';
import { pickDigest } from './pick-digest.ts';
import { postText } from './post-text.ts';
import { postedKey } from './posted-key.ts';
import { readPosted } from './read-posted.ts';
import { regionLabel } from './region-label.ts';
import { rememberPosted } from './remember-posted.ts';
import { renderDigest } from './render-digest.ts';
import type { Channel } from './channel-entry.ts';
import type { CompactEvent } from '../domain/event.ts';
import type { Env } from '../config.ts';
import type { FetchFn } from '../util/http.ts';

const MEMORY = 400;
/** Below this the region has nothing to report, and a digest of one line is
 *  worse than no post at all. */
const MINIMUM = 3;

/** What became of one channel's post. A union rather than a bag of optional
 *  fields: "posted" always has a count, "nothing-to-say" always has the number
 *  it fell short by, and neither carries an error nobody set. The two fields
 *  that come back from Telegram admit `undefined` because Telegram may answer
 *  without them. */
export type ChannelResult =
  | Readonly<{ region: string; kind: 'posted'; events: number; messageId?: number | undefined }>
  | Readonly<{ region: string; kind: 'nothing-to-say'; found: number }>
  | Readonly<{ region: string; kind: 'failed'; error?: string | undefined }>;

/**
 * One channel's post for today.
 *
 * It stays silent when its own region has nothing on. Silence in Molise on a
 * Tuesday is the system working; the same silence in Lombardia is not, which
 * is why the answer says which it was instead of returning nothing.
 */
export const postChannel = async (
  env: Env,
  channel: Channel,
  index: readonly CompactEvent[],
  today: string,
  fetchFn: FetchFn = fetch,
): Promise<ChannelResult> => {
  const { region, chat, lang } = channel;
  const posted = await readPosted(env, region);
  const events = pickDigest(inRegion(index, region), today, posted);
  if (events.length < MINIMUM) return { region, kind: 'nothing-to-say', found: events.length };
  // The picture comes from the first event's own page: Telegram renders its
  // og:image, which is already our 1200x630 crop on our own origin.
  const text = renderDigest(events, lang, today, regionLabel(region));
  const first = events[0] ?? { id: '', t: '', s: '' };
  const sent = await postText(
    env.BOT_TOKEN,
    chat,
    text,
    withUtm(eventUrl(first, lang), channelUtm(today)),
    fetchFn,
  );
  // Remember only what was actually said. Recording a failed send as posted is
  // how the first channel post vanished: the run reported success, the events
  // were struck off, and the channel stayed empty.
  if (!sent.ok) return { region, kind: 'failed', error: sent.error };
  const remembered = events.reduce(
    (list: readonly string[], event) => rememberPosted(list, event.id, MEMORY),
    posted,
  );
  await env.EVENTS.put(postedKey(region), JSON.stringify(remembered));
  return { region, kind: 'posted', events: events.length, messageId: sent.messageId };
};
