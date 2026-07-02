// T16 — Bot API wrappers with a fake fetch (AC-3.7, AC-4.5).
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { makeBot, sendLong } from '../src/delivery/bot-api.ts';
import { parseJson, readProp } from '../src/util/json.ts';

type Call = Readonly<{ url: string; body: unknown }>;

const makeCapture = (): Readonly<{ calls: Call[]; fetchFn: (input: string, init?: Readonly<{ body?: string }>) => Promise<Response> }> => {
  const calls: Call[] = [];
  return {
    calls,
    fetchFn: async (input, init) => {
      calls.push({ url: input, body: parseJson(init?.body ?? '') });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }));
    },
  };
};

describe('makeBot', () => {
  test('sendMessage posts HTML and returns the message id', async () => {
    const { calls, fetchFn } = makeCapture();
    const bot = makeBot('TOKEN', 7, fetchFn);
    const messageId = await bot.sendMessage('hello <b>world</b>');
    assert.equal(messageId, 42);
    assert.equal(calls.length, 1);
    assert.ok(calls[0]?.url.endsWith('/botTOKEN/sendMessage'));
    assert.equal(readProp(calls[0]?.body, 'chat_id'), 7);
    assert.equal(readProp(calls[0]?.body, 'parse_mode'), 'HTML');
  });

  test('network failure degrades to undefined, never throws', async () => {
    const bot = makeBot('TOKEN', 7, async () => {
      throw new Error('down');
    });
    assert.equal(await bot.sendMessage('x'), undefined);
    await bot.answerCallback('cb', 'text'); // must not throw
  });
});

describe('sendLong (AC-3.7)', () => {
  test('splits an oversized text into several sendMessage calls', async () => {
    const { calls, fetchFn } = makeCapture();
    const bot = makeBot('TOKEN', 7, fetchFn);
    const long = Array.from({ length: 400 }, (_, i) => `line ${i} — ${'x'.repeat(20)}`).join('\n');
    await sendLong(bot, long);
    assert.ok(calls.length >= 2);
  });
});
