// genoa-events design §4.2 — mentelocale collector on the live-captured fixture.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  makeMentelocaleCollector,
  makeMentelocaleDetailFetcher,
  parseMentelocaleDetail,
  parseMentelocaleHtml,
} from '../src/collectors/mentelocale.ts';
import { decodeEntities, parseDateRange } from '../src/collectors/italian-dates.ts';
import type { RawEvent } from '../src/domain/event.ts';

const html = readFileSync(
  join(import.meta.dirname, 'fixtures', 'mentelocale-list.html'),
  'utf8',
);

describe('parseDateRange — Italian "al" separator', () => {
  test('Dal … al … ranges', () => {
    assert.deepEqual(parseDateRange('Dal 09/07/2026 al 12/07/2026'), {
      startDate: '2026-07-09',
      endDate: '2026-07-12',
    });
  });
});

describe('parseMentelocaleHtml (fixture)', () => {
  test('extracts dated events with absolute detail urls', async () => {
    const events = await parseMentelocaleHtml(html, 'genova');
    assert.ok(events.length >= 10, `expected ≥10 events, got ${events.length}`);
    for (const event of events) {
      assert.match(event.startDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(event.url, /^https:\/\/www\.mentelocale\.it\/genova\//);
      assert.ok(event.title.length > 3);
      assert.equal(event.source, 'mentelocale');
    }
    const withImage = events.filter((event) => event.image !== undefined);
    assert.ok(withImage.length >= 5, 'expected card images');
    const ranged = events.find((event) => event.endDate !== undefined);
    assert.ok(ranged !== undefined, 'expected at least one multi-day event');
    const trincia = events.find((event) => event.title.includes('sette isole'));
    assert.ok(trincia !== undefined);
    assert.equal(trincia.startDate, '2026-07-06');
  });
});

describe('makeMentelocaleCollector', () => {
  test('reports failed on HTTP errors without throwing (AC-1.3)', async () => {
    const dead = async (): Promise<Response> => new Response('x', { status: 500 });
    const outcome = await makeMentelocaleCollector(dead, 'genova')();
    assert.equal(outcome.failed, true);
    assert.deepEqual(outcome.events, []);
  });
});

// Mirrors the live markup: the body lives in <div class="Testo">, the key facts
// are wrapped in <strong>/<em>, ad blocks sit inside as <span><script>, and the
// time reads "alle 21" (no minutes) — exactly the case that used to yield a
// title-only enrichment and the "no details provided" filler.
const DETAIL_HTML = `<html><body>
  <h1>Concerto</h1>
  <div class="Testo">
    <p><strong>Venerd&igrave; 14 agosto </strong>2026, alle 21, la cornice di
    <strong>Villa Borzino</strong> a Busalla accende i riflettori sul
    <em>Musicamica Liguria Festival</em>.</p>
    <span class="InTextAdv"><script>googletag.cmd.push(function(){});</script></span>
    <p>In programma <strong>Beethoven</strong>, Kreisler e Piazzolla.
    Ingresso a offerta libera.</p>
  </div>
  <div class="Related"><p>Altri eventi che non c'entrano.</p></div>
</body></html>`;

describe('parseMentelocaleDetail', () => {
  test('pulls time, price and the full body (incl. bolded facts), decoding entities', async () => {
    const detail = await parseMentelocaleDetail(DETAIL_HTML);
    assert.equal(detail.time, '21:00'); // "alle 21" → 21:00
    assert.match(detail.priceInfo ?? '', /offerta libera/i);
    const body = detail.rawDescription ?? '';
    assert.ok(body.includes('Villa Borzino'), 'venue (bolded) captured');
    assert.ok(body.includes('Beethoven'), 'programme captured');
    assert.ok(body.includes('Venerdì'), 'entities decoded (Venerdì)');
    assert.ok(!body.includes('googletag'), 'ad script text excluded');
    assert.ok(!body.includes('non c\'entrano'), 'text outside div.Testo excluded');
  });
});

describe('decodeEntities — Italian accents & typographic punctuation', () => {
  test('decodes grave vowels, apostrophes and dashes (named + numeric)', () => {
    assert.equal(decodeEntities('citt&agrave; perch&eacute; l&rsquo;arco &ndash; s&igrave;'), 'città perché l’arco – sì');
    assert.equal(decodeEntities('&#x2019;&#8211;'), '’–');
  });
});

describe('makeMentelocaleDetailFetcher', () => {
  const ev = (o: Partial<RawEvent>): RawEvent => ({
    title: 'x', startDate: '2026-08-14', url: 'https://www.mentelocale.it/genova/1.htm',
    source: 'mentelocale', ...o,
  });

  test('fills mentelocale events lacking a body; skips other sources and already-detailed ones', async () => {
    const fetchFn = async (): Promise<Response> => new Response(DETAIL_HTML, { status: 200 });
    const fill = makeMentelocaleDetailFetcher(fetchFn);
    const out = await fill([
      ev({}),
      ev({ source: 'visitgenoa' }),
      ev({ rawDescription: 'already have it' }),
    ]);
    assert.match(out[0]?.rawDescription ?? '', /Villa Borzino/);
    assert.equal(out[0]?.time, '21:00');
    assert.equal(out[1]?.rawDescription, undefined); // not mentelocale → untouched
    assert.equal(out[2]?.rawDescription, 'already have it'); // kept, not overwritten
  });
});
