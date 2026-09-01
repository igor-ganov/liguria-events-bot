import type { CompactEvent } from './event.ts';

/**
 * An event's address on the site, in the words people would use for it: the
 * name, who is putting it on, the day, and the id.
 *
 * The site owns this rule — liguria-events-site/src/lib/events/event-slug.ts —
 * and it is repeated here because everything this worker publishes is a link:
 * the channel post, the digest, the IndexNow ping. Announcing an address that
 * merely redirects is the whole point of the exercise wasted, so the two must
 * agree. `canonicalAddressCheck` in the health suite fails loudly if they drift.
 */
const TITLE = 56;
const HOST = 28;

const slugify = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'x';

const capped = (value: string, max: number): string => slugify(value).slice(0, max).replace(/-+$/, '');

export const eventSlug = (event: Pick<CompactEvent, 'id' | 't' | 's' | 'v'>): string =>
  [
    capped(event.t, TITLE),
    ...[event.v ?? ''].filter((venue) => venue !== '').map((venue) => capped(venue, HOST)),
    capped(event.s, 10),
    event.id,
  ]
    .filter((part) => part !== '')
    .join('-');
