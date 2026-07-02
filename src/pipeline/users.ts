/**
 * Known-user registry (reference idiom): every chat that ever wrote to the
 * bot gets a `user:<id>:chat` key; the cron enumerates them for digests and
 * reminders.
 */
import type { KvLike } from './store.ts';

const chatKey = (userId: number): string => `user:${userId}:chat`;
const CHAT_KEY_PATTERN = /^user:(\d+):chat$/;

export const rememberUserChat = async (kv: KvLike, userId: number): Promise<void> =>
  kv.put(chatKey(userId), String(userId));

export const listUserIds = async (kv: KvLike): Promise<readonly number[]> => {
  const ids: number[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: 'user:', ...(cursor === undefined ? {} : { cursor }) });
    for (const key of page.keys) {
      const match = CHAT_KEY_PATTERN.exec(key.name);
      if (match?.[1] !== undefined) ids.push(Number(match[1]));
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor !== undefined);
  return ids;
};
