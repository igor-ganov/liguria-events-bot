import type { ServerEvent } from './wire.ts';

/**
 * One number the bot reports about itself. pro-motion keeps a reading's
 * `value` and files it under its `kind`, and takes the last one of each day,
 * so it can be sent every tick without being counted twenty-four times.
 */
export const reading = (kind: string, value: number): ServerEvent => ({
  event: 'reading',
  props: { kind },
  metrics: { value },
});
