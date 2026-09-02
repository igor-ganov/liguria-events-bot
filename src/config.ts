/** Worker environment and its small readers. Bindings are typed structurally
 *  (KvLike/AiBinding) so tests can inject in-memory doubles; the real
 *  KVNamespace and Ai bindings satisfy them. */
import type { AiBinding } from './llm/client.ts';
import type { KvLike } from './pipeline/store.ts';
import { asArray, parseJson } from './util/json.ts';

export type Env = Readonly<{
  EVENTS: KvLike;
  AI: AiBinding;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  OWNER_CHAT_ID: string;
  GEMINI_API_KEY?: string;
  /** Ticketmaster Discovery consumer key — absent means the collector sits out. */
  TICKETMASTER_KEY?: string;
  TG_CHANNELS?: string;
  SOURCE_PAGES?: string;
  /** Public channel the bot broadcasts to (@username or numeric id). Empty
   *  means the broadcast sits out entirely — no channel, no posts. */
  CHANNEL_CHAT_ID?: string;
  /** The channel's own language; its readers are in Italy. */
  CHANNEL_LANG?: string;
  /** Rome hour the daily post goes out at. */
  CHANNEL_HOUR?: string;
  /** pro-motion collector endpoint and this project's server token. Both
   *  absent means the bot reports nothing, which is the default. */
  PM_ENDPOINT?: string;
  PM_TOKEN?: string;
  /** IndexNow key. The same value must be readable at
   *  https://dovego.it/<key>.txt, which is how the protocol proves ownership.
   *  Empty means no submissions are made. */
  INDEXNOW_KEY?: string;
}>;

export const isOperator = (env: Env, chatId: number): boolean =>
  env.OWNER_CHAT_ID !== '' && String(chatId) === env.OWNER_CHAT_ID;

export const tgChannelsOf = (env: Env): readonly string[] =>
  (asArray(parseJson(env.TG_CHANNELS ?? '[]')) ?? []).filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );

export const sourcePagesOf = (env: Env): number => {
  const pages = Number(env.SOURCE_PAGES ?? '3');
  return Number.isInteger(pages) && pages >= 1 && pages <= 10 ? pages : 3;
};

/** The channel post's hour in Rome, clamped to a real one. */
export const channelHourOf = (env: Env): number => {
  const hour = Number(env.CHANNEL_HOUR ?? '10');
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 10;
};
