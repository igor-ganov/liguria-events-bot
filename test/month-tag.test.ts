// Campaign names start with the month so a report sorts chronologically —
// knowledge/practices/utm-conventions.md in the promotion knowledge base.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { monthTag } from '../src/links/month-tag.ts';

describe('monthTag', () => {
  test('is the month the send happened in, then what it is', () => {
    assert.equal(monthTag('2026-10-05', 'channel'), '2026-10-channel');
    assert.equal(monthTag('2027-01-31', 'morning'), '2027-01-morning');
  });
});
