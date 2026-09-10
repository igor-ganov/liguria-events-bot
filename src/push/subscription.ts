import { isLang } from '../domain/event.ts';
import { isPlace } from '../pipeline/place-filter.ts';

/** One device that asked to be woken once a day. No account behind it: the app
 *  has no sign-in, and the push endpoint is the only identity there is. */
export type PushSubscription = Readonly<{
  endpoint: string;
  place: string;
  lang: string;
  hour: number;
}>;

const secure = (endpoint: string): boolean => {
  try {
    return new URL(endpoint).protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * A subscription worth keeping, or nothing.
 *
 * Anyone can post here, and a stored endpoint that is not a URL is a send that
 * fails every morning forever.
 */
export const pushableSubscription = (value: unknown): PushSubscription | undefined => {
  const endpoint = String((value as Record<string, unknown>)?.['endpoint'] ?? '');
  const place = String((value as Record<string, unknown>)?.['place'] ?? '');
  const lang = String((value as Record<string, unknown>)?.['lang'] ?? '');
  const hour = Number((value as Record<string, unknown>)?.['hour'] ?? -1);
  return [{ endpoint, place, lang, hour }]
    .filter((candidate) => secure(candidate.endpoint))
    .filter((candidate) => isPlace(candidate.place))
    .filter((candidate) => isLang(candidate.lang))
    .filter((candidate) => Number.isInteger(candidate.hour) && candidate.hour >= 0 && candidate.hour <= 23)
    .at(0);
};

/** Where a subscription is filed: its own endpoint, hashed. The same device
 *  re-subscribing lands on the same key rather than collecting a second copy
 *  of every notification. */
export const subscriptionKey = async (endpoint: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return `push:${[...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
};
