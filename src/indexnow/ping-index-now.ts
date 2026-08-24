import { eventUrls } from './event-urls.ts';
import { indexNowBody } from './index-now-body.ts';
import { newSince } from './new-since.ts';
import type { CompactEvent } from '../domain/event.ts';
import type { Env } from '../config.ts';
import type { FetchFn } from '../util/http.ts';

const WATERMARK_KEY = 'indexnow:watermark';
const ENDPOINT = 'https://api.indexnow.org/indexnow';

/**
 * Tell the search engines about new pages the hour they appear.
 *
 * IndexNow is accepted by Bing, Yandex and Seznam and needs no account
 * anywhere — ownership is proved by serving the key at a known URL. That is
 * the whole reason it is worth doing now: Bing Webmaster Tools has been
 * waiting on somebody to log in since this project started, and this does not.
 *
 * Google does not participate. This is not a substitute for the sitemap.
 */
export const pingIndexNow = async (
  env: Env,
  index: readonly CompactEvent[],
  fetchFn: FetchFn = fetch,
): Promise<unknown> => {
  const key = env.INDEXNOW_KEY ?? '';
  if (key === '') return { kind: 'off' };
  const stored = await env.EVENTS.get(WATERMARK_KEY);
  // First run: start from now, do not submit the corpus. IndexNow is for pages
  // that have just appeared; the 1 182 events already in the sitemap are the
  // search engines' problem to have crawled, and offering them all at once got
  // 900 URLs answered with 429 — a batch that would then be retried hourly,
  // for ever, without ever draining.
  if (stored === null || stored === undefined) {
    const highest = Math.max(0, ...index.map((event) => event.cr ?? 0));
    await env.EVENTS.put(WATERMARK_KEY, String(highest));
    return { kind: 'primed', from: highest };
  }
  const fresh = newSince(index, Number(stored));
  if (fresh.length === 0) return { kind: 'nothing-new' };
  const body = indexNowBody(key, fresh.flatMap((event) => eventUrls(event.id)));
  const response = await fetchFn(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  }).catch(() => undefined);
  // The watermark only moves on acceptance: a rejected batch must be retried,
  // not silently dropped along with every URL in it.
  const ok = response !== undefined && response.status >= 200 && response.status < 300;
  if (ok) {
    const highest = Math.max(...fresh.map((event) => event.cr ?? 0));
    await env.EVENTS.put(WATERMARK_KEY, String(highest));
  }
  return { kind: ok ? 'submitted' : 'refused', urls: body.urlList.length, status: response?.status };
};
