// The Discovery API answers in JSON and hands us the venue's coordinates, so
// these events never touch the geocoder. It gives no province: the comune's
// point resolves to the nearest capital, and the region it rolls up to is right
// regardless (Assago -> Milano -> Lombardia).
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { parseTicketmasterEvent } from '../src/collectors/ticketmaster.ts';
import { regionOfCity } from '../src/domain/region.ts';

const event = (over: Record<string, unknown> = {}, venue: Record<string, unknown> = {}) => ({
  name: 'Korn',
  url: 'https://www.ticketmaster.it/event/korn',
  dates: { start: { localDate: '2026-11-21', localTime: '21:00:00' } },
  classifications: [{ segment: { name: 'Music' } }],
  images: [
    { url: 'https://img/small.jpg', width: 100 },
    { url: 'https://img/big.jpg', width: 2048 },
  ],
  priceRanges: [{ min: 45, max: 90, currency: 'EUR' }],
  _embedded: {
    venues: [
      {
        name: 'Unipol Forum',
        city: { name: 'Assago' },
        address: { line1: 'Via Giuseppe di Vittorio, 6' },
        location: { latitude: '45.402496', longitude: '9.139273' },
        ...venue,
      },
    ],
  },
  ...over,
});

describe('parseTicketmasterEvent', () => {
  test('a venue in a comune files under its province capital, and its region', () => {
    const [raw] = parseTicketmasterEvent(event());
    assert.equal(raw?.city, 'milano');
    assert.equal(regionOfCity(raw?.city ?? '')?.slug, 'lombardia');
    assert.equal(raw?.lat, 45.402496);
    assert.equal(raw?.time, '21:00');
    assert.equal(raw?.venue, 'Unipol Forum');
    assert.equal(raw?.categoryHint, 'music');
    assert.equal(raw?.image, 'https://img/big.jpg', 'the widest image wins');
    assert.equal(raw?.priceInfo, '45–90 EUR');
  });

  test('a 0,0 placeholder is a missing coordinate, not a coordinate', () => {
    const [raw] = parseTicketmasterEvent(
      event({}, { location: { latitude: '0.000000', longitude: '0.000000' }, city: { name: 'Milano' } }),
    );
    assert.equal(raw?.lat, undefined, 'no pin in the Gulf of Guinea');
    assert.equal(raw?.city, 'milano', 'the comune name still places it');
  });

  test('an event that can be placed nowhere is dropped, not filed under a default', () => {
    assert.deepEqual(
      parseTicketmasterEvent(
        event({}, { location: undefined, city: { name: 'Borgo Che Non Esiste' } }),
      ),
      [],
    );
  });

  test('junk is skipped rather than half-parsed', () => {
    assert.deepEqual(parseTicketmasterEvent({ name: 'no dates' }), []);
    assert.deepEqual(parseTicketmasterEvent(undefined), []);
  });
});
