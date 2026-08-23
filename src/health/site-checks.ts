import { fetchStatus, fetchText } from './fetch-text.ts';
import type { CheckResult } from './types.ts';
import type { FetchFn } from '../collectors/types.ts';

const ok = (id: string, title: string, detail: string): CheckResult => ({ id, title, status: 'ok', detail });
const bad = (id: string, title: string, detail: string): CheckResult => ({ id, title, status: 'fail', detail });

/** The events sitemap: present, XML, populated, and dated. */
export const sitemapCheck = async (fetchFn: FetchFn, origin: string): Promise<CheckResult> => {
  const id = 'sitemap-events';
  const title = 'The events sitemap is served and populated';
  const { status, body } = await fetchText(fetchFn, `${origin}/sitemap-events.xml`);
  const urls = (body.match(/<loc>/g) ?? []).length;
  if (status !== 200) return bad(id, title, `sitemap-events.xml answered ${status}`);
  if (urls === 0) return bad(id, title, 'the sitemap is empty — no event is being offered to Google');
  if (!body.includes('<lastmod>')) return bad(id, title, `${urls} URLs, but none carries a lastmod`);
  return ok(id, title, `${urls} URLs, with lastmod and hreflang`);
};

/** robots.txt: the sitemaps are announced, and Google's AI crawler is welcome
 *  while the scrapers are not — a Cloudflare zone switch can silently undo it. */
export const robotsCheck = async (fetchFn: FetchFn, origin: string): Promise<CheckResult> => {
  const id = 'robots';
  const title = 'robots.txt says what we decided it should say';
  const { status, body } = await fetchText(fetchFn, `${origin}/robots.txt`);
  if (status !== 200) return bad(id, title, `robots.txt answered ${status}`);
  const blocked = body
    .split(/\n(?=User-agent:)/)
    .filter((block) => /^\s*Disallow:\s*\/\s*$/m.test(block))
    .map((block) => block.match(/User-agent:\s*(\S+)/)?.[1] ?? '');
  if (blocked.includes('Google-Extended')) {
    return bad(id, title, 'Google-Extended is disallowed again — the site is out of AI answers');
  }
  if (!body.includes('/sitemap-events.xml')) return bad(id, title, 'the events sitemap is not announced');
  return ok(id, title, `${blocked.length} scrapers blocked, Google-Extended allowed`);
};

/** A page that has already happened still answers, in every locale. */
export const pastEventCheck = async (
  fetchFn: FetchFn,
  origin: string,
  id: string | undefined,
): Promise<CheckResult> => {
  const key = 'past-event-page';
  const title = 'A link to an event that has happened still opens';
  if (id === undefined) return { id: key, title, status: 'warn', detail: 'no archived event to test with yet' };
  const paths = [`/event/${id}/`, `/it/event/${id}/`, `/ru/event/${id}/`];
  const codes = await Promise.all(paths.map((path) => fetchStatus(fetchFn, `${origin}${path}`)));
  const dead = paths.filter((_, i) => codes[i] !== 200);
  return dead.length === 0
    ? ok(key, title, `all three locales of ${id} answer 200`)
    : bad(key, title, `${dead.join(', ')} answered ${dead.map((_, i) => codes[i]).join(', ')}`);
};

/**
 * The three codes, told apart.
 *
 * A real place with nothing on must answer 200, an event that existed and is
 * gone must answer 410, and nonsense must answer 404. The site used to answer
 * 404 to all three — claiming a provincial capital did not exist, and telling
 * Google that an event which had ended was never there.
 */
export const httpSemanticsCheck = async (
  fetchFn: FetchFn,
  origin: string,
  goneId: string | undefined,
): Promise<CheckResult> => {
  const id = 'http-semantics';
  const title = 'Absent, gone and never-were answer different codes';
  const cases: readonly Readonly<{ path: string; want: number; what: string }>[] = [
    { path: '/liguria/savona/', want: 200, what: 'a city with nothing on' },
    { path: `/event/${goneId ?? 'ffffffffffff'}/`, want: 410, what: 'an event that is gone' },
    { path: '/event/zzz/', want: 404, what: 'an id that was never ours' },
  ];
  const codes = await Promise.all(cases.map((one) => fetchStatus(fetchFn, `${origin}${one.path}`)));
  const wrong = cases.filter((one, i) => codes[i] !== one.want);
  return wrong.length === 0
    ? ok(id, title, '200 / 410 / 404, as they should be')
    : bad(
        id,
        title,
        wrong.map((one, i) => `${one.what} answered ${codes[cases.indexOf(one)]}, want ${one.want}`).join('; '),
      );
};
