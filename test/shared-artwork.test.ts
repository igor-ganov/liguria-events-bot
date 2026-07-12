// A source can hand one poster to two genuinely different events (Teatro della
// Tosse gives Gothica's artwork to the free family series alongside it). They
// must stay two events, but only one may carry the picture.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { dropSharedArtwork } from '../src/pipeline/shared-artwork.ts';
import type { CompactEvent } from '../src/domain/event.ts';

const VENUE = 'Parco Villa Duchessa di Galliera';

const gothica: CompactEvent = {
  id: 'g',
  t: 'Gothica',
  s: '2026-07-02',
  e: '2026-07-26',
  c: ['theatre'],
  u: 'https://genovateatro.it/gothica.htm',
  v: VENUE,
  img: 'https://genovateatro.it/square/2186_half.jpg',
};
const mondays: CompactEvent = {
  id: 'm',
  t: 'I lunedì nel parco',
  s: '2026-07-06',
  e: '2026-07-20',
  c: ['family'],
  u: 'https://genovateatro.it/i-luned-nel-parco.htm',
  v: VENUE,
  img: 'https://genovateatro.it/square/2188_half.jpg',
};

/** Both URLs serve the same 39974-byte JPEG; a third serves its own. */
const head = async (url: string): Promise<Response> =>
  new Response('', {
    headers: { 'content-length': url.includes('9999') ? '12345' : '39974' },
  });

describe('dropSharedArtwork', () => {
  test('leaves the poster on the earlier event, strips the copy', async () => {
    const out = await dropSharedArtwork(head, [gothica, mondays]);
    assert.equal(out.find((e) => e.id === 'g')?.img, gothica.img);
    assert.equal(out.find((e) => e.id === 'm')?.img, undefined);
    assert.equal(out.length, 2, 'the events themselves are never merged');
  });

  test('keeps distinct posters at the same venue', async () => {
    const other = { ...mondays, id: 'o', img: 'https://genovateatro.it/square/9999_half.jpg' };
    const out = await dropSharedArtwork(head, [gothica, other]);
    assert.equal(out.find((e) => e.id === 'o')?.img, other.img);
  });

  test('a venue with a single illustrated event needs no HEAD at all', async () => {
    const boom = async (): Promise<Response> => {
      throw new Error('should not fetch');
    };
    assert.deepEqual(await dropSharedArtwork(boom, [gothica]), [gothica]);
  });
});
