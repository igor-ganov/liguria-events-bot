// Every link we send has to say which of our surfaces sent it, or the surface
// reads as "direct" — which is 90 of dovego's 113 weekly visits, and the
// reason the push gate could not be read at all.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { withUtm } from '../src/links/with-utm.ts';

const CHANNEL = { source: 'telegram', medium: 'social', campaign: '2026-10-channel' } as const;
const PUSH = { source: 'push', medium: 'notification', campaign: '2026-10-morning' } as const;

describe('withUtm', () => {
  test('tags a link with the source, the medium and the campaign', () => {
    const tagged = new URL(withUtm('https://dovego.it/it/liguria/genova/', PUSH));
    assert.equal(tagged.origin + tagged.pathname, 'https://dovego.it/it/liguria/genova/');
    assert.equal(tagged.searchParams.get('utm_source'), 'push');
    assert.equal(tagged.searchParams.get('utm_medium'), 'notification');
    assert.equal(tagged.searchParams.get('utm_campaign'), '2026-10-morning');
  });

  test('keeps a query the link already had', () => {
    const tagged = new URL(withUtm('https://dovego.it/it/?city=genova', CHANNEL));
    assert.equal(tagged.searchParams.get('city'), 'genova');
    assert.equal(tagged.searchParams.get('utm_source'), 'telegram');
  });

  test('never tags twice: the first surface to send a reader is the one that earned them', () => {
    const once = withUtm('https://dovego.it/it/', CHANNEL);
    assert.equal(withUtm(once, PUSH), once);
  });

  test('a link that is not a url comes back untouched rather than throwing', () => {
    // A send must not fail because a stored record holds nonsense.
    assert.equal(withUtm('not a url', CHANNEL), 'not a url');
  });
});
