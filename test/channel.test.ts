// The public channel. It posts a digest once a day, or nothing: five private
// subscribers is not an audience, and a channel that posts filler is a channel
// people mute.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { applyIdentity } from '../src/channel/apply-identity.ts';
import { deletePost } from '../src/channel/delete-post.ts';
import { digestHeading } from '../src/channel/digest-heading.ts';
import { eventUrl } from '../src/channel/event-url.ts';
import { onDay } from '../src/channel/on-day.ts';
import { pickDigest } from '../src/channel/pick-digest.ts';
import { postDaily } from '../src/channel/post-daily.ts';
import { rememberPosted } from '../src/channel/remember-posted.ts';
import { renderDigest } from '../src/channel/render-digest.ts';
import { readProp } from '../src/util/json.ts';
import { toCompact } from '../src/domain/event.ts';
import type { CompactEvent, EventRecord } from '../src/domain/event.ts';
import type { Env } from '../src/config.ts';
import type { KvLike } from '../src/pipeline/store.ts';
import type { FetchFn } from '../src/util/http.ts';

const TODAY = '2026-08-25';

// Fixture data, not prose: the corpus is trilingual, so a record that stands
// in for one has to be.
const base: EventRecord = {
  id: 'aaaabbbbcccc',
  title: 'Concerto di Ferragosto',
  startDate: TODAY,
  categories: ['music'],
  descriptions: { en: 'A concert by the sea.', it: 'Un concerto sul mare.', ru: 'Концерт у моря.' },
  url: 'https://example.org/concerto',
  source: 'mentelocale',
  city: 'genova',
  enriched: true,
  addedAt: 1,
};

const event = (over: Partial<EventRecord> = {}): CompactEvent => toCompact({ ...base, ...over });

const many = (count: number, over: Partial<EventRecord> = {}): readonly CompactEvent[] =>
  Array.from({ length: count }, (_, i) => event({ id: `id${i}${over.city ?? ''}`, ...over }));

describe('onDay', () => {
  test('a standalone event covers every day of its run', () => {
    const run = event({ startDate: '2026-08-01', endDate: '2026-09-30' });
    assert.equal(onDay(run, TODAY), true);
  });

  test('a container is on only on its programmed dates', () => {
    // Otherwise a three-month festival lands in every digest of its run.
    const festival = event({
      kind: 'container',
      startDate: '2026-08-01',
      endDate: '2026-09-30',
      sessions: [{ date: '2026-08-01' }, { date: '2026-09-30' }],
    });
    assert.equal(onDay(festival, TODAY), false);
    assert.equal(onDay(festival, '2026-09-30'), true);
  });

  test('a single-date event is on that date and no other', () => {
    assert.equal(onDay(event(), TODAY), true);
    assert.equal(onDay(event(), '2026-08-26'), false);
  });
});

describe('pickDigest', () => {
  test('takes what is on today', () => {
    const picked = pickDigest([event({ id: 'today' }), event({ id: 'later', startDate: '2026-09-09' })], TODAY, []);
    assert.deepEqual(picked.map((one) => one.id), ['today']);
  });

  test('caps each city, so one big city cannot fill the post', () => {
    const picked = pickDigest([...many(6, { city: 'milano' }), ...many(2, { city: 'genova' })], TODAY, []);
    assert.equal(picked.filter((one) => one.ct === 'milano').length, 3);
    assert.equal(picked.filter((one) => one.ct === 'genova').length, 2);
  });

  test('opens with the city that has the most on', () => {
    const picked = pickDigest([...many(1, { city: 'genova' }), ...many(3, { city: 'milano' })], TODAY, []);
    assert.equal(picked[0]?.ct, 'milano');
  });

  test('caps the whole digest as well', () => {
    const cities = ['genova', 'milano', 'torino', 'roma', 'napoli', 'bari'];
    const picked = pickDigest(cities.flatMap((city) => many(3, { city })), TODAY, []);
    assert.equal(picked.length, 12);
  });

  test('never repeats what has already gone out', () => {
    // A months-long exhibition is on every day of its run; saying so daily is
    // what gets a channel muted.
    const picked = pickDigest(many(3, { city: 'genova' }), TODAY, ['id0genova']);
    assert.equal(picked.length, 2);
  });

  test('skips an event enrichment never described, and one with no city', () => {
    const bare = event({ id: 'bare', descriptions: { en: '', it: '', ru: '' } });
    // A record with no city at all: the key is absent, not undefined.
    const { city: _city, ...noCity } = base;
    const nowhere = toCompact({ ...noCity, id: 'nowhere' });
    assert.deepEqual(pickDigest([bare, nowhere], TODAY, []), []);
  });

  test('orders a city by time of day, then by title', () => {
    const evening = event({ id: 'evening', time: '21:00' });
    const morning = event({ id: 'morning', time: '09:00' });
    assert.deepEqual(pickDigest([evening, morning], TODAY, []).map((one) => one.id), ['morning', 'evening']);
  });
});

describe('digestHeading', () => {
  test('names the day in the channel’s own language', () => {
    assert.equal(digestHeading(TODAY, 'it'), 'Cosa fare oggi — 25 agosto');
    assert.equal(digestHeading(TODAY, 'en'), "What's on today — 25 August");
  });

  test('a date it cannot read still yields a heading', () => {
    assert.equal(digestHeading('not-a-date', 'it'), 'Cosa fare oggi');
  });
});

describe('renderDigest', () => {
  const digest = renderDigest(
    [event({ id: 'aaaabbbbcccc', time: '21:00', venue: 'Teatro Carlo Felice' }), event({ id: 'b', city: 'milano' })],
    'it',
    TODAY,
  );

  test('heads the post with the day', () => {
    assert.ok(digest.startsWith('📅 <b>Cosa fare oggi — 25 agosto</b>'));
  });

  test('groups by city, under the city’s real name', () => {
    assert.ok(digest.includes('<b>Genova</b>'));
    assert.ok(digest.includes('<b>Milano</b>'));
  });

  test('every event is a link to its own page', () => {
    assert.ok(digest.includes('<a href="https://dovego.it/it/event/aaaabbbbcccc/">'));
  });

  test('says when and where, when the corpus knows', () => {
    assert.ok(digest.includes('21:00 · Teatro Carlo Felice'));
  });

  test('closes with the way through to everything else', () => {
    assert.ok(digest.includes('<a href="https://dovego.it/it/">Tutti gli eventi di oggi</a>'));
  });

  test('escapes a scraped title rather than sending broken HTML', () => {
    const broken = renderDigest([event({ title: 'Rock & <Roll>' })], 'it', TODAY);
    assert.ok(broken.includes('Rock &amp; &lt;Roll&gt;'));
  });

  test('fits in one message', () => {
    const cities = ['genova', 'milano', 'torino', 'roma'];
    const full = renderDigest(cities.flatMap((city) => many(3, { city })), 'it', TODAY);
    assert.ok(full.length <= 4096, `digest was ${full.length}`);
  });
});

describe('eventUrl', () => {
  test('English at the root, the others under a prefix', () => {
    assert.equal(eventUrl('abc', 'en'), 'https://dovego.it/event/abc/');
    assert.equal(eventUrl('abc', 'it'), 'https://dovego.it/it/event/abc/');
  });
});

describe('rememberPosted', () => {
  test('keeps the newest ids and forgets the oldest, so the key cannot grow forever', () => {
    assert.deepEqual(rememberPosted(['a', 'b', 'c'], 'd', 3), ['b', 'c', 'd']);
  });

  test('does not record the same id twice', () => {
    assert.deepEqual(rememberPosted(['a', 'b'], 'b', 5), ['a', 'b']);
  });
});

describe('postDaily', () => {
  // Two cities: four events survive the per-city cap of three.
  const index = [...many(3, { city: 'genova' }), ...many(1, { city: 'milano' })];

  // Typed as the real bindings rather than cast into them, so a signature
  // change breaks the double instead of being papered over.
  const kv = (seed: Readonly<Record<string, string>>) => {
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

  const env = (channel: string, binding: KvLike): Env => ({
    EVENTS: binding,
    AI: { run: async () => ({}) },
    BOT_TOKEN: 't',
    WEBHOOK_SECRET: '',
    OWNER_CHAT_ID: '',
    CHANNEL_CHAT_ID: channel,
  });

  const accepting = (seen: { body?: unknown }): FetchFn => async (_input, init) => {
    seen.body = JSON.parse(String(init?.body ?? '{}'));
    return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), { status: 200 });
  };

  test('says nothing at all when no channel is configured', async () => {
    const { binding } = kv({});
    assert.deepEqual(await postDaily(env('', binding), index, TODAY, 10), { kind: 'not-due' });
  });

  test('posts at the hour it was told, and not at another one', async () => {
    const { binding } = kv({});
    assert.deepEqual(await postDaily(env('@dovegoit', binding), index, TODAY, 9), { kind: 'not-due' });
  });

  test('a day with too little on gets no post', async () => {
    const { binding } = kv({});
    const result = await postDaily(env('@dovegoit', binding), many(1, { city: 'genova' }), TODAY, 10);
    assert.deepEqual(result, { kind: 'nothing-to-say', found: 1 });
  });

  test('sends the digest and remembers every event in it', async () => {
    const { binding, store } = kv({});
    const seen: { body?: unknown } = {};
    const result = await postDaily(env('@dovegoit', binding), index, TODAY, 10, accepting(seen));
    assert.deepEqual(result, { kind: 'posted', events: 4, messageId: 7 });
    assert.equal(readProp(seen.body, 'chat_id'), '@dovegoit');
    assert.equal(JSON.parse(store.get('channel:posted') ?? '[]').length, 4);
  });

  test('asks Telegram to preview the first event, large and above the text', async () => {
    // That is where the post gets its picture: the page's own og:image, which
    // is already our crop on our own origin.
    const { binding } = kv({});
    const seen: { body?: unknown } = {};
    await postDaily(env('@dovegoit', binding), index, TODAY, 10, accepting(seen));
    const preview = readProp(seen.body, 'link_preview_options');
    assert.equal(readProp(preview, 'url'), 'https://dovego.it/it/event/id0genova/');
    assert.equal(readProp(preview, 'prefer_large_media'), true);
    assert.equal(readProp(preview, 'show_above_text'), true);
  });

  test('a refused send is reported and nothing is struck off', async () => {
    // The first live post reported success while the channel stayed empty: the
    // send had failed and the events were recorded as said, so they never
    // came back.
    const { binding, store } = kv({});
    const refusing: FetchFn = async () =>
      new Response(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }), { status: 400 });
    const result = await postDaily(env('@dovegoit', binding), index, TODAY, 10, refusing);
    assert.equal(readProp(result, 'kind'), 'failed');
    assert.ok(String(readProp(result, 'error')).includes('chat not found'));
    assert.equal(store.get('channel:posted'), undefined);
  });
});

describe('deletePost', () => {
  const answering = (body: unknown, status = 200): FetchFn => async () =>
    new Response(JSON.stringify(body), { status });

  test('reports success when Telegram accepted it', async () => {
    assert.deepEqual(await deletePost('t', '@dovegoit', 3, answering({ ok: true, result: true })), { ok: true });
  });

  test('reports why it could not, rather than pretending', async () => {
    const result = await deletePost(
      't',
      '@dovegoit',
      3,
      answering({ ok: false, description: 'Bad Request: message to delete not found' }, 400),
    );
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes('not found'));
  });

  test('a transport failure is an answer too', async () => {
    const throwing: FetchFn = async () => {
      throw new Error('network down');
    };
    assert.equal((await deletePost('t', '@dovegoit', 3, throwing)).ok, false);
  });
});

describe('applyIdentity', () => {
  const env = (channel: string): Env => ({
    EVENTS: {
      get: async () => null,
      put: async () => undefined,
      delete: async () => undefined,
      list: async () => ({ keys: [], list_complete: true }),
    },
    AI: { run: async () => ({}) },
    BOT_TOKEN: 't',
    WEBHOOK_SECRET: '',
    OWNER_CHAT_ID: '',
    CHANNEL_CHAT_ID: channel,
  });

  const recording = (calls: string[]): FetchFn => async (input) => {
    calls.push(String(input).split('/bott/')[1] ?? String(input));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  test('sets the profile copy in every language the bot speaks', async () => {
    const calls: string[] = [];
    await applyIdentity(env('@dovegoit'), recording(calls));
    assert.equal(calls.filter((one) => one === 'setMyShortDescription').length, 3);
    assert.equal(calls.filter((one) => one === 'setMyDescription').length, 3);
    assert.equal(calls.filter((one) => one === 'setMyName').length, 1);
  });

  test('describes the channel and gives it a picture', async () => {
    const calls: string[] = [];
    await applyIdentity(env('@dovegoit'), recording(calls));
    assert.ok(calls.includes('setChatDescription'));
    assert.ok(calls.includes('setChatPhoto'));
  });

  test('with no channel configured it still sets up the bot, and says why not the channel', async () => {
    const result = await applyIdentity(env(''), recording([]));
    const steps = readProp(result, 'steps');
    const channel = (Array.isArray(steps) ? steps : []).filter((s) => readProp(s, 'step') === 'channel');
    assert.equal(channel.length, 1);
    assert.equal(readProp(channel[0], 'error'), 'no channel configured');
  });

  test('a refused step is reported, not swallowed', async () => {
    const refusing: FetchFn = async () =>
      new Response(JSON.stringify({ ok: false, description: 'Bad Request: NAME_NOT_MODIFIED' }), { status: 400 });
    const result = await applyIdentity(env('@dovegoit'), refusing);
    const steps = Array.isArray(readProp(result, 'steps')) ? readProp(result, 'steps') : [];
    assert.ok((steps as readonly unknown[]).some((s) => readProp(s, 'ok') === false));
  });
});

describe('renderDigest and the venue that is not one', () => {
  test('drops a venue that is just the city name again', () => {
    // The crawler fills the venue with the city's own name often enough to
    // matter — 55 events in one live snapshot said venue "Milano" in Milano.
    const digest = renderDigest([event({ city: 'milano', venue: 'Milano', time: '11:00' })], 'it', TODAY);
    assert.ok(digest.includes('— 11:00'));
    assert.ok(!digest.includes('11:00 · Milano'));
  });

  test('keeps a real venue in the same city', () => {
    const digest = renderDigest([event({ city: 'milano', venue: 'Gallerie d’Italia' })], 'it', TODAY);
    assert.ok(digest.includes('Gallerie d’Italia'));
  });

  test('an event with neither a time nor a venue is still a line', () => {
    // The key is absent, not undefined: exactOptionalPropertyTypes.
    const { venue: _venue, ...noVenue } = base;
    const digest = renderDigest([toCompact(noVenue)], 'it', TODAY);
    assert.ok(digest.includes('Concerto di Ferragosto'));
  });
});
