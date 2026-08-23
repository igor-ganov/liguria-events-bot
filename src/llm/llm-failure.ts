/**
 * Why a model call did not produce an answer, in one word.
 *
 * Every failure path used to be swallowed by a bare `catch`, so a run could
 * report "6 failed" and nothing else — which is not enough to act on. A rate
 * limit, a timeout and a model answering prose are three different problems
 * with three different fixes.
 */
export const classifyFailure = (error: unknown): string => {
  const text = String(error instanceof Error ? error.message : error).toLowerCase();
  if (text.includes('timeout') || text.includes('aborted')) return 'timeout';
  if (text.includes('429') || text.includes('rate')) return 'rate-limit';
  if (text.includes('capacity') || text.includes('overload')) return 'overloaded';
  if (/\b(4\d\d|5\d\d)\b/.test(text)) return 'http-error';
  if (text.includes('json') || text.includes('parse') || text.includes('unexpected token')) {
    return 'bad-json';
  }
  if (text === '' || text === 'undefined') return 'unknown';
  return text.slice(0, 40);
};

/** Tally reasons across a run, so the log carries counts rather than a stack. */
export const tallyFailures = (reasons: readonly string[]): Readonly<Record<string, number>> =>
  reasons.reduce<Record<string, number>>(
    (counts, reason) => ({ ...counts, [reason]: (counts[reason] ?? 0) + 1 }),
    {},
  );
