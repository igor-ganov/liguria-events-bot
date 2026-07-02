// T11 — rendering: lines, grouping, cards, splitting (AC-3.1–3.7, AC-6.1).
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  escapeHtml,
  formatDateSpan,
  renderCard,
  renderEventLine,
  renderGrouped,
  renderList,
  splitMessage,
} from '../src/delivery/render.ts';
import type { CompactEvent, EventRecord } from '../src/domain/event.ts';

const compact: CompactEvent = {
  id: 'a',
  t: 'Concert <live> & loud',
  s: '2026-07-04',
  e: '2026-07-05',
  h: '21:00',
  c: ['music'],
  v: 'Porto Antico',
  f: true,
  u: 'https://example.org/1',
};

describe('escapeHtml', () => {
  test('escapes the three HTML specials', () => {
    assert.equal(escapeHtml('<a & b>'), '&lt;a &amp; b&gt;');
  });
});

describe('renderEventLine', () => {
  test('links the title, shows dates, venue, free flag', () => {
    const line = renderEventLine(compact);
    assert.ok(line.includes('<a href="https://example.org/1">'));
    assert.ok(line.includes('Concert &lt;live&gt; &amp; loud'));
    assert.ok(line.includes('04.07–05.07, 21:00'));
    assert.ok(line.includes('Porto Antico'));
    assert.ok(line.includes('free'));
  });
  test('formatDateSpan omits missing parts', () => {
    const { e: _e, h: _h, ...single } = compact;
    assert.equal(formatDateSpan(single), '04.07');
  });
});

describe('renderGrouped / renderList', () => {
  test('groups by category with emoji headers (AC-3.1)', () => {
    const other: CompactEvent = { ...compact, id: 'b', c: ['art'], t: 'Mostra' };
    const text = renderGrouped([compact, other], 'en');
    assert.ok(text.indexOf('🎵') < text.indexOf('🖼')); // taxonomy order
    assert.ok(text.includes('<b>Music</b>'));
    assert.ok(text.includes('<b>Art &amp; exhibitions</b>'));
  });
  test('empty window says so explicitly (AC-3.6)', () => {
    assert.ok(renderList('header.today', [], 'en').includes('Nothing collected'));
  });
});

describe('renderCard', () => {
  const record: EventRecord = {
    id: 'a',
    title: 'Electropark',
    startDate: '2026-07-10',
    time: '21:00',
    venue: 'Porto Antico',
    categories: ['music'],
    description: 'Electronic music by the sea.',
    priceInfo: '€ 15,00',
    url: 'https://example.org/1',
    source: 'visitgenoa',
    enriched: true,
    addedAt: 1,
  };
  test('contains title, meta, description and link (AC-6.1)', () => {
    const card = renderCard(record, 'en');
    assert.ok(card.includes('<b>Electropark</b>'));
    assert.ok(card.includes('🎵'));
    assert.ok(card.includes('10.07, 21:00'));
    assert.ok(card.includes('📍 Porto Antico'));
    assert.ok(card.includes('💶 € 15,00'));
    assert.ok(card.includes('Electronic music by the sea.'));
    assert.ok(card.includes('href="https://example.org/1"'));
  });
});

describe('splitMessage (AC-3.7)', () => {
  test('short text stays whole', () => {
    assert.deepEqual(splitMessage('hello', 10), ['hello']);
  });
  test('splits on line boundaries under the limit', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line-${i}`);
    const parts = splitMessage(lines.join('\n'), 20);
    assert.ok(parts.length > 1);
    for (const part of parts) {
      assert.ok(part.length <= 20);
    }
    assert.equal(parts.join('\n'), lines.join('\n')); // nothing lost
  });
  test('hard-splits a single oversized line', () => {
    const parts = splitMessage('x'.repeat(45), 20);
    assert.deepEqual(parts.map((part) => part.length), [20, 20, 5]);
  });
});
