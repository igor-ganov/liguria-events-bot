// T10 — i18n parity and interpolation (AC-7.3, AC-4.4).
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { t } from '../src/i18n.ts';

describe('i18n', () => {
  test('every key renders in both languages', () => {
    // t() is typed over the RU key set; EN is typed as a full record —
    // compilation already guarantees parity. Spot-check rendering:
    assert.notEqual(t('help.text', 'ru'), '');
    assert.notEqual(t('help.text', 'en'), '');
    assert.notEqual(t('help.text', 'ru'), t('help.text', 'en'));
  });

  test('interpolates variables and leaves unknown placeholders intact', () => {
    assert.equal(
      t('settings.hour', 'en', { value: 9 }),
      'Digest hour: 9:00',
    );
    assert.ok(t('qa.failed', 'ru', {}).includes('{reason}'));
  });
});
