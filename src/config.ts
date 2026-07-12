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
