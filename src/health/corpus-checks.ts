import { hasCjk } from '../domain/event.ts';
import type { CheckResult } from './types.ts';
import type { CompactEvent } from '../domain/event.ts';

const verdict = (id: string, title: string, broken: readonly string[], noun: string): CheckResult => ({
  id,
  title,
  status: broken.length === 0 ? 'ok' : 'fail',
  detail:
    broken.length === 0
      ? `none of ${noun}`
      : `${broken.length} ${noun}: ${broken.slice(0, 3).join(', ')}${broken.length > 3 ? '…' : ''}`,
});

const sessionDates = (event: CompactEvent): readonly string[] =>
  [...(event.p ?? [])].map((session) => session.date).sort();

/**
 * Everything that can be wrong with the corpus itself, asked of the index the
 * site is actually served from. Each of these has been a real bug: a container
 * whose advertised run outlived its programme, the same evening listed twice,
 * a description the model answered in Chinese, an event with no words at all.
 */
export const corpusChecks = (index: readonly CompactEvent[]): readonly CheckResult[] => {
  const containers = index.filter((event) => event.k === true && (event.p ?? []).length > 0);
  return [
    verdict(
      'container-span',
      'A container starts on its first programmed day',
      containers.filter((event) => event.s !== sessionDates(event).at(0)).map((event) => event.id),
      'containers whose run disagrees with their programme',
    ),
    verdict(
      'session-duplicates',
      'No evening is listed twice',
      index
        .filter((event) => {
          const keys = (event.p ?? []).map((session) => `${session.date}|${session.time ?? ''}`);
          return new Set(keys).size !== keys.length;
        })
        .map((event) => event.id),
      'events with a repeated session',
    ),
    verdict(
      'description-cjk',
      'No description came back in the wrong script',
      index.filter((event) => event.d !== undefined && hasCjk(event.d)).map((event) => event.id),
      'events with stray CJK glyphs',
    ),
    verdict(
      'description-present',
      'Every event says what it is',
      index.filter((event) => (event.d?.en ?? '').trim() === '').map((event) => event.id),
      'events with no English description',
    ),
  ];
};
