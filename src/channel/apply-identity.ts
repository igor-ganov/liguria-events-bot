import { BOT_NAME, CHANNEL_DESCRIPTION, DESCRIPTION, SHORT_DESCRIPTION } from './identity.ts';
import { LANGS } from '../domain/event.ts';
import { readProp } from '../util/json.ts';
import type { Env } from '../config.ts';
import type { FetchFn } from '../util/http.ts';

const AVATAR = 'https://dovego.it/avatar.png';

type Outcome = Readonly<{ step: string; ok: boolean; error?: string }>;

const call = (token: string, fetchFn: FetchFn) =>
  async (step: string, method: string, payload: Readonly<Record<string, unknown>>): Promise<Outcome> => {
    try {
      const response = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json();
      return readProp(body, 'ok') === true
        ? { step, ok: true }
        : { step, ok: false, error: String(readProp(body, 'description') ?? `HTTP ${response.status}`) };
    } catch (error: unknown) {
      return { step, ok: false, error: String(error) };
    }
  };

/** setChatPhoto takes an upload, not a URL, so the picture is fetched from the
 *  site and posted on as multipart. One image, one source of truth. */
const uploadPhoto = async (
  token: string,
  chatId: string,
  fetchFn: FetchFn,
): Promise<Outcome> => {
  try {
    const source = await fetchFn(AVATAR);
    if (!source.ok) return { step: 'chat-photo', ok: false, error: `avatar answered ${source.status}` };
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('photo', new Blob([await source.arrayBuffer()], { type: 'image/png' }), 'avatar.png');
    const response = await fetchFn(`https://api.telegram.org/bot${token}/setChatPhoto`, {
      method: 'POST',
      body: form,
    });
    const body: unknown = await response.json();
    return readProp(body, 'ok') === true
      ? { step: 'chat-photo', ok: true }
      : { step: 'chat-photo', ok: false, error: String(readProp(body, 'description') ?? `HTTP ${response.status}`) };
  } catch (error: unknown) {
    return { step: 'chat-photo', ok: false, error: String(error) };
  }
};

/**
 * Put the bot's and the channel's own descriptions where people read them.
 *
 * Profile copy typed into BotFather once exists in exactly one place, which
 * nobody can review and no deploy can restore. This applies what the repo says,
 * in every language the bot speaks, and reports each step.
 *
 * The bot's OWN avatar is the one thing that cannot be set from here: the Bot
 * API has no method for it, and BotFather is the only way.
 */
export const applyIdentity = async (env: Env, fetchFn: FetchFn = fetch): Promise<unknown> => {
  const send = call(env.BOT_TOKEN, fetchFn);
  const chat = env.CHANNEL_CHAT_ID ?? '';
  const perLanguage = await Promise.all(
    LANGS.flatMap((lang) => [
      send(`short-description:${lang}`, 'setMyShortDescription', {
        short_description: SHORT_DESCRIPTION[lang],
        language_code: lang,
      }),
      send(`description:${lang}`, 'setMyDescription', {
        description: DESCRIPTION[lang],
        language_code: lang,
      }),
    ]),
  );
  const name = await send('name', 'setMyName', { name: BOT_NAME });
  const channel =
    chat === ''
      ? [{ step: 'channel', ok: false, error: 'no channel configured' }]
      : [
          await send('chat-description', 'setChatDescription', {
            chat_id: chat,
            description: CHANNEL_DESCRIPTION,
          }),
          await uploadPhoto(env.BOT_TOKEN, chat, fetchFn),
        ];
  return { steps: [...perLanguage, name, ...channel] };
};
