/**
 * The wire shape pro-motion's collector accepts. Mirrors
 * pro-motion/packages/events-server — twenty lines vendored rather than a
 * dependency across two repositories that deploy separately.
 */
export type ServerEvent = Readonly<{
  event: string;
  /** Who acted. Salted and hashed by the collector; never stored in the clear. */
  actor?: string;
  props?: Readonly<Record<string, string>>;
  metrics?: Readonly<Record<string, number>>;
}>;

const PROJECT = 'liguria-bot';

export const wire = (event: ServerEvent): Readonly<Record<string, unknown>> => ({
  p: PROJECT,
  e: event.event,
  u: `server://${PROJECT}/${event.event}`,
  r: '',
  w: 0,
  l: '',
  s: '',
  a: event.actor ?? '',
  x: { ...(event.props ?? {}), channel: 'telegram' },
  m: event.metrics ?? {},
});
