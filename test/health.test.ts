// Health checks: each of these guards a bug that actually shipped.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { corpusChecks } from '../src/health/corpus-checks.ts';
import { indexCheck, lastRunCheck } from '../src/health/pipeline-checks.ts';
import {
  analyticsCheck,
  httpSemanticsCheck,
  indexNowKeyCheck,
  ogImageCheck,
  platformFeedCheck,
  robotsCheck,
  sitemapCheck,
} from '../src/health/site-checks.ts';
import { eventMarkupCheck } from '../src/health/markup-checks.ts';
import { classifyFailure, emptyReason, tallyFailures } from '../src/llm/llm-failure.ts';
import { healthAlert } from '../src/health/health-alert.ts';
import { worstOf } from '../src/health/types.ts';
import { toCompact } from '../src/domain/event.ts';
import type { CompactEvent, EventRecord } from '../src/domain/event.ts';
import type { FetchFn } from '../src/collectors/types.ts';

const base: EventRecord = {
  id: 'aaaabbbbcccc',
  title: 'Concerto',
  startDate: '2026-08-20',
  categories: ['music'],
  descriptions: { en: 'A concert.', it: 'Un concerto.', ru: 'Концерт.' },
  url: 'https://example.org',
  source: 'visitgenoa',
  enriched: true,
  addedAt: 1,
};

const compact = (over: Partial<EventRecord> = {}): CompactEvent => toCompact({ ...base, ...over });

// Typed as FetchFn directly rather than cast into it, so a signature change
// breaks the stub instead of being papered over.
const serving = (routes: Readonly<Record<string, Readonly<{ status?: number; body?: string }>>>): FetchFn => {
  const stub: FetchFn = async (input) => {
    const hit = routes[input] ?? { status: 404, body: '' };
    return new Response(hit.body ?? '', { status: hit.status ?? 200 });
  };
  return stub;
};

const statusOf = (checks: readonly { id: string; status: string }[], id: string): string =>
  checks.find((check) => check.id === id)?.status ?? 'missing';

describe('worstOf', () => {
  test('a report is as bad as its worst check', () => {
    assert.equal(worstOf([{ id: 'a', title: '', status: 'ok', detail: '' }, { id: 'b', title: '', status: 'fail', detail: '' }]), 'fail');
    assert.equal(worstOf([{ id: 'a', title: '', status: 'ok', detail: '' }, { id: 'b', title: '', status: 'warn', detail: '' }]), 'warn');
    assert.equal(worstOf([]), 'ok');
  });
});

describe('corpusChecks', () => {
  test('a container whose run disagrees with its programme is caught', () => {
    // The live bug: a lecture series kept endDate 2026-11-04 with one date left.
    const broken = compact({
      kind: 'container',
      startDate: '2026-04-01',
      endDate: '2026-11-04',
      sessions: [{ date: '2026-08-05' }],
    });
    assert.equal(statusOf(corpusChecks([broken]), 'container-span'), 'fail');
    const fixed = { ...broken, s: '2026-08-05' };
    assert.equal(statusOf(corpusChecks([fixed]), 'container-span'), 'ok');
  });

  test('the same evening listed twice is caught', () => {
    const dupes = compact({ sessions: [{ date: '2026-08-05' }, { date: '2026-08-05' }] });
    assert.equal(statusOf(corpusChecks([dupes]), 'session-duplicates'), 'fail');
  });

  test('a description that came back in the wrong script is caught', () => {
    const cjk = compact({ descriptions: { en: 'A concert 近', it: 'Un concerto.', ru: 'Концерт.' } });
    assert.equal(statusOf(corpusChecks([cjk]), 'description-cjk'), 'fail');
    assert.equal(statusOf(corpusChecks([compact()]), 'description-cjk'), 'ok');
  });

  test('an event with nothing written about it is caught', () => {
    const empty = compact({ descriptions: { en: '', it: '', ru: '' } });
    assert.equal(statusOf(corpusChecks([empty]), 'description-present'), 'fail');
  });
});

describe('sitemapCheck', () => {
  const url = 'https://dovego.it/sitemap-events.xml';

  test('an empty sitemap is a failure, not a pass', () => {
    // A sitemap that answers 200 with nothing in it offers Google no events.
    return sitemapCheck(serving({ [url]: { body: '<urlset></urlset>' } }), 'https://dovego.it').then((check) =>
      assert.equal(check.status, 'fail'),
    );
  });

  test('a populated, dated sitemap passes', async () => {
    const body = '<urlset><url><loc>https://dovego.it/event/a/</loc><lastmod>2026-08-20</lastmod></url></urlset>';
    const check = await sitemapCheck(serving({ [url]: { body } }), 'https://dovego.it');
    assert.equal(check.status, 'ok');
    assert.match(check.detail, /1 URLs/);
  });

  test('a missing sitemap says so, with the status it answered', async () => {
    const check = await sitemapCheck(serving({}), 'https://dovego.it');
    assert.equal(check.status, 'fail');
    assert.match(check.detail, /404/);
  });
});

describe('robotsCheck', () => {
  const url = 'https://dovego.it/robots.txt';
  const good = 'User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n\nSitemap: https://dovego.it/sitemap-events.xml\n';

  test('Google-Extended blocked again is a failure — a zone switch can do that', async () => {
    const body = `${good}\nUser-agent: Google-Extended\nDisallow: /\n`;
    const check = await robotsCheck(serving({ [url]: { body } }), 'https://dovego.it');
    assert.equal(check.status, 'fail');
    assert.match(check.detail, /Google-Extended/);
  });

  test('the events sitemap disappearing from robots is a failure', async () => {
    const check = await robotsCheck(serving({ [url]: { body: 'User-agent: *\nAllow: /\n' } }), 'https://dovego.it');
    assert.equal(check.status, 'fail');
  });

  test('the policy we settled on passes', async () => {
    assert.equal((await robotsCheck(serving({ [url]: { body: good } }), 'https://dovego.it')).status, 'ok');
  });
});

describe('eventMarkupCheck', () => {
  const url = 'https://dovego.it/event/abc/';
  const ld = (json: unknown): string =>
    `<html><script type="application/ld+json">${JSON.stringify(json)}</script></html>`;

  test('an event with no location is a failure — Google rejects it outright', async () => {
    const body = ld({ name: 'X', startDate: '2026-08-20', offers: {}, eventStatus: 'S', eventAttendanceMode: 'M' });
    const check = await eventMarkupCheck(serving({ [url]: { body } }), 'https://dovego.it', 'abc');
    assert.equal(check.status, 'fail');
    assert.match(check.detail, /location/);
  });

  test('a location without a postal address is a failure too', async () => {
    const body = ld({
      name: 'X', startDate: '2026-08-20', offers: {}, eventStatus: 'S', eventAttendanceMode: 'M',
      location: { '@type': 'Place', name: 'Teatro' },
    });
    const check = await eventMarkupCheck(serving({ [url]: { body } }), 'https://dovego.it', 'abc');
    assert.equal(check.status, 'fail');
    assert.match(check.detail, /postal address/);
  });

  test('the complete document passes', async () => {
    const body = ld({
      name: 'X', startDate: '2026-08-20T21:00:00+02:00', offers: {}, eventStatus: 'S', eventAttendanceMode: 'M',
      location: { '@type': 'Place', address: { addressCountry: 'IT' } },
    });
    assert.equal((await eventMarkupCheck(serving({ [url]: { body } }), 'https://dovego.it', 'abc')).status, 'ok');
  });
});

describe('pipeline checks', () => {
  const now = Date.parse('2026-08-23T12:00:00Z');

  test('a crawl that stopped is a failure, a late one a warning', () => {
    const hoursAgo = (h: number) => [{ at: Math.floor((now - h * 3_600_000) / 1000), enrichedOk: 5, enrichFailed: 0 }];
    assert.equal(statusOf(lastRunCheck(hoursAgo(2), now), 'crawl-recent'), 'ok');
    assert.equal(statusOf(lastRunCheck(hoursAgo(9), now), 'crawl-recent'), 'warn');
    assert.equal(statusOf(lastRunCheck(hoursAgo(30), now), 'crawl-recent'), 'fail');
    assert.equal(statusOf(lastRunCheck([], now), 'crawl-recent'), 'fail');
  });

  test('enrichment failing more than it succeeds is a failure', () => {
    const entry = [{ at: Math.floor(now / 1000), enrichedOk: 2, enrichFailed: 10 }];
    assert.equal(statusOf(lastRunCheck(entry, now), 'enrich-health'), 'fail');
  });

  test('an empty index is a failure — the site would have nothing to show', () => {
    assert.equal(statusOf(indexCheck([], '2026-08-20'), 'index-size'), 'fail');
    assert.equal(statusOf(indexCheck([compact()], '2026-08-20'), 'index-size'), 'warn');
  });
});

describe('healthAlert', () => {
  const report = (status: 'ok' | 'warn' | 'fail', checks: readonly { id: string; title: string; status: 'ok' | 'warn' | 'fail'; detail: string }[]) =>
    ({ at: 0, status, checks });

  test('a verdict that has not moved says nothing — hourly alerts train silence', () => {
    const failing = report('fail', [{ id: 'a', title: 'X', status: 'fail', detail: 'broken' }]);
    assert.equal(healthAlert(failing, 'fail'), undefined);
    assert.equal(healthAlert(report('ok', []), 'ok'), undefined);
  });

  test('a new problem is announced, with what is wrong in the message', () => {
    const message = healthAlert(
      report('fail', [
        { id: 'a', title: 'A link to a past event still opens', status: 'fail', detail: '/it/... answered 404' },
        { id: 'b', title: 'Fine', status: 'ok', detail: '' },
      ]),
      'ok',
    );
    assert.match(message ?? '', /A link to a past event still opens/);
    assert.match(message ?? '', /404/);
    assert.equal((message ?? '').includes('Fine'), false); // passing checks are not news
  });

  test('recovery closes the loop the alert opened', () => {
    assert.match(healthAlert(report('ok', []), 'fail') ?? '', /restored/);
  });
});

describe('classifyFailure', () => {
  test('the reasons that need different fixes are told apart', () => {
    assert.equal(classifyFailure(new Error('workers-ai timeout')), 'timeout');
    assert.equal(classifyFailure(new Error('http 429')), 'rate-limit');
    assert.equal(classifyFailure(new Error('http 503')), 'http-error');
    assert.equal(classifyFailure(new Error('Unexpected token < in JSON')), 'bad-json');
    assert.equal(classifyFailure(new Error('model overloaded')), 'overloaded');
    assert.equal(classifyFailure(undefined), 'unknown');
  });

  test('reasons are tallied, so the log carries counts rather than stacks', () => {
    assert.deepEqual(tallyFailures(['timeout', 'timeout', 'rate-limit']), {
      timeout: 2,
      'rate-limit': 1,
    });
    assert.deepEqual(tallyFailures([]), {});
  });

  test('the health check names the dominant reason', () => {
    const now = Date.parse('2026-08-23T12:00:00Z');
    const entry = [
      { at: Math.floor(now / 1000), enrichedOk: 11, enrichFailed: 6, enrichErrors: { timeout: 5, 'rate-limit': 1 } },
    ];
    const check = lastRunCheck(entry, now).find((c) => c.id === 'enrich-health');
    assert.match(check?.detail ?? '', /timeout×5/);
  });
});

describe('classifyFailure: the provider chain', () => {
  test('the aggregate keeps each provider’s reason, so the fallback is visible', () => {
    assert.equal(
      classifyFailure(new Error('all LLM providers failed: workers-ai=timeout, gemini=unused')),
      'workers-ai=timeout,gemini=unused',
    );
    assert.equal(
      classifyFailure(new Error('all LLM providers failed: workers-ai=timeout, gemini=rate-limit')),
      'workers-ai=timeout,gemini=rate-limit',
    );
  });
});

describe('emptyReason', () => {
  test('a reply cut off mid-object is truncation, not a refusal', () => {
    // Live data: the model answered with a well-formed opening and simply ran
    // out of tokens, which is a token-budget fix, not a prompt fix.
    assert.equal(emptyReason('```json\n{ "events": [ { "id": "abc", "categories"'), 'truncated');
  });

  test('a complete answer that still yielded nothing is a parse problem', () => {
    assert.equal(emptyReason('{ "events": [] }'), 'unparsed');
    assert.equal(emptyReason('```json\n{ "events": [] }\n```'), 'unparsed');
  });

  test('silence is its own reason', () => {
    assert.equal(emptyReason('   '), 'no-answer');
  });
});

describe('httpSemanticsCheck', () => {
  const base = 'https://dovego.it';
  const routes = (city: number, gone: number, nonsense: number) =>
    serving({
      [`${base}/liguria/savona/`]: { status: city },
      [`${base}/event/1e6b4b74d225/`]: { status: gone },
      [`${base}/event/zzz/`]: { status: nonsense },
    });

  test('200 / 410 / 404 is the shape it wants', async () => {
    const check = await httpSemanticsCheck(routes(200, 410, 404), base, '1e6b4b74d225');
    assert.equal(check.status, 'ok');
  });

  test('a city answering 404 is caught, and named', async () => {
    // Savona is a provincial capital. It answered 404 because the city list was
    // derived from events rather than from the place table.
    const check = await httpSemanticsCheck(routes(404, 410, 404), base, '1e6b4b74d225');
    assert.equal(check.status, 'fail');
    assert.match(check.detail, /city with nothing on answered 404/);
  });

  test('a gone event falling back to 404 is caught', async () => {
    const check = await httpSemanticsCheck(routes(200, 404, 404), base, '1e6b4b74d225');
    assert.equal(check.status, 'fail');
    assert.match(check.detail, /gone answered 404, want 410/);
  });

  test('nonsense answering 410 is caught too — the signal must stay meaningful', async () => {
    const check = await httpSemanticsCheck(routes(200, 410, 410), base, '1e6b4b74d225');
    assert.equal(check.status, 'fail');
    assert.match(check.detail, /never ours answered 410/);
  });
});

describe('ogImageCheck', () => {
  const base = 'https://dovego.it';
  const head = (image: string) => `<html><head><meta property="og:image" content="${image}"></head></html>`;
  const proxied = `${base}/cdn-cgi/image/width=1200,height=630,fit=cover/img/aHR0cHM6Ly9z`;
  const branded = `${base}/og-default.jpg`;

  const pages = (...images: readonly string[]) =>
    serving({
      [`${base}/liguria/`]: { body: head(images[0] ?? '') },
      [`${base}/liguria/genova/`]: { body: head(images[1] ?? '') },
      [`${base}/liguria/genova/teatro-carlo-felice/`]: { body: head(images[2] ?? '') },
      [`${base}/event/aaaabbbbcccc/`]: { body: head(images[3] ?? '') },
    });

  test('every page carrying one of ours passes, and says how many are photographs', async () => {
    const check = await ogImageCheck(pages(proxied, proxied, branded, proxied), base, 'aaaabbbbcccc');
    assert.equal(check.status, 'ok');
    assert.equal(check.detail, '3 of 4 show a real photograph');
  });

  test('the brand card is an answer, not a failure — an empty city has no photo', async () => {
    const check = await ogImageCheck(pages(branded, branded, branded, branded), base, 'aaaabbbbcccc');
    assert.equal(check.status, 'ok');
  });

  test('a page with no preview image at all is named', async () => {
    const check = await ogImageCheck(pages(proxied, '', proxied, proxied), base, 'aaaabbbbcccc');
    assert.equal(check.status, 'fail');
    assert.ok(check.detail.includes('/liguria/genova/'));
  });

  test('a hot-linked image is a failure — it is not ours to serve or to crop', async () => {
    const check = await ogImageCheck(
      pages(proxied, 'https://s1.ticketm.net/dam/a/1.jpg', proxied, proxied),
      base,
      'aaaabbbbcccc',
    );
    assert.equal(check.status, 'fail');
  });
});

describe('indexNowKeyCheck', () => {
  const base = 'https://dovego.it';
  const key = '7cdb864289c94f1ab158818ddba854f4';

  test('served and matching is the whole requirement', async () => {
    const check = await indexNowKeyCheck(serving({ [`${base}/${key}.txt`]: { body: key } }), base, key);
    assert.equal(check.status, 'ok');
  });

  test('a missing file is a failure — every submission after it is refused', async () => {
    const check = await indexNowKeyCheck(serving({}), base, key);
    assert.equal(check.status, 'fail');
  });

  test('a file serving something else is caught, not trusted for existing', async () => {
    // A catch-all route or an SPA fallback answers 200 with a page, not a key.
    const check = await indexNowKeyCheck(
      serving({ [`${base}/${key}.txt`]: { body: '<!doctype html>' } }),
      base,
      key,
    );
    assert.equal(check.status, 'fail');
  });

  test('no key configured is a warning, not a failure — nothing is broken', async () => {
    const check = await indexNowKeyCheck(serving({}), base, '');
    assert.equal(check.status, 'warn');
  });
});

describe('analyticsCheck', () => {
  const base = 'https://dovego.it';

  test('the beacon on the page is the whole requirement', async () => {
    const body = '<html><head><script data-cf-beacon=\'{"token":"x"}\'></script></head></html>';
    const check = await analyticsCheck(serving({ [`${base}/liguria/`]: { body } }), base);
    assert.equal(check.status, 'ok');
  });

  test('a page without it fails, because a flat dashboard looks like no traffic', async () => {
    const check = await analyticsCheck(serving({ [`${base}/liguria/`]: { body: '<html></html>' } }), base);
    assert.equal(check.status, 'fail');
  });
});

describe('platformFeedCheck', () => {
  const base = 'https://dovego.it';
  const feed = `${base}/api/events/published.json`;
  const page = (id: string) => `${base}/event/${id}/`;
  const indexable = '<html><head><title>x</title></head></html>';
  const hidden = '<html><head><meta name="robots" content="noindex, nofollow"></head></html>';

  test('an empty feed is an answer, not a failure', async () => {
    const check = await platformFeedCheck(serving({ [feed]: { body: '[]' } }), base);
    assert.equal(check.status, 'ok');
  });

  test('every sampled page indexable is what it wants', async () => {
    const check = await platformFeedCheck(
      serving({
        [feed]: { body: JSON.stringify([{ id: 'aaa' }, { id: 'bbb' }]) },
        [page('aaa')]: { body: indexable },
        [page('bbb')]: { body: indexable },
      }),
      base,
    );
    assert.equal(check.status, 'ok');
    assert.ok(check.detail.includes('2 sampled'));
  });

  test('a link-only event in the public feed is caught, and named', async () => {
    // The one clause between a private invitation and a city feed.
    const check = await platformFeedCheck(
      serving({
        [feed]: { body: JSON.stringify([{ id: 'aaa' }, { id: 'leaked' }]) },
        [page('aaa')]: { body: indexable },
        [page('leaked')]: { body: hidden },
      }),
      base,
    );
    assert.equal(check.status, 'fail');
    assert.ok(check.detail.includes('leaked'));
  });

  test('a feed that will not answer is a failure, not an empty pass', async () => {
    const check = await platformFeedCheck(serving({}), base);
    assert.equal(check.status, 'fail');
  });

  test('a body that is not JSON does not throw the whole report', async () => {
    const check = await platformFeedCheck(serving({ [feed]: { body: '<html>' } }), base);
    assert.equal(check.status, 'ok');
  });
});
