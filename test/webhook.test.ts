// T17 — webhook gate + update routing (AC-8.1, AC-1.7, US-3 wiring).
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import worker, { handleUpdate } from '../src/index.ts';
import type { Env } from '../src/config.ts';
import { makeKvStub } from './kv-stub.ts';
import { parseJson, readProp } from '../src/util/json.ts';

const makeEnv = (): Env => ({
  EVENTS: makeKvStub(),
  AI: { run: async () => ({ response: 'llm reply' }) },
  BOT_TOKEN: 'TOKEN',
  WEBHOOK_SECRET: 'secret',
  OWNER_CHAT_ID: '1',
});

const makeCtx = (): Readonly<{
  ctx: Readonly<{ waitUntil: (promise: Promise<unknown>) => void }>;
  settled: () => Promise<void>;
}> => {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>): void => {
      pending.push(promise);
    },
  };
  return { ctx, settled: async () => void (await Promise.allSettled(pending)) };
};

type SentMessage = Readonly<{ url: string; text: string }>;

/** Patch global fetch to capture Telegram API calls made by handleUpdate. */
const captureTelegram = (): Readonly<{ sent: SentMessage[]; restore: () => void }> => {
  const original = globalThis.fetch;
  const sent: SentMessage[] = [];
  const fake: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : String(input);
    const body = parseJson(typeof init?.body === 'string' ? init.body : '');
    const text = readProp(body, 'text');
    sent.push({ url, text: typeof text === 'string' ? text : '' });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
  };
  globalThis.fetch = fake;
  return {
    sent,
    restore: () => {
      globalThis.fetch = original;
    },
  };
};

describe('webhook gate (AC-8.1)', () => {
  test('non-webhook path → 404, wrong secret → 401, good secret → ok', async () => {
    const env = makeEnv();
    const { ctx } = makeCtx();
    const notFound = await worker.fetch(
      new Request('https://bot.example/other', { method: 'POST' }),
      env,
      ctx,
    );
    assert.equal(notFound.status, 404);

    const unauthorized = await worker.fetch(
      new Request('https://bot.example/webhook', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': 'wrong' },
        body: '{}',
      }),
      env,
      ctx,
    );
    assert.equal(unauthorized.status, 401);

    const accepted = await worker.fetch(
      new Request('https://bot.example/webhook', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': 'secret' },
        body: '{}',
      }),
      env,
      ctx,
    );
    assert.equal(accepted.status, 200);
  });
});

describe('public calendar feed (public-calendar AC-1.1/1.2/1.6, AC-2.x)', () => {
  test('GET /calendar.ics is public, cached, and serves filtered VEVENTs', async () => {
    const env = makeEnv();
    const index = [
      { id: 'aaa', t: 'Concerto', s: '2026-07-04', h: '21:00', c: ['music'], f: true, u: 'https://x/1' },
      { id: 'bbb', t: 'Mostra', s: '2026-07-05', c: ['art'], u: 'https://x/2' },
    ];
    await env.EVENTS.put('events:index', JSON.stringify(index));
    const { ctx } = makeCtx();

    const full = await worker.fetch(
      new Request('https://bot.example/calendar.ics'), // no auth header (AC-1.2)
      env,
      ctx,
    );
    assert.equal(full.status, 200);
    assert.ok(full.headers.get('content-type')?.startsWith('text/calendar'));
    assert.ok(full.headers.get('cache-control')?.includes('max-age=3600'));
    const body = await full.text();
    assert.ok(body.includes('UID:aaa@event-collecter'));
    assert.ok(body.includes('UID:bbb@event-collecter'));

    const filtered = await worker.fetch(
      new Request('https://bot.example/calendar.ics?cat=music'),
      env,
      ctx,
    );
    const filteredBody = await filtered.text();
    assert.ok(filteredBody.includes('UID:aaa@event-collecter'));
    assert.equal(filteredBody.includes('UID:bbb@event-collecter'), false);
  });

  test('GET /events.json serves the filtered corpus with CORS (AC-4.x)', async () => {
    const env = makeEnv();
    const index = [
      { id: 'aaa', t: 'Concerto', s: '2026-07-04', c: ['music'], f: true, u: 'https://x/1' },
      { id: 'bbb', t: 'Mostra', s: '2026-07-05', c: ['art'], u: 'https://x/2' },
    ];
    await env.EVENTS.put('events:index', JSON.stringify(index));
    const { ctx } = makeCtx();
    const response = await worker.fetch(
      new Request('https://bot.example/events.json?free=1'),
      env,
      ctx,
    );
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type')?.startsWith('application/json'));
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    const body = parseJson(await response.text());
    assert.ok(typeof readProp(body, 'generatedAt') === 'string');
    const events = readProp(body, 'events');
    assert.ok(Array.isArray(events) && events.length === 1);
    assert.equal(readProp(events[0], 'id'), 'aaa');
  });
});

describe('POST /tick — external schedule pulse', () => {
  test('rejects a wrong secret, accepts the right one', async () => {
    const env = makeEnv();
    const { ctx, settled } = makeCtx();
    const bad = await worker.fetch(
      new Request('https://bot.example/tick', {
        method: 'POST',
        headers: { 'x-tick-secret': 'wrong' },
      }),
      env,
      ctx,
    );
    assert.equal(bad.status, 401);
    const capture = captureTelegram();
    try {
      const good = await worker.fetch(
        new Request('https://bot.example/tick', {
          method: 'POST',
          headers: { 'x-tick-secret': 'secret' },
        }),
        env,
        ctx,
      );
      assert.equal(good.status, 200);
      await settled();
    } finally {
      capture.restore();
    }
  });
});

describe('update routing', () => {
  test('/start replies with help and remembers the chat', async () => {
    const env = makeEnv();
    const capture = captureTelegram();
    try {
      await handleUpdate(env, {
        message: { chat: { id: 5 }, from: { id: 5, language_code: 'en' }, text: '/start' },
      });
    } finally {
      capture.restore();
    }
    // Two messages on a first run: the help, and the one question every list
    // depends on — see 'the first /start' below.
    const messages = capture.sent.filter((call) => call.url.includes('sendMessage'));
    assert.equal(messages.length, 2);
    assert.ok(messages[0]?.text.includes('/today'));
    assert.equal(await env.EVENTS.get('user:5:chat'), '5');
  });

  test('/calendar replies with the origin-derived subscription link (AC-3.1)', async () => {
    const env = makeEnv();
    const capture = captureTelegram();
    try {
      await handleUpdate(
        env,
        { message: { chat: { id: 5 }, from: { id: 5 }, text: '/calendar' } },
        'https://bot.example',
      );
    } finally {
      capture.restore();
    }
    const messages = capture.sent.filter((call) => call.url.includes('sendMessage'));
    assert.ok(messages[0]?.text.includes('https://bot.example/calendar.ics'));
    assert.ok(messages[0]?.text.includes('?cat=music,art&free=1'));
  });

  test('non-operator /collect is refused (AC-1.7)', async () => {
    const env = makeEnv();
    const capture = captureTelegram();
    try {
      await handleUpdate(env, {
        message: { chat: { id: 99 }, from: { id: 99 }, text: '/collect' },
      });
    } finally {
      capture.restore();
    }
    const messages = capture.sent.filter((call) => call.url.includes('sendMessage'));
    assert.equal(messages.length, 1);
    assert.ok(messages[0]?.text.toLowerCase().includes('operator'));
  });

  test('free text goes to grounded Q&A (AC-4.1) and answers from the LLM', async () => {
    const env = makeEnv();
    const capture = captureTelegram();
    try {
      await handleUpdate(env, {
        message: { chat: { id: 5 }, from: { id: 5 }, text: 'what is on this weekend?' },
      });
    } finally {
      capture.restore();
    }
    const typing = capture.sent.filter((call) => call.url.includes('sendChatAction'));
    assert.equal(typing.length, 1); // AC-4.5
    const messages = capture.sent.filter((call) => call.url.includes('sendMessage'));
    assert.equal(messages[0]?.text, 'llm reply');
  });
});

describe('the place setting (US-7)', () => {
  test('/today answers for the chosen city, not for the country', async () => {
    // Every list the bot produced was Italy-wide: a reader in Genova was told
    // about a market in Bari. The setting is what makes the bot usable to a
    // person who lives somewhere.
    const env = makeEnv();
    await env.EVENTS.put(
      'events:index',
      JSON.stringify([
        // A run wide enough to cover whatever day the suite runs on: this is
        // about place, and a date-dependent fixture would fail every autumn.
        { id: 'g', t: 'Concerto in Genova', s: '2026-01-01', e: '2030-12-31', c: ['music'], u: 'https://x/g', ct: 'genova', rg: 'liguria' },
        { id: 'b', t: 'Mercato a Bari', s: '2026-01-01', e: '2030-12-31', c: ['market'], u: 'https://x/b', ct: 'bari', rg: 'puglia' },
      ]),
    );
    await env.EVENTS.put('user:5:settings', JSON.stringify({ place: 'city:genova' }));

    const capture = captureTelegram();
    try {
      await handleUpdate(env, { message: { chat: { id: 5 }, from: { id: 5 }, text: '/today' } });
    } finally {
      capture.restore();
    }
    const text = capture.sent.filter((call) => call.url.includes('sendMessage')).map((call) => call.text).join('\n');
    assert.ok(text.includes('Genova'), text);
    assert.ok(!text.includes('Bari'), text);
  });

  test('picking a city from the keyboard stores it', async () => {
    const env = makeEnv();
    const capture = captureTelegram();
    try {
      await handleUpdate(env, {
        callback_query: {
          id: 'cb1',
          data: 'set:place:c:torino',
          from: { id: 5 },
          message: { chat: { id: 5 }, message_id: 10 },
        },
      });
    } finally {
      capture.restore();
    }
    assert.equal(readProp(parseJson((await env.EVENTS.get('user:5:settings')) ?? ''), 'place'), 'city:torino');
  });

  test('a region opened is a view, and changes nothing until a choice is made', async () => {
    const env = makeEnv();
    await env.EVENTS.put('user:5:settings', JSON.stringify({ place: 'city:genova' }));
    const capture = captureTelegram();
    try {
      await handleUpdate(env, {
        callback_query: {
          id: 'cb2',
          data: 'set:place:r:liguria',
          from: { id: 5 },
          message: { chat: { id: 5 }, message_id: 10 },
        },
      });
    } finally {
      capture.restore();
    }
    assert.equal(readProp(parseJson((await env.EVENTS.get('user:5:settings')) ?? ''), 'place'), 'city:genova');
    const edits = capture.sent.filter((call) => call.url.includes('editMessageText'));
    assert.ok(edits.at(-1)?.text.includes('Liguria'), edits.at(-1)?.text);
  });
});

describe('the first /start', () => {
  const start = { message: { chat: { id: 5 }, from: { id: 5 }, text: '/start' } };

  test('asks where the reader is, once', async () => {
    const env = makeEnv();
    const first = captureTelegram();
    try {
      await handleUpdate(env, start);
    } finally {
      first.restore();
    }
    const asked = first.sent.filter((call) => call.url.includes('sendMessage'));
    assert.equal(asked.length, 2);
    assert.ok(asked[1]?.text.includes('/settings'), asked[1]?.text);
  });

  test('and never again, even for somebody who answered "everywhere"', async () => {
    // "All of Italy" is a real answer and is stored as an empty place, which
    // is what an unanswered question looks like. Asking again would read as
    // the bot having forgotten them.
    const env = makeEnv();
    await env.EVENTS.put('user:5:settings', JSON.stringify({ place: '' }));
    const again = captureTelegram();
    try {
      await handleUpdate(env, start);
    } finally {
      again.restore();
    }
    assert.equal(again.sent.filter((call) => call.url.includes('sendMessage')).length, 1);
  });
});
