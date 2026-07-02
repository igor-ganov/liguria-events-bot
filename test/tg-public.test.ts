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
  const okFetch = async (): Promise<Response> => new Response(html);

  test('keeps posts within the ~180d window, drops ancient ones', async () => {
    const posts = await parsePreviewHtml('telegram', html);
    const newestMs = Math.max(...posts.map((post) => post.date)) * 1000;

    // A day after the newest post: promoter-style window keeps them.
    const soon = await makeTgCollector(okFetch, 'telegram', () => newestMs + 86_400_000)();
    assert.equal(soon.failed, false);
    assert.equal(soon.source, 'tg:telegram');
    assert.ok(soon.posts.length > 0);

    // A year after: everything is past the window.
    const late = await makeTgCollector(okFetch, 'telegram', () => newestMs + 365 * 86_400_000)();
    assert.equal(late.posts.length, 0);
  });

  test('never throws on network failure (AC-1.3)', async () => {
    const dead = async (): Promise<Response> => {
      throw new Error('network down');
    };
    const failed = await makeTgCollector(dead, 'telegram', () => Date.now())();
    assert.equal(failed.failed, true);
  });
});
