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
  // The all-providers message already names each provider's reason; collapsing
  // it to one word hides whether the fallback was even reached.
  const chain = /all llm providers failed: (.+)$/.exec(text)?.[1];
  if (chain !== undefined) return chain.replace(/\s+/g, '');
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

/**
 * Why an answer yielded no events.
 *
 * A reply that stops mid-object is not the model refusing — it is the token
 * budget cutting it off, which is a different fix. It looked identical to a
 * refusal until this told them apart: half the enrichment failures on
 * production were three-language articles that did not fit in 4 096 tokens.
 */
export const emptyReason = (reply: string): string => {
  const text = reply.trim().replace(/```\s*$/, '').trimEnd();
  return text === '' ? 'no-answer' : text.endsWith('}') ? 'unparsed' : 'truncated';
};
