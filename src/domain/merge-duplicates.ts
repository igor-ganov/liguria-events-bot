/**
 * Merge two records the LLM confirmed as the same event (AC-1.9). The
 * earlier-collected record stays primary (its id/links are already out in
 * chats and calendars); the newer one fills gaps and donates its links.
 */
import type { Category, EventRecord, SourceLink } from './event.ts';

const unionCategories = (
  a: readonly Category[],
  b: readonly Category[],
): readonly Category[] => [...new Set([...a, ...b])].slice(0, 3);

const unionLinks = (primary: EventRecord, secondary: EventRecord): readonly SourceLink[] => {
  const all = [
    ...(primary.altLinks ?? []),
    { source: secondary.source, url: secondary.url },
    ...(secondary.altLinks ?? []),
  ];
  const seen = new Set([primary.url]);
  return all.filter((link) => {
    const fresh = !seen.has(link.url);
    seen.add(link.url);
    return fresh;
  });
};

export const orderByAge = (
  a: EventRecord,
  b: EventRecord,
): Readonly<{ primary: EventRecord; secondary: EventRecord }> =>
  a.addedAt <= b.addedAt ? { primary: a, secondary: b } : { primary: b, secondary: a };

export const mergeDuplicates = (a: EventRecord, b: EventRecord): EventRecord => {
  const { primary, secondary } = orderByAge(a, b);
  const altLinks = unionLinks(primary, secondary);
  return {
    ...primary,
    categories: unionCategories(primary.categories, secondary.categories),
    ...(primary.titles === undefined && secondary.titles !== undefined
      ? { titles: secondary.titles }
      : {}),
    ...(primary.endDate === undefined && secondary.endDate !== undefined
      ? { endDate: secondary.endDate }
      : {}),
    ...(primary.time === undefined && secondary.time !== undefined
      ? { time: secondary.time }
      : {}),
    ...(primary.venue === undefined && secondary.venue !== undefined
      ? { venue: secondary.venue }
      : {}),
    ...(primary.address === undefined && secondary.address !== undefined
      ? { address: secondary.address }
      : {}),
    ...(primary.priceInfo === undefined && secondary.priceInfo !== undefined
      ? { priceInfo: secondary.priceInfo }
      : {}),
    ...(primary.rawDescription === undefined && secondary.rawDescription !== undefined
      ? { rawDescription: secondary.rawDescription }
      : {}),
    ...(primary.image === undefined && secondary.image !== undefined
      ? { image: secondary.image }
      : {}),
    ...(altLinks.length === 0 ? {} : { altLinks }),
    ...(primary.free === true || secondary.free === true ? { free: true } : {}),
    ...(primary.unusual === true || secondary.unusual === true ? { unusual: true } : {}),
  };
};
