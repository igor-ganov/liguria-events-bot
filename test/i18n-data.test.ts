// i18n Phase B1 — localized descriptions: parse/fallback, compact, ICS lang.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  descriptionOf,
  localized,
  parseEventRecord,
  parseLocalized,
  titleOf,
  toCompact,
} from '../src/domain/event.ts';
import type { CompactEvent, EventRecord } from '../src/domain/event.ts';
import { buildIcs, langFromQuery } from '../src/calendar/ics.ts';

describe('localized / descriptionOf / parseLocalized', () => {
  test('localized fills it/ru from en', () => {
    assert.deepEqual(localized('hi'), { en: 'hi', it: 'hi', ru: 'hi' });
    assert.deepEqual(localized('en', 'it'), { en: 'en', it: 'it', ru: 'en' });
  });
  test('descriptionOf falls back to en', () => {
    assert.equal(descriptionOf({ en: 'E', it: 'I', ru: 'R' }, 'ru'), 'R');
    assert.equal(descriptionOf({ en: 'E', it: '', ru: '' }, 'it'), 'E');
    assert.equal(descriptionOf(undefined, 'en'), '');
  });
  test('parseLocalized: map, partial (fills en), legacy string, empty', () => {
    assert.deepEqual(parseLocalized({ en: 'E', it: 'I', ru: 'R' }), { en: 'E', it: 'I', ru: 'R' });
    assert.deepEqual(parseLocalized({ en: 'E' }), { en: 'E', it: 'E', ru: 'E' });
    assert.deepEqual(parseLocalized(undefined, 'legacy'), { en: 'legacy', it: 'legacy', ru: 'legacy' });
    assert.equal(parseLocalized(undefined), undefined);
  });
});

describe('titleOf (AC-2b.2)', () => {
  const base: CompactEvent = { id: 'a', t: 'Sagra del pesto', s: '2026-07-04', c: ['food'], u: 'https://x' };
  test('localized title wins, missing falls back to original', () => {
    const withTl: CompactEvent = { ...base, tl: { en: 'Pesto festival', it: 'Sagra del pesto', ru: 'Фестиваль песто' } };
    assert.equal(titleOf(withTl, 'ru'), 'Фестиваль песто');
    assert.equal(titleOf(withTl, 'en'), 'Pesto festival');
    assert.equal(titleOf(base, 'ru'), 'Sagra del pesto'); // no tl → original
    // an empty translation falls back to the ORIGINAL title, not another lang
    assert.equal(titleOf({ ...base, tl: { en: 'X', it: '', ru: '' } }, 'it'), 'Sagra del pesto');
  });
});

describe('legacy record back-compat (AC-1.2)', () => {
  test('a record with a plain `description` string parses into en/it/ru', () => {
    const legacy = JSON.stringify({
      id: 'x', title: 'T', startDate: '2026-07-10', category: 'music',
      description: 'Old string desc.', url: 'https://x', source: 'visitgenoa',
      enriched: true, addedAt: 1,
    });
    const parsed = parseEventRecord(legacy);
    assert.ok(parsed !== undefined);
    assert.deepEqual(parsed.descriptions, { en: 'Old string desc.', it: 'Old string desc.', ru: 'Old string desc.' });
    assert.deepEqual(parsed.categories, ['music']);
  });
});

describe('ICS localization (AC-5.1)', () => {
  const record: EventRecord = {
    id: 'aa', title: 'Concerto', startDate: '2026-07-04',
    categories: ['music'],
    descriptions: { en: 'A seaside concert.', it: 'Un concerto sul mare.', ru: 'Концерт у моря.' },
    url: 'https://x/1', source: 'visitgenoa', enriched: true, addedAt: 1,
  };
  const compact = toCompact(record);

  test('langFromQuery: default en, unknown en, valid passes', () => {
    assert.equal(langFromQuery(new URLSearchParams('')), 'en');
    assert.equal(langFromQuery(new URLSearchParams('lang=xx')), 'en');
    assert.equal(langFromQuery(new URLSearchParams('lang=it')), 'it');
  });
  test('DESCRIPTION uses the requested language', () => {
    const now = Date.parse('2026-07-01T00:00:00Z');
    assert.ok(buildIcs([compact], now, 'it').includes('Un concerto sul mare.'));
    assert.ok(buildIcs([compact], now, 'ru').includes('Концерт у моря.'));
    assert.ok(buildIcs([compact], now).includes('A seaside concert.'));
  });
});
