// T14 — surprise pick weighting (AC-6.1).
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { pickSurprise } from '../src/pipeline/surprise.ts';
import type { CompactEvent } from '../src/domain/event.ts';

const compact = (id: string, c: CompactEvent['c']): CompactEvent => ({
  id,
  t: `Event ${id}`,
  s: '2026-07-05',
  c,
  u: 'https://example.org',
});

const index = [compact('plain', ['other']), compact('fav', ['music'])];

describe('pickSurprise', () => {
  test('deterministic with an injected rng', () => {
    assert.equal(pickSurprise(index, '2026-07-01', [], () => 0)?.id, 'fav'); // sorted: fav < plain
    assert.equal(pickSurprise(index, '2026-07-01', [], () => 0.99)?.id, 'plain');
  });

  test('preferred categories weigh ×3', () => {
    // weights: fav(music)=3, plain=1 → rolls < 0.75 land on fav
    assert.equal(pickSurprise(index, '2026-07-01', ['music'], () => 0.7)?.id, 'fav');
    assert.equal(pickSurprise(index, '2026-07-01', ['music'], () => 0.8)?.id, 'plain');
  });

  test('excludes the current card and respects the horizon', () => {
    assert.equal(pickSurprise(index, '2026-07-01', [], () => 0, 'fav')?.id, 'plain');
    assert.equal(pickSurprise(index, '2026-08-01', [], () => 0), undefined); // all past
  });
});
