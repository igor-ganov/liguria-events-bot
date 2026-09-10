import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { placeLabel } from '../src/delivery/place-label.ts';

describe('placeLabel', () => {
  test('a city and a region are named as the site names them', () => {
    assert.equal(placeLabel('city:genova', 'ru'), 'Genova');
    assert.equal(placeLabel('region:liguria', 'it'), 'Liguria');
    assert.equal(placeLabel('region:trentino-alto-adige', 'en'), 'Trentino-Alto Adige');
  });

  test('no choice is the whole country, in the reader’s language', () => {
    assert.equal(placeLabel('', 'ru'), 'вся Италия');
    assert.equal(placeLabel('', 'en'), 'all of Italy');
    assert.equal(placeLabel('', 'it'), 'tutta Italia');
  });
});
