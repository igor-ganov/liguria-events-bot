import type { IndexNowBody } from './index-now-body.ts';
import type { FetchFn } from '../util/http.ts';

/**
 * Where a submission is offered, in order.
 *
 * The aggregator first, because it fans one batch out to Bing, Yandex, Seznam
 * and Naver at once. Bing's own endpoint second, because the aggregator
 * throttles by sender and this sender is a Cloudflare Worker: measured on
 * 2026-11-15, the same 210 URLs with the same key in the same minute were
 * answered 200 from a laptop and 429 from the Worker. Seventy-two days of
 * "refused" were never about the batch, so no size and no backoff could have
 * cleared them. Bing speaks the same protocol and is the engine that sends
 * this site what search traffic it has.
 */
const ENDPOINTS = ['https://api.indexnow.org/indexnow', 'https://www.bing.com/indexnow'] as const;

const post = async (endpoint: string, body: IndexNowBody, fetchFn: FetchFn): Promise<number> => {
  const response = await fetchFn(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  }).catch(() => undefined);
  return response?.status ?? 0;
};

export type Submission = Readonly<{ status: number; endpoint: string }>;

/**
 * Offer a batch until somebody takes it.
 *
 * Only a 429 is worth asking a second endpoint about: it says "not from you",
 * which another endpoint may well disagree with. A 403 or a 422 is about the
 * key or the URLs, and the next endpoint would say the same thing.
 */
export const submitBatch = async (body: IndexNowBody, fetchFn: FetchFn): Promise<Submission> => {
  let last: Submission = { status: 0, endpoint: ENDPOINTS[0] };
  for (const endpoint of ENDPOINTS) {
    const status = await post(endpoint, body, fetchFn);
    last = { status, endpoint };
    if (status !== 429) return last;
  }
  return last;
};
