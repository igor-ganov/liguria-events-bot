import { pushableSubscription, subscriptionKey } from './subscription.ts';
import type { PushSubscription } from './subscription.ts';
import type { KvLike } from '../pipeline/store.ts';
import { parseJson } from '../util/json.ts';

/** Keep a device's request to be woken. Re-subscribing overwrites: the key is
 *  the endpoint, so one device is one row however often it asks. */
export const writeSubscription = async (kv: KvLike, sub: PushSubscription): Promise<void> =>
  kv.put(await subscriptionKey(sub.endpoint), JSON.stringify(sub));

export const dropSubscription = async (kv: KvLike, endpoint: string): Promise<void> =>
  kv.delete(await subscriptionKey(endpoint));

/** Every device waiting to be woken. A row that no longer decodes is skipped
 *  rather than throwing: one bad value must not stop the morning's send. */
export const readSubscriptions = async (kv: KvLike): Promise<readonly PushSubscription[]> => {
  const found: PushSubscription[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: 'push:', ...(cursor === undefined ? {} : { cursor }) });
    const values = await Promise.all(page.keys.map((key) => kv.get(key.name)));
    values
      .map((raw) => pushableSubscription(parseJson(raw ?? '')))
      .forEach((sub) => [sub].filter((one) => one !== undefined).forEach((one) => found.push(one)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor !== undefined);
  return found;
};
