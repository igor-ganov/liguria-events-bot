import { asNumber, readProp } from '../util/json.ts';
import type { FetchFn } from '../util/http.ts';

export type PostResult = Readonly<{ ok: boolean; messageId?: number; error?: string }>;

/**
 * Send one channel post, and say what happened.
 *
 * The bot wrapper swallows every failure to `undefined`, which is right for a
 * chat reply nobody is waiting on and wrong here: the first channel post
 * failed, the run reported "posted", and the event was recorded as said. A
 * broadcast has to report its own outcome.
 *
 * `preview` names the link Telegram should render large and above the text —
 * that is where the digest gets its picture, from the page's own og:image,
 * without the worker having to know anything about photographs.
 */
export const postText = async (
  token: string,
  chatId: string,
  text: string,
  preview: string | undefined,
  fetchFn: FetchFn = fetch,
): Promise<PostResult> => {
  try {
    const response = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        link_preview_options:
          preview === undefined
            ? { is_disabled: true }
            : { url: preview, prefer_large_media: true, show_above_text: true },
      }),
    });
    const body: unknown = await response.json();
    const messageId = asNumber(readProp(readProp(body, 'result'), 'message_id'));
    return readProp(body, 'ok') === true
      ? { ok: true, ...(messageId === undefined ? {} : { messageId }) }
      : { ok: false, error: String(readProp(body, 'description') ?? `HTTP ${response.status}`) };
  } catch (error: unknown) {
    return { ok: false, error: String(error) };
  }
};
