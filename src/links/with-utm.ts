/** The three tags the collector reads, as `knowledge/practices/utm-conventions.md`
 *  defines them: lowercase, hyphenated, campaign prefixed with the month. */
export type Utm = Readonly<{ source: string; medium: string; campaign: string }>;

const tagged = (url: URL, utm: Utm): string => {
  url.searchParams.set('utm_source', utm.source);
  url.searchParams.set('utm_medium', utm.medium);
  url.searchParams.set('utm_campaign', utm.campaign);
  return url.toString();
};

const parsed = (link: string): readonly URL[] => {
  try {
    return [new URL(link)];
  } catch {
    return [];
  }
};

/**
 * A link that says which of our surfaces sent it.
 *
 * Without this the channel's posts and the morning notification arrive as
 * "direct" — a notification click carries no referrer at all, the service
 * worker opens it — and a channel that cannot be counted cannot be kept or
 * dropped on its numbers.
 *
 * A link that already carries a source keeps it: the first surface to send a
 * reader is the one that earned them, and re-tagging on the way through would
 * credit the last.
 */
export const withUtm = (link: string, utm: Utm): string =>
  parsed(link)
    .filter((url) => url.searchParams.get('utm_source') === null)
    .map((url) => tagged(url, utm))
    .at(0) ?? link;
