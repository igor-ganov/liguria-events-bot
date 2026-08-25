import { readProp } from '../util/json.ts';
import type { FetchFn } from '../util/http.ts';

/**
 * Take a post back down.
 *
 * A broadcast can be wrong — a bad crop, a description that read badly, a test
 * post left in a public channel. Without this the only way to pull one is to
 * open Telegram by hand, which is not a thing an operator should have to do to
 * undo something the worker did.
 */
export const deletePost = async (
  token: string,
  chatId: string,
  messageId: number,
  fetchFn: FetchFn = fetch,
): Promise<Readonly<{ ok: boolean; error?: string }>> => {
  try {
    const response = await fetchFn(`https://api.telegram.org/bot${token}/deleteMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    });
    const body: unknown = await response.json();
    return readProp(body, 'ok') === true
      ? { ok: true }
      : { ok: false, error: String(readProp(body, 'description') ?? `HTTP ${response.status}`) };
  } catch (error: unknown) {
    return { ok: false, error: String(error) };
  }
};
