// Health checks: each of these guards a bug that actually shipped.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { corpusChecks } from '../src/health/corpus-checks.ts';
import { indexCheck, lastRunCheck } from '../src/health/pipeline-checks.ts';
import { robotsCheck, sitemapCheck } from '../src/health/site-checks.ts';
import { eventMarkupCheck } from '../src/health/markup-checks.ts';
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
