// The site is sliced by region; the city stays on the record because it is the
// geocoder's anchor — a region is far too wide to tell a good answer from a
// wrong one.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { ALL_REGIONS, regionOfCity, regionOfProvince } from '../src/domain/region.ts';

describe('regions', () => {
  test('there are twenty of them', () => {
    assert.equal(ALL_REGIONS.length, 20);
  });
  test('a province code lands in its region', () => {
    assert.equal(regionOfProvince('GE')?.slug, 'liguria');
    assert.equal(regionOfProvince('fi')?.name, 'Toscana');
    assert.equal(regionOfProvince('ZZ'), undefined);
  });
  test('a capital lands in the same region as its province', () => {
    assert.equal(regionOfCity('genova')?.slug, 'liguria');
    assert.equal(regionOfCity('milano')?.slug, 'lombardia');
    assert.equal(regionOfCity('reggio-calabria')?.slug, 'calabria');
    assert.equal(regionOfCity('reggio-emilia')?.slug, 'emilia-romagna');
  });
  test('every region slug is url-safe', () => {
    for (const region of ALL_REGIONS) assert.match(region.slug, /^[a-z0-9-]+$/);
  });
});
