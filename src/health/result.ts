import type { CheckResult } from './types.ts';

/** The two verdicts every check ends in, so no check spells them itself. */
export const ok = (id: string, title: string, detail: string): CheckResult => ({ id, title, status: 'ok', detail });

export const bad = (id: string, title: string, detail: string): CheckResult => ({ id, title, status: 'fail', detail });
