// The rule that turns an event into a URL lives in two repositories: here,
// because everything this worker publishes is a link, and in the site, which
// has to answer it. Drift between them is silent — the site still resolves the
// link, by redirect — and it would spend every announcement we make on an
// address that immediately moves. This check is the only thing that notices.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { canonicalAddressCheck } from '../src/health/canonical-address-check.ts';
import { eventSlug } from '../src/domain/event-slug.ts';
import type { CompactEvent } from '../src/domain/event.ts';
import type { FetchFn } from '../src/collectors/types.ts';

const event: CompactEvent = {
  id: 'aaaabbbbcccc',
  t: 'Concerto in cortile',
  s: '2026-12-05',
  v: 'Palazzo Spinola',
  c: ['music'],
  u: 'https://example.org/concerto',
};

const answering = (status: number): FetchFn => async () => new Response('', { status });

describe('eventSlug', () => {
  test('spells an address out of the event, id last', () => {
    assert.equal(eventSlug(event), 'concerto-in-cortile-palazzo-spinola-2026-12-05-aaaabbbbcccc');
  });

  test('an event with no venue leaves that part out', () => {
    const { v: _venue, ...homeless } = event;
    assert.equal(eventSlug(homeless), 'concerto-in-cortile-2026-12-05-aaaabbbbcccc');
  });
});

describe('canonicalAddressCheck', () => {
  test('a plain 200 at the address we would publish is the passing case', async () => {
    const result = await canonicalAddressCheck(answering(200), 'https://dovego.it', event);
    assert.equal(result.status, 'ok');
    assert.ok(result.detail.includes('concerto-in-cortile-palazzo-spinola-2026-12-05-aaaabbbbcccc'));
  });

  test('a redirect is drift, and drift fails', async () => {
    // The site spells the address differently now: every link we post, every
    // URL we hand IndexNow, would be a 301.
    const result = await canonicalAddressCheck(answering(301), 'https://dovego.it', event);
    assert.equal(result.status, 'fail');
    assert.ok(result.detail.includes('301'));
  });

  test('with nothing in the index there is nothing to check, and that is a warning', async () => {
    const result = await canonicalAddressCheck(answering(200), 'https://dovego.it', undefined);
    assert.equal(result.status, 'warn');
  });
});
