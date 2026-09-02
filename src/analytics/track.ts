import type { Env } from '../config.ts';
import type { ServerEvent } from './wire.ts';
import { wire } from './wire.ts';

/**
 * Reports one event to pro-motion. Three properties matter here, in this order:
 * it never throws, it never delays the reply the user is waiting for, and it
 * does nothing at all when the worker has no endpoint configured — which is the
 * normal state of a fresh checkout and of every test.
 */
export const track = async (env: Env, event: ServerEvent): Promise<void> => {
  if (!env.PM_ENDPOINT || !env.PM_TOKEN) return;
  try {
    await fetch(env.PM_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pm-token': env.PM_TOKEN },
      body: JSON.stringify(wire(event)),
    });
  } catch {
    // Analytics must never be able to break the thing it measures.
  }
};
