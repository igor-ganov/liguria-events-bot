// Where the bot's cards point.
//
// Until now: at the source. A reader who asked the bot what was on got a list
// of links to comune and theatre websites, so the bot sent its readers away
// from the site it exists to fill — one visit a week from Telegram, which was
// not a measurement problem but the design.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { siteLink } from '../src/links/site-link.ts';
import type { CompactEvent } from '../src/domain/event.ts';

const event = {
  id: 'aaaabbbbcccc',
  t: 'Concerto di Ferragosto',
  s: '2026-08-25',
  v: 'Teatro Carlo Felice',
  c: ['music'],
  u: 'https://teatrocarlofelice.it/concerto',
  ct: 'genova',
} as unknown as CompactEvent;

describe('siteLink', () => {
  test('is our page for that event, in the reader is own language', () => {
    const url = new URL(siteLink(event, 'it', '2026-08-25'));
    assert.equal(url.hostname, 'dovego.it');
    assert.match(url.pathname, /^\/it\/event\/concerto-di-ferragosto-teatro-carlo-felice-2026-08-25-aaaabbbbcccc\/$/);
  });

  test('English lives at the root, as the site builds it', () => {
    assert.match(siteLink(event, 'en', '2026-08-25'), /dovego\.it\/event\//);
  });

  test('and it says the bot sent it, which the channel tag could not', () => {
    const url = new URL(siteLink(event, 'ru', '2026-08-25'));
    assert.equal(url.searchParams.get('utm_source'), 'telegram');
    assert.equal(url.searchParams.get('utm_medium'), 'social');
    assert.equal(url.searchParams.get('utm_campaign'), '2026-08-bot');
  });
});
