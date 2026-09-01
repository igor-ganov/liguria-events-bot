import type { FetchFn } from '../collectors/types.ts';

export type Fetched = Readonly<{ status: number; body: string }>;

/** A GET reduced to what a check needs, with a failure spelled as status 0 —
 *  a monitor that throws stops monitoring everything after it. */
export const fetchText = async (fetchFn: FetchFn, url: string): Promise<Fetched> => {
  try {
    const res = await fetchFn(url, {
      headers: { 'user-agent': 'DoveGo-healthcheck/1.0 (+https://dovego.it)' },
      signal: AbortSignal.timeout(12_000),
    });
    return { status: res.status, body: await res.text() };
  } catch {
    return { status: 0, body: '' };
  }
};

/** Status only, for the many checks that just ask "does this URL answer?".
 *  `redirect` is 'follow' by default — pass 'manual' when a redirect is itself
 *  the thing being measured rather than a detour on the way to an answer. */
export const fetchStatus = async (
  fetchFn: FetchFn,
  url: string,
  redirect: 'follow' | 'manual' = 'follow',
): Promise<number> => {
  try {
    const res = await fetchFn(url, {
      headers: { 'user-agent': 'DoveGo-healthcheck/1.0 (+https://dovego.it)' },
      signal: AbortSignal.timeout(12_000),
      redirect,
    });
    return res.status;
  } catch {
    return 0;
  }
};
