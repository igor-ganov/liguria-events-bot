// A push click carries no referrer — the service worker opens the URL — so
// every reader woken by the morning digest arrived as "direct". The gate for
// this channel is "returning share and push opt-ins", and it could not be read.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { taggedNotice } from '../src/push/tagged-notice.ts';

const notice = {
  title: 'Oggi · Genova: 4',
  body: 'Sagra del Fuoco · Teatro · Mostra',
  url: 'https://dovego.it/it/liguria/genova/',
};

describe('taggedNotice', () => {
  test('says the notification sent it, and in which month', () => {
    const url = new URL(taggedNotice(notice, '2026-10-05')?.url ?? '');
    assert.equal(url.searchParams.get('utm_source'), 'push');
    assert.equal(url.searchParams.get('utm_medium'), 'notification');
    assert.equal(url.searchParams.get('utm_campaign'), '2026-10-morning');
    assert.equal(url.pathname, '/it/liguria/genova/');
  });

  test('the words are untouched: only the link learns anything', () => {
    const tagged = taggedNotice(notice, '2026-10-05');
    assert.equal(tagged?.title, notice.title);
    assert.equal(tagged?.body, notice.body);
  });

  test('nothing on is still nothing sent', () => {
    assert.equal(taggedNotice(undefined, '2026-10-05'), undefined);
  });
});
