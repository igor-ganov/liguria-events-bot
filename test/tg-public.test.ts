// T6 — t.me/s preview collector (AC-1.1, AC-1.3).
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTgCollector, parsePreviewHtml } from '../src/collectors/tg-public.ts';

const html = readFileSync(join(import.meta.dirname, 'fixtures', 'tg-preview.html'), 'utf8');

describe('parsePreviewHtml (fixture)', () => {
  test('extracts posts with ids, dates and text', async () => {
    const posts = await parsePreviewHtml('telegram', html);
    assert.ok(posts.length > 3, `expected >3 posts, got ${posts.length}`);
    for (const post of posts) {
      assert.equal(post.channel, 'telegram');
      assert.ok(post.messageId > 0);
      assert.ok(post.date > 0);
      assert.ok(post.text.length > 0);
    }
  });
});

describe('makeTgCollector', () => {
  test('keeps only fresh posts and never throws (AC-1.3)', async () => {
    const now = (): number => Date.now();
    const okFetch = async (): Promise<Response> => new Response(html);
    const outcome = await makeTgCollector(okFetch, 'telegram', now)();
    assert.equal(outcome.failed, false);
    assert.equal(outcome.source, 'tg:telegram');
    // Fixture posts are from the past — all filtered by the 3-day freshness cut.
    assert.equal(outcome.posts.length, 0);

    const dead = async (): Promise<Response> => {
      throw new Error('network down');
    };
    const failed = await makeTgCollector(dead, 'telegram', now)();
    assert.equal(failed.failed, true);
  });
});
