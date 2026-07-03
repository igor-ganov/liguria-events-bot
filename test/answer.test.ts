// T12 — grounded Q&A + plan prompts (AC-4.1–4.4, AC-6.2–6.3).
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  answerSystem,
  detectLanguage,
  makeAnswer,
  makePlan,
  serializeCorpus,
} from '../src/llm/answer.ts';
import type { ChatFn } from '../src/llm/client.ts';
import type { EventRecord } from '../src/domain/event.ts';

const record = (id: string, startDate: string): EventRecord => ({
  id,
  title: `Event ${id}`,
  startDate,
  categories: ['music'],
  descriptions: { en: 'Desc.', it: 'Desc.', ru: 'Desc.' },
  url: `https://example.org/${id}`,
  source: 'visitgenoa',
  enriched: true,
  addedAt: 1,
});

describe('detectLanguage (AC-4.4)', () => {
  test('Cyrillic → ru, otherwise en', () => {
    assert.equal(detectLanguage('куда сходить в субботу?'), 'ru');
    assert.equal(detectLanguage('where to go on Saturday?'), 'en');
  });
});

describe('serializeCorpus', () => {
  test('sorted by date and capped by characters', () => {
    const events = [record('b', '2026-07-20'), record('a', '2026-07-01')];
    const corpus = serializeCorpus(events);
    assert.ok(corpus.indexOf('Event a') < corpus.indexOf('Event b'));
    const capped = serializeCorpus(events, 80);
    assert.ok(capped.includes('Event a'));
    assert.equal(capped.includes('Event b'), false);
  });
});

describe('answerSystem', () => {
  test('honesty directive; forced language vs mirror (AC-4.1)', () => {
    const forced = answerSystem('ru', '2026-07-01');
    assert.ok(forced.includes('ONLY the events'));
    assert.ok(forced.includes('Never invent'));
    assert.ok(forced.includes('Always answer in Russian'));
    assert.ok(answerSystem('it', '2026-07-01').includes('Always answer in Italian'));
    // undefined → mirror the question's language
    assert.ok(answerSystem(undefined, '2026-07-01').includes('SAME language as the user question'));
  });
});

describe('makeAnswer / makePlan prompt assembly', () => {
  test('question and corpus land in the user prompt (AC-4.1)', async () => {
    let seenUser = '';
    const chat: ChatFn = async (_system, user) => {
      seenUser = user;
      return 'answer';
    };
    await makeAnswer(chat)('what tonight?', [record('a', '2026-07-01')], 'en', '2026-07-01');
    assert.ok(seenUser.includes('what tonight?'));
    assert.ok(seenUser.includes('https://example.org/a'));
  });

  test('plan includes weekend days, preferences and forecast (AC-6.2/6.3)', async () => {
    let seenSystem = '';
    let seenUser = '';
    const chat: ChatFn = async (system, user) => {
      seenSystem = system;
      seenUser = user;
      return 'plan';
    };
    await makePlan(chat)(
      [record('a', '2026-07-04')],
      [{ date: '2026-07-04', tMaxC: 28, precipitationChance: 70 }],
      ['music'],
      'en',
      '2026-07-01',
      ['2026-07-04', '2026-07-05'],
    );
    assert.ok(seenSystem.includes('rainy'));
    assert.ok(seenUser.includes('WEEKEND DAYS: 2026-07-04, 2026-07-05'));
    assert.ok(seenUser.includes('USER PREFERS CATEGORIES: music'));
    assert.ok(seenUser.includes('precipitation chance 70%'));
  });

  test('missing forecast degrades silently (AC-6.3)', async () => {
    let seenUser = '';
    const chat: ChatFn = async (_system, user) => {
      seenUser = user;
      return 'plan';
    };
    await makePlan(chat)([record('a', '2026-07-04')], undefined, [], 'en', '2026-07-01', ['2026-07-04']);
    assert.equal(seenUser.includes('WEATHER FORECAST'), false);
  });
});
