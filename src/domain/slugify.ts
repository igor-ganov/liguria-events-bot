/**
 * A readable, ASCII, hyphenated form of a name.
 *
 * The site owns this rule — liguria-events-site/src/lib/slugify.ts — and it is
 * repeated here because everything this worker publishes is a link: the channel
 * post, the digest, the IndexNow submission. Two kinds of URL need it, the
 * event slug that appends an id for uniqueness and the venue path that is
 * already unique by its position under a city.
 */
export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'x';
