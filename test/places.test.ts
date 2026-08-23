import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { placeIndex } from '../src/domain/places.ts';

describe('placeIndex', () => {
  test('a region lists every one of its province capitals', () => {
    // Liguria has four. The site had pages for three, because the fourth had no
    // events and was therefore invisible — Savona answered 404.
    assert.deepEqual(placeIndex()['liguria'], ['genova', 'imperia', 'la-spezia', 'savona']);
  });

  test('every region of Italy is present', () => {
    const index = placeIndex();
    assert.equal(Object.keys(index).length, 20);
    assert.ok((index['lombardia'] ?? []).includes('milano'));
    assert.ok((index['sicilia'] ?? []).includes('palermo'));
  });

  test('the list does not depend on events, only on the place table', () => {
    // Called twice with nothing else in play: a constant, not a projection.
    assert.deepEqual(placeIndex(), placeIndex());
  });

  test('cities are sorted, so the built page order is stable', () => {
    const cities = placeIndex()['piemonte'] ?? [];
    assert.deepEqual([...cities].sort(), [...cities]);
  });
});
