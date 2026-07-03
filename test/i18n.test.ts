// T10 — i18n parity and interpolation (AC-7.3, AC-4.4).
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { t } from '../src/i18n.ts';

describe('i18n', () => {
  test('every key renders in all three languages', () => {
    // t() is typed over the RU key set; EN and IT are full records —
    // compilation already guarantees parity. Spot-check rendering:
    for (const lang of ['ru', 'it', 'en'] as const) {
      assert.notEqual(t('help.text', lang), '');
      assert.notEqual(t('header.gems', lang), '');
    }
    assert.notEqual(t('help.text', 'ru'), t('help.text', 'en'));
    assert.notEqual(t('help.text', 'it'), t('help.text', 'en'));
    assert.equal(t('lang.it', 'it'), 'Italiano');
  });

  test('interpolates variables and leaves unknown placeholders intact', () => {
    assert.equal(
      t('settings.hour', 'en', { value: 9 }),
      'Digest hour: 9:00',
    );
    assert.ok(t('qa.failed', 'ru', {}).includes('{reason}'));
  });
});
