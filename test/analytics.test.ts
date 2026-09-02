// Reporting to pro-motion: what goes on the wire, and what happens when it fails.
import { afterEach, describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import type { Env } from '../src/config.ts';
import { track } from '../src/analytics/track.ts';
import { wire } from '../src/analytics/wire.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const envWith = (extra: Partial<Env>): Env =>
  ({ EVENTS: {}, AI: {}, BOT_TOKEN: '', WEBHOOK_SECRET: '', OWNER_CHAT_ID: '', ...extra }) as unknown as Env;

const capture = (): { calls: { url: string; init: RequestInit }[] } => {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(undefined, { status: 204 });
  }) as unknown as typeof fetch;
  return { calls };
};

describe('wire', () => {
  test('names the project, the actor and the channel', () => {
    const body = wire({ event: 'command', actor: '42', props: { command: '/today' } });
    assert.equal(body['p'], 'liguria-bot');
    assert.equal(body['a'], '42');
    assert.deepEqual(body['x'], { command: '/today', channel: 'telegram' });
  });
  test('an anonymous event carries no actor rather than a placeholder', () => {
    assert.equal(wire({ event: 'tick' })['a'], '');
  });
  test('metrics ride in their own field', () => {
    assert.deepEqual(wire({ event: 'tick', metrics: { users: 5 } })['m'], { users: 5 });
  });
});

describe('track', () => {
  test('says nothing when the worker has no endpoint configured', async () => {
    const seen = capture();
    await track(envWith({}), { event: 'start' });
    assert.equal(seen.calls.length, 0);
  });
  test('says nothing when the token is missing', async () => {
    const seen = capture();
    await track(envWith({ PM_ENDPOINT: 'https://collector/e' }), { event: 'start' });
    assert.equal(seen.calls.length, 0);
  });
  test('posts the event with the project token in a header', async () => {
    const seen = capture();
    await track(envWith({ PM_ENDPOINT: 'https://collector/e', PM_TOKEN: 'tok' }), {
      event: 'start',
      actor: '7',
    });
    assert.equal(seen.calls.length, 1);
    assert.equal(seen.calls[0]?.url, 'https://collector/e');
    const headers: Record<string, string> = Object(seen.calls[0]?.init.headers);
    assert.equal(headers['x-pm-token'], 'tok');
    assert.equal(JSON.parse(String(seen.calls[0]?.init.body))['e'], 'start');
  });
  test('a collector that is down cannot break the bot', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await track(envWith({ PM_ENDPOINT: 'https://collector/e', PM_TOKEN: 'tok' }), { event: 'start' });
  });
});
