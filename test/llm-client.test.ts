// T7 — LLM client: fallback order and tolerant JSON (AC-2.5, AC-4.6).
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { extractJson, makeChat } from '../src/llm/client.ts';
import type { AiBinding } from '../src/llm/client.ts';

const geminiPayload = (text: string): string =>
  JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] });

describe('extractJson', () => {
  test('plain JSON', () => {
    assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  });
  test('fenced JSON', () => {
    assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  });
  test('JSON embedded in prose', () => {
    assert.deepEqual(extractJson('Sure! {"a":1} hope it helps'), { a: 1 });
  });
  test('garbage → undefined', () => {
    assert.equal(extractJson('no json at all'), undefined);
  });
});

describe('makeChat', () => {
  const workingAi: AiBinding = {
    run: async () => ({ response: 'from workers ai' }),
  };
  const brokenAi: AiBinding = {
    run: async () => {
      throw new Error('ai down');
    },
  };

  test('Workers AI first — Gemini untouched', async () => {
    let geminiCalled = false;
    const fetchFn = async (): Promise<Response> => {
      geminiCalled = true;
      return new Response(geminiPayload('from gemini'));
    };
    const chat = makeChat({ ai: workingAi, geminiApiKey: 'k', fetchFn });
    assert.equal(await chat('s', 'u'), 'from workers ai');
    assert.equal(geminiCalled, false);
  });

  test('falls back to Gemini when Workers AI fails (AC-2.5)', async () => {
    const fetchFn = async (): Promise<Response> => new Response(geminiPayload('from gemini'));
    const chat = makeChat({ ai: brokenAi, geminiApiKey: 'k', fetchFn });
    assert.equal(await chat('s', 'u'), 'from gemini');
  });

  test('throws when every provider fails (AC-4.6 surfaces it upstream)', async () => {
    const fetchFn = async (): Promise<Response> => new Response('down', { status: 500 });
    const chat = makeChat({ ai: brokenAi, geminiApiKey: 'k', fetchFn });
    await assert.rejects(chat('s', 'u'));
  });
});
