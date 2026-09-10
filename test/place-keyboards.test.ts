// The two-level place picker. A hundred province capitals do not fit on one
// keyboard, and a reader near Savona wants Liguria rather than a choice
// between four towns they do not live in.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { cityKeyboard, regionKeyboard } from '../src/delivery/place-keyboards.ts';

const texts = (keyboard: readonly (readonly { text: string }[])[]): readonly string[] =>
  keyboard.flat().map((button) => button.text);

const data = (keyboard: readonly (readonly { callbackData: string }[])[]): readonly string[] =>
  keyboard.flat().map((button) => button.callbackData);

describe('regionKeyboard', () => {
  test('offers every region and the whole country', () => {
    const keyboard = regionKeyboard('ru', 'set:main');
    assert.equal(texts(keyboard).includes('вся Италия'), true);
    ['Liguria', 'Lombardia', 'Sicilia', "Valle d'Aosta"].forEach((name) =>
      assert.equal(texts(keyboard).includes(name), true, name),
    );
    assert.equal(data(keyboard).includes('set:place:r:liguria'), true);
    assert.equal(data(keyboard).at(-1), 'set:main');
  });

  test('every button carries a payload Telegram can hold', () => {
    // 64 bytes is the callback_data limit, and a silent overflow is a button
    // that does nothing.
    data(regionKeyboard('it', 'set:main')).forEach((payload) =>
      assert.ok(new TextEncoder().encode(payload).length <= 64, payload),
    );
  });
});

describe('cityKeyboard', () => {
  test('the cities of that region, and the region itself', () => {
    const keyboard = cityKeyboard('liguria', 'ru');
    assert.deepEqual(texts(keyboard).slice(1, -1).toSorted(), ['Genova', 'Imperia', 'La Spezia', 'Savona']);
    assert.equal(data(keyboard).includes('set:place:rg:liguria'), true);
    assert.equal(data(keyboard).includes('set:place:c:genova'), true);
  });

  test('a region nobody has heard of offers no cities, and still goes back', () => {
    const keyboard = cityKeyboard('mordor', 'en');
    assert.deepEqual(texts(keyboard), ['the whole region', '←']);
  });
});
