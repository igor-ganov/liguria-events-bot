import type { FetchFn } from '../util/http.ts';

export type PostResult = Readonly<{ ok: boolean; messageId?: number; error?: string }>;

/**
 * Send one photo post, and say what happened.
 *
 * The bot wrapper swallows every failure to `undefined`, which is right for a
 * chat reply nobody is waiting on and wrong here: the first channel post
 * failed, the run reported "posted", and the event was recorded as said. A
 * broadcast has to report its own outcome.
 */
export const postPhoto = async (
  token: string,
  chatId: string,
  photo: string,
  caption: string,
  fetchFn: FetchFn = fetch,
): Promise<PostResult> => {
  try {
    const response = await fetchFn(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, photo, caption, parse_mode: 'HTML' }),
    });
    const body: unknown = await response.json();
    const ok = typeof body === 'object' && body !== null && 'ok' in body && body.ok === true;
    const result = typeof body === 'object' && body !== null && 'result' in body ? body.result : undefined;
    const messageId =
      typeof result === 'object' && result !== null && 'message_id' in result
        ? Number(result.message_id)
        : undefined;
    const description =
      typeof body === 'object' && body !== null && 'description' in body
        ? String(body.description)
        : `HTTP ${response.status}`;
    return ok
      ? { ok: true, ...(messageId === undefined ? {} : { messageId }) }
      : { ok: false, error: description };
  } catch (error: unknown) {
    return { ok: false, error: String(error) };
  }
};
