// One channel per region, instead of one channel for the whole country.
//
// A reader in Palermo who gets a post three-quarters of which is Liguria
// unsubscribes, and is right to. The registry is what makes the broadcast
// plural; the per-channel memory is what keeps two channels from eating each
// other's events.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { channelEntry } from '../src/channel/channel-entry.ts';
import { channelsOf, WHOLE_COUNTRY } from '../src/channel/channels.ts';
import { digestHeading } from '../src/channel/digest-heading.ts';
import { inRegion } from '../src/channel/in-region.ts';
import { postDaily } from '../src/channel/post-daily.ts';
import { postNow } from '../src/channel/post-now.ts';
import { postedKey } from '../src/channel/posted-key.ts';
import { renderDigest } from '../src/channel/render-digest.ts';
import { asArray, readProp } from '../src/util/json.ts';
import { toCompact } from '../src/domain/event.ts';
import type { CompactEvent, EventRecord } from '../src/domain/event.ts';
import type { Env } from '../src/config.ts';
import type { KvLike } from '../src/pipeline/store.ts';
import type { FetchFn } from '../src/util/http.ts';

const TODAY = '2026-08-25';
const DEFAULTS = { lang: 'it', hour: 10 } as const;

// Fixture data, not prose: the corpus is trilingual, so a record that stands
// in for one has to be.
const base: EventRecord = {
  id: 'aaaabbbbcccc',
  title: 'Concerto di Ferragosto',
  startDate: TODAY,
  categories: ['music'],
  descriptions: { en: 'A concert.', it: 'Un concerto.', ru: 'Концерт.' },
  url: 'https://example.org/concerto',
  source: 'mentelocale',
  city: 'genova',
  enriched: true,
  addedAt: 1,
};

const event = (over: Partial<EventRecord> = {}): CompactEvent => toCompact({ ...base, ...over });

const many = (count: number, over: Partial<EventRecord> = {}): readonly CompactEvent[] =>
  Array.from({ length: count }, (_, i) => event({ id: `id${i}${over.city ?? ''}`, ...over }));

const kv = (seed: Readonly<Record<string, string>> = {}) => {
  const store = new Map(Object.entries(seed));
  const binding: KvLike = {
    // `null` because Cloudflare's KV returns it for a missing key, and the
    // double has to satisfy the same contract as the real binding.
    get: async (key) => store.get(key) ?? null,
    put: async (key, value) => {
      store.set(key, value);
    },
    delete: async (key) => {
      store.delete(key);
    },
    list: async () => ({ keys: [], list_complete: true }),
  };
  return { store, binding };
};

const env = (over: Partial<Env>): Env => ({
  EVENTS: kv().binding,
  AI: { run: async () => ({}) },
  BOT_TOKEN: 't',
  WEBHOOK_SECRET: '',
  OWNER_CHAT_ID: '',
  ...over,
});

/** What Telegram was asked to send, in order — the only way to tell "posted to
 *  both channels" from "posted twice to one". */
type Sent = { readonly calls: unknown[] };

const sent = (): Sent => ({ calls: [] });

const accepting = (seen: Sent): FetchFn => async (_input, init) => {
  seen.calls.push(JSON.parse(String(init?.body ?? '{}')));
  return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), { status: 200 });
};

const kinds = (result: unknown): readonly string[] =>
  (asArray(readProp(result, 'channels')) ?? []).map((one) => String(readProp(one, 'kind')));

describe('channelEntry', () => {
  test('a bare chat string takes the registry defaults', () => {
    assert.deepEqual(channelEntry('toscana', '@dovego_toscana', DEFAULTS), {
      region: 'toscana',
      chat: '@dovego_toscana',
      lang: 'it',
      hour: 10,
    });
  });

  test('an object may set its own hour and language', () => {
    const entry = channelEntry('lazio', { chat: '@dovego_lazio', lang: 'en', hour: 18 }, DEFAULTS);
    assert.deepEqual(entry, { region: 'lazio', chat: '@dovego_lazio', lang: 'en', hour: 18 });
  });

  test('the whole country is a valid key, because that channel is not a region', () => {
    assert.equal(readProp(channelEntry(WHOLE_COUNTRY, '@dovegoit', DEFAULTS), 'region'), WHOLE_COUNTRY);
  });

  test('a region nobody has heard of is a problem, not a silent skip', () => {
    // A typo in a secret that quietly posts nothing is the worst outcome: the
    // channel looks configured and stays empty.
    assert.equal(typeof channelEntry('tuscany', '@x', DEFAULTS), 'string');
  });

  test('an entry with no chat is a problem too', () => {
    assert.equal(typeof channelEntry('toscana', { lang: 'it' }, DEFAULTS), 'string');
  });

  test('an hour outside the day falls back rather than never coming due', () => {
    assert.equal(readProp(channelEntry('toscana', { chat: '@x', hour: 99 }, DEFAULTS), 'hour'), 10);
  });
});

describe('channelsOf', () => {
  test('reads the registry, keeping the good and naming the bad', () => {
    const registry = channelsOf(
      env({ CHANNEL_CHATS: '{"toscana":"@dovego_toscana","atlantis":"@nowhere"}' }),
    );
    assert.deepEqual(registry.channels.map((one) => one.region), ['toscana']);
    assert.equal(registry.problems.length, 1);
  });

  test('the old single-channel setting still works, as the whole country', () => {
    // CHANNEL_CHAT_ID is what is deployed today, and a rollout that needs a
    // secret changed in the same breath is a rollout with a dark minute.
    const registry = channelsOf(env({ CHANNEL_CHAT_ID: '@dovegoit' }));
    assert.deepEqual(registry.channels, [
      { region: WHOLE_COUNTRY, chat: '@dovegoit', lang: 'it', hour: 10 },
    ]);
  });

  test('no channels configured at all is not an error', () => {
    assert.deepEqual(channelsOf(env({})), { channels: [], problems: [] });
  });

  test('each channel may keep its own hour', () => {
    const registry = channelsOf(
      env({ CHANNEL_CHATS: '{"toscana":{"chat":"@t","hour":9},"lazio":"@l"}', CHANNEL_HOUR: '11' }),
    );
    assert.deepEqual(registry.channels.map((one) => one.hour), [9, 11]);
  });
});

describe('inRegion', () => {
  const index = [...many(2, { city: 'genova' }), ...many(2, { city: 'firenze' })];

  test('a regional channel sees only its own region', () => {
    assert.deepEqual(inRegion(index, 'toscana').map((one) => one.ct), ['firenze', 'firenze']);
  });

  test('the whole-country channel keeps everything', () => {
    assert.equal(inRegion(index, WHOLE_COUNTRY).length, 4);
  });
});

describe('postedKey', () => {
  test('a key per channel, so one region cannot strike events off for another', () => {
    assert.equal(postedKey('toscana'), 'channel:posted:toscana');
    assert.notEqual(postedKey('toscana'), postedKey('liguria'));
  });
});

describe('digestHeading with a region', () => {
  test('names the region without reaching for a preposition', () => {
    // "in Toscana" but "nel Lazio" and "nelle Marche": an Italian channel that
    // gets that wrong every morning reads as machine-made. A separator does
    // not decline.
    assert.equal(digestHeading(TODAY, 'it', 'Toscana'), 'Toscana · Cosa fare oggi — 25 agosto');
    assert.equal(digestHeading(TODAY, 'it'), 'Cosa fare oggi — 25 agosto');
  });
});

describe('postDaily across channels', () => {
  const index = [...many(3, { city: 'genova' }), ...many(3, { city: 'firenze' })];

  test('posts each channel its own region, and nobody else’s', async () => {
    const { binding } = kv();
    const seen = sent();
    const result = await postDaily(
      env({ EVENTS: binding, CHANNEL_CHATS: '{"liguria":"@lig","toscana":"@tos"}' }),
      index,
      TODAY,
      10,
      accepting(seen),
    );
    assert.equal(seen.calls.length, 2);
    const texts = seen.calls.map((call) => String(readProp(call, 'text')));
    assert.ok(texts.some((text) => text.includes('Liguria') && !text.includes('Firenze')));
    assert.ok(texts.some((text) => text.includes('Toscana') && !text.includes('Genova')));
    assert.deepEqual(readProp(result, 'problems'), []);
  });

  test('two channels may carry the same event without stealing it from each other', async () => {
    // The whole-country channel and a regional one overlap by design. With a
    // single memory key the first post struck the events off and the second
    // channel went out empty.
    const { binding, store } = kv();
    const seen = sent();
    await postDaily(
      env({ EVENTS: binding, CHANNEL_CHATS: `{"${WHOLE_COUNTRY}":"@it","toscana":"@tos"}` }),
      index,
      TODAY,
      10,
      accepting(seen),
    );
    assert.equal(seen.calls.length, 2);
    assert.ok(JSON.parse(store.get(postedKey('toscana')) ?? '[]').length > 0);
    assert.ok(JSON.parse(store.get(postedKey(WHOLE_COUNTRY)) ?? '[]').length > 0);
  });

  test('what the single channel already said is not said again', async () => {
    // The old key held the whole country's history. Dropping it would repeat
    // a week of posts into the channel on the day of the rollout.
    const { binding } = kv({ 'channel:posted': JSON.stringify(index.map((one) => one.id)) });
    const seen = sent();
    const result = await postDaily(
      env({ EVENTS: binding, CHANNEL_CHAT_ID: '@dovegoit' }),
      index,
      TODAY,
      10,
      accepting(seen),
    );
    assert.equal(seen.calls.length, 0);
    assert.deepEqual(kinds(result), ['nothing-to-say']);
  });

  test('a channel that refuses does not take the others down with it', async () => {
    const { binding } = kv();
    const refusingFirst: FetchFn = async (_input, init) => {
      const chat = String(readProp(JSON.parse(String(init?.body ?? '{}')), 'chat_id'));
      return chat === '@lig'
        ? new Response(JSON.stringify({ ok: false, description: 'chat not found' }), { status: 400 })
        : new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), { status: 200 });
    };
    const result = await postDaily(
      env({ EVENTS: binding, CHANNEL_CHATS: '{"liguria":"@lig","toscana":"@tos"}' }),
      index,
      TODAY,
      10,
      refusingFirst,
    );
    assert.deepEqual([...kinds(result)].sort(), ['failed', 'posted']);
  });

  test('a channel whose hour has not come stays quiet', async () => {
    const { binding } = kv();
    const seen = sent();
    await postDaily(
      env({ EVENTS: binding, CHANNEL_CHATS: '{"toscana":{"chat":"@tos","hour":18}}' }),
      index,
      TODAY,
      10,
      accepting(seen),
    );
    assert.equal(seen.calls.length, 0);
  });
});

describe('postNow', () => {
  const index = [...many(3, { city: 'genova' }), ...many(3, { city: 'firenze' })];
  const configured = '{"liguria":"@lig","toscana":{"chat":"@tos","hour":18}}';

  test('reaches one named channel whatever the hour', async () => {
    const { binding } = kv();
    const seen = sent();
    await postNow(env({ EVENTS: binding, CHANNEL_CHATS: configured }), index, TODAY, 'toscana', accepting(seen));
    assert.equal(seen.calls.length, 1);
    assert.equal(readProp(seen.calls[0], 'chat_id'), '@tos');
  });

  test('with no region named, it reaches all of them', async () => {
    const { binding } = kv();
    const seen = sent();
    await postNow(env({ EVENTS: binding, CHANNEL_CHATS: configured }), index, TODAY, '', accepting(seen));
    assert.equal(seen.calls.length, 2);
  });

  test('a region with no channel says so rather than pretending', async () => {
    const { binding } = kv();
    const result = await postNow(env({ EVENTS: binding, CHANNEL_CHATS: configured }), index, TODAY, 'lazio');
    assert.deepEqual(readProp(result, 'channels'), []);
    assert.ok(String(readProp(result, 'problems')).includes('lazio'));
  });
});

describe('renderDigest for a region', () => {
  test('heads the post with the region it speaks for', () => {
    const digest = renderDigest(many(2, { city: 'firenze' }), 'it', TODAY, 'Toscana');
    assert.ok(digest.startsWith('📅 <b>Toscana · Cosa fare oggi — 25 agosto</b>'), digest);
  });
});
