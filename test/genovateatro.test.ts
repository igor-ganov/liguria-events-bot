// genoa-events design §4.3 — genovateatro collector on the live-captured fixture.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canonicalVenue,
  makeGenovateatroCollector,
  parseGenovateatroDetail,
  parseGenovateatroHtml,
  venueOfTheatrePath,
} from '../src/collectors/genovateatro.ts';
import type { RawEvent } from '../src/domain/event.ts';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

const html = fixture('genovateatro-list.html');

const BASE = 'https://www.genovateatro.it';
const EVENT = `${BASE}/eventi/2026-2027`;

/** A site double: the pages it knows answer from fixtures, the rest 404 —
 *  so every test also proves what happens when a page is missing. */
const siteOf =
  (pages: Readonly<Record<string, string>>) =>
  async (url: string): Promise<Response> => {
    const name = pages[url];
    return name === undefined
      ? new Response('', { status: 404 })
      : new Response(fixture(name), { status: 200 });
  };

/** The site as it stood on 2026-10-25: home, the agenda, one topic page and a
 *  handful of show pages. */
const LIVE_SITE: Readonly<Record<string, string>> = {
  [`${BASE}/`]: 'genovateatro-home.html',
  [`${BASE}/eventi/`]: 'genovateatro-eventi.html',
  [`${BASE}/argomenti/danza.htm`]: 'genovateatro-argomenti-danza.html',
  [`${EVENT}/teatrodellatosse/can-can.htm`]: 'genovateatro-detail-can-can.html',
  [`${EVENT}/teatrodellatosse/kaguya-hime.htm`]: 'genovateatro-detail-kaguya-hime.html',
  [`${EVENT}/teatronazionale/ci-vediamo-all-alba.htm`]:
    'genovateatro-detail-ci-vediamo-all-alba.html',
  [`${EVENT}/gog/alessandro-baricco-notte-eretica-2026-2027.htm`]: 'genovateatro-detail-baricco.html',
};

const collectLive = async (): Promise<readonly RawEvent[]> =>
  (await makeGenovateatroCollector(siteOf(LIVE_SITE))()).events;

const byUrl = (events: readonly RawEvent[], url: string): RawEvent | undefined =>
  events.find((event) => event.url === url);

describe('parseGenovateatroHtml (fixture)', () => {
  test('extracts theatre events with ranges and abstracts', async () => {
    const events = await parseGenovateatroHtml(html);
    assert.ok(events.length >= 5, `expected ≥5 events, got ${events.length}`);
    for (const event of events) {
      assert.match(event.startDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(event.url, /^https:\/\/www\.genovateatro\.it\/eventi\//);
      assert.equal(event.categoryHint, 'theatre');
      assert.equal(event.source, 'genovateatro');
    }
    const gothica = events.find((event) => event.title === 'Gothica');
    assert.ok(gothica !== undefined);
    assert.equal(gothica.startDate, '2026-07-02');
    assert.equal(gothica.endDate, '2026-07-26');
    assert.ok(gothica.rawDescription !== undefined && gothica.rawDescription.includes('immersiva'));
  });
});

describe('parseGenovateatroDetail (fixture)', () => {
  test('reads the run, the place and the body of a show page', async () => {
    const detail = await parseGenovateatroDetail(fixture('genovateatro-detail-can-can.html'));
    assert.equal(detail.title, 'Can Can');
    assert.deepEqual(detail.dates, { startDate: '2026-10-30', endDate: '2026-11-01' });
    assert.equal(detail.location, 'Teatro della Tosse, piazza Renato Negri 4, Genova');
    assert.ok(detail.description !== undefined && detail.description.length > 40);
  });
});

describe('genovateatro venues', () => {
  test('spells a venue the way the rest of the corpus does', () => {
    assert.equal(canonicalVenue('GOG Teatro Carlo Felice'), 'Teatro Carlo Felice');
    assert.equal(canonicalVenue('GOG Palazzo Spinola'), 'Palazzo Spinola');
    assert.equal(canonicalVenue('Teatro Duse'), 'Teatro Eleonora Duse');
    assert.equal(canonicalVenue("Teatro dell'Arca Sandro Baldacci"), "Teatro dell'Arca Sandro Baldacci");
  });

  test('names the house a show page belongs to, only where the house has one stage', () => {
    assert.equal(venueOfTheatrePath(`${EVENT}/teatrodellatosse/kaguya-hime.htm`), 'Teatro della Tosse');
    assert.equal(venueOfTheatrePath(`${EVENT}/teatrogovi/MC45OTUYMTQWMCAXNZKYMDK2NJUY.htm`), 'Teatro Rina e Gilberto Govi');
    assert.equal(venueOfTheatrePath(`${EVENT}/laquintapraticabile/x.htm`), 'Teatro Instabile');
    // Teatro Nazionale runs four stages; GOG and Lunaria play all over town.
    assert.equal(venueOfTheatrePath(`${EVENT}/teatronazionale/oceano-nox.htm`), undefined);
    assert.equal(venueOfTheatrePath(`${EVENT}/gog/giuseppe-gibboni-2026-2027.htm`), undefined);
    assert.equal(venueOfTheatrePath(`${EVENT}/lunariateatro/x.htm`), undefined);
  });
});

describe('makeGenovateatroCollector', () => {
  test('reports failed on errors without throwing (AC-1.3)', async () => {
    const dead = async (): Promise<Response> => {
      throw new Error('down');
    };
    const outcome = await makeGenovateatroCollector(dead)();
    assert.equal(outcome.failed, true);
  });

  // The agenda at /eventi/ shows only the next ten shows, with no further
  // pages; Can Can was never among them, so it never reached the corpus.
  test('collects the shows the home page lists beyond the agenda (Can Can)', async () => {
    const events = await collectLive();
    const canCan = byUrl(events, `${EVENT}/teatrodellatosse/can-can.htm`);
    assert.ok(canCan !== undefined, 'Can Can is missing');
    assert.equal(canCan.title, 'Can Can');
    assert.equal(canCan.startDate, '2026-10-30');
    assert.equal(canCan.endDate, '2026-11-01');
  });

  test('collects the shows the topic pages list further out', async () => {
    const events = await collectLive();
    const body = byUrl(events, `${EVENT}/teatrodellatosse/body-of-memory.htm`);
    assert.ok(body !== undefined, 'Body of memory is missing');
    assert.equal(body.startDate, '2026-11-25');
    assert.equal(body.venue, 'Teatro della Tosse');
  });

  test('gives every show its venue', async () => {
    const events = await collectLive();
    assert.ok(events.length >= 15, `expected ≥15 events, got ${events.length}`);
    const venueless = events.filter((event) => event.venue === undefined).map((event) => event.url);
    assert.deepEqual(venueless, []);
  });

  test('takes venue and address from the show page', async () => {
    const events = await collectLive();
    const kaguya = byUrl(events, `${EVENT}/teatrodellatosse/kaguya-hime.htm`);
    assert.equal(kaguya?.venue, 'Teatro della Tosse');
    assert.equal(kaguya?.address, 'Teatro della Tosse, piazza Renato Negri 4, Genova');
    const alba = byUrl(events, `${EVENT}/teatronazionale/ci-vediamo-all-alba.htm`);
    assert.equal(alba?.venue, 'Teatro Eleonora Duse');
    assert.equal(alba?.address, 'Teatro Eleonora Duse, Via Nicolò Bacigalupo 6, Genova');
    assert.equal(alba?.startDate, '2026-10-23');
    assert.equal(alba?.endDate, '2026-10-31');
    const baricco = byUrl(events, `${EVENT}/gog/alessandro-baricco-notte-eretica-2026-2027.htm`);
    assert.equal(baricco?.venue, 'Teatro Carlo Felice');
    assert.equal(baricco?.address, 'Teatro Carlo Felice, Passo Eugenio Montale 4, Genova');
  });

  // The home page dates a card by its NEXT performance, not by its run: a
  // show seen only there, whose own page did not answer, has no start date we
  // can trust — publishing the next performance as the start would re-date
  // (and so duplicate) the show every day it runs.
  test('skips a home-only show whose page did not answer', async () => {
    const events = await collectLive();
    assert.equal(byUrl(events, `${EVENT}/teatronazionale/ave-maria.htm`), undefined);
  });

  test('falls back to the house in the path when nothing names the venue', async () => {
    const outcome = await makeGenovateatroCollector(
      siteOf({ [`${BASE}/eventi/`]: 'genovateatro-list.html' }),
    )();
    assert.equal(outcome.failed, false);
    const gothica = outcome.events.find((event) => event.title === 'Gothica');
    assert.equal(gothica?.venue, 'Teatro della Tosse');
    assert.equal(gothica?.address, undefined);
    const garage = outcome.events.filter((event) => event.url.includes('/teatrogarage/'));
    assert.ok(garage.length > 0 && garage.every((event) => event.venue === 'Teatro Garage'));
  });

  test('reports failed only when no listing answers', async () => {
    const outcome = await makeGenovateatroCollector(siteOf({}))();
    assert.equal(outcome.failed, true);
  });
});
