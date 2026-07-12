// One parser for every site that publishes its events as schema.org data.
// The regression it guards: visitlazio emits one JSON-LD block per DAY of an
// event's run — "Sapori della Maremma" twenty-five times — and taken literally
// that is twenty-five events in the feed instead of one lasting twenty-five days.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { collapseRuns, parseJsonLdEvent, parseJsonLdHtml } from '../src/collectors/jsonld.ts';
import type { JsonLdSite } from '../src/collectors/jsonld.ts';

const site: JsonLdSite = {
  source: 'visitlazio',
  url: 'https://www.visitlazio.com/eventi',
  fallbackCity: 'roma',
};

const ld = (over: Record<string, unknown> = {}) => ({
  '@type': 'Event',
  name: 'Rieti Terminillo, la leggendaria cronoscalata',
  startDate: '2026-07-10',
  endDate: '2026-07-12',
  location: { '@type': 'Place', name: 'Monte Terminillo (RI)' },
  url: 'https://www.visitlazio.com/eventi-lazio/rieti-terminillo/',
  offers: { price: '0', priceCurrency: 'EUR' },
  description: 'La 61ª edizione della cronoscalata.',
  image: 'https://img/cover.jpg',
  ...over,
});

describe('parseJsonLdEvent', () => {
  test('the province in the place is what files the event', () => {
    const [raw] = parseJsonLdEvent(ld(), site);
    assert.equal(raw?.city, 'rieti');
    assert.equal(raw?.venue, 'Monte Terminillo');
    assert.equal(raw?.priceInfo, 'Ingresso libero');
    assert.equal(raw?.image, 'https://img/cover.jpg');
  });

  test('a place with no province falls back to the site\'s own region', () => {
    const [raw] = parseJsonLdEvent(ld({ location: { name: 'Auditorium' } }), site);
    assert.equal(raw?.city, 'roma');
  });

  test('a timestamped date keeps the day and the time apart', () => {
    const [raw] = parseJsonLdEvent(ld({ startDate: '2026-07-10T21:30' }), site);
    assert.equal(raw?.startDate, '2026-07-10');
    assert.equal(raw?.time, '21:30');
  });

  test('junk yields nothing rather than half an event', () => {
    assert.deepEqual(parseJsonLdEvent({ '@type': 'Event' }, site), []);
    assert.deepEqual(parseJsonLdEvent(undefined, site), []);
  });
});

describe('collapseRuns', () => {
  test('a run of daily blocks becomes one event spanning the run', () => {
    const days = ['2026-08-01', '2026-08-02', '2026-08-03'].map((d) =>
      parseJsonLdEvent(ld({ startDate: d, endDate: d, url: 'https://x/sapori' }), site)[0],
    );
    const [one] = collapseRuns(days.filter((e) => e !== undefined));
    assert.equal(one?.startDate, '2026-08-01');
    assert.equal(one?.endDate, '2026-08-03');
    assert.equal(collapseRuns(days.filter((e) => e !== undefined)).length, 1);
  });

  test('different events are not collapsed into each other', () => {
    const a = parseJsonLdEvent(ld({ url: 'https://x/a' }), site);
    const b = parseJsonLdEvent(ld({ url: 'https://x/b', name: 'Other' }), site);
    assert.equal(collapseRuns([...a, ...b]).length, 2);
  });
});

describe('parseJsonLdHtml', () => {
  test('reads every ld+json block on the page', () => {
    const html = [ld(), ld({ url: 'https://x/b', name: 'Second' })]
      .map((e) => `<script type="application/ld+json">${JSON.stringify(e)}</script>`)
      .join('\n');
    assert.equal(parseJsonLdHtml(html, site).length, 2);
  });
  test('a page with no data is not an error, just empty', () => {
    assert.deepEqual(parseJsonLdHtml('<html><body>nothing</body></html>', site), []);
  });
});
