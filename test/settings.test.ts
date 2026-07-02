// T13 — settings, digest due-matching (AC-5.1–5.4, AC-7.1–7.2, AC-4.4).
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  digestDueWindow,
  parseSettings,
  readSettings,
  toggleCategory,
  uiLanguage,
  writeSettings,
} from '../src/pipeline/settings.ts';
import type { Settings } from '../src/pipeline/settings.ts';
import { makeKvStub } from './kv-stub.ts';

describe('settings persistence', () => {
  test('defaults for unknown users, round-trip after write (AC-7.2)', async () => {
    const kv = makeKvStub();
    assert.deepEqual(await readSettings(kv, 1), DEFAULT_SETTINGS);
    const next: Settings = { language: 'ru', digest: 'daily', digestHour: 8, categories: ['music'] };
    await writeSettings(kv, 1, next);
    assert.deepEqual(await readSettings(kv, 1), next);
  });
  test('malformed stored value degrades to defaults per field', () => {
    const parsed = parseSettings('{"language":"xx","digestHour":99,"categories":["music","bogus"]}');
    assert.equal(parsed.language, 'auto');
    assert.equal(parsed.digestHour, DEFAULT_SETTINGS.digestHour);
    assert.deepEqual(parsed.categories, ['music']);
  });
});

describe('toggleCategory / uiLanguage', () => {
  test('toggle adds then removes', () => {
    const on = toggleCategory(DEFAULT_SETTINGS, 'art');
    assert.deepEqual(on.categories, ['art']);
    assert.deepEqual(toggleCategory(on, 'art').categories, []);
  });
  test('explicit language beats the hint (AC-4.4)', () => {
    assert.equal(uiLanguage(DEFAULT_SETTINGS, 'ru'), 'ru');
    assert.equal(uiLanguage({ ...DEFAULT_SETTINGS, language: 'en' }, 'ru'), 'en');
  });
});

describe('digestDueWindow (AC-5.1)', () => {
  const daily: Settings = { ...DEFAULT_SETTINGS, digest: 'daily', digestHour: 9 };
  test('off or wrong hour → undefined (AC-5.4)', () => {
    assert.equal(digestDueWindow(DEFAULT_SETTINGS, '2026-07-01', 9), undefined);
    assert.equal(digestDueWindow(daily, '2026-07-01', 10), undefined);
  });
  test('daily at the chosen hour → tomorrow', () => {
    assert.deepEqual(digestDueWindow(daily, '2026-07-01', 9), {
      from: '2026-07-02',
      to: '2026-07-02',
    });
  });
  test('weekly fires only on Friday and covers the weekend', () => {
    const weekly: Settings = { ...daily, digest: 'weekly' };
    assert.equal(digestDueWindow(weekly, '2026-07-01', 9), undefined); // Wednesday
    assert.deepEqual(digestDueWindow(weekly, '2026-07-03', 9), {
      from: '2026-07-04',
      to: '2026-07-05',
    });
  });
});
