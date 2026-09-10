import type { CompactEvent } from '../domain/event.ts';

/**
 * One line of the archive: what an address is built from.
 *
 * The whole archive is a single KV value that only ever grows, so it carries
 * the title, the venue and the dates that spell a URL — and not the
 * descriptions, which are three languages of prose per event and would fill it
 * within a season.
 */
export type ArchiveEntry = Readonly<{
  id: string;
  t: string;
  v?: string;
  s: string;
  e?: string;
  /** The town, so the site can tell one town's patron feast from another's
   *  when it looks for other editions of the same event. */
  ct?: string;
  cr?: number;
}>;

export const archiveEntry = (event: CompactEvent): ArchiveEntry => ({
  id: event.id,
  t: event.t,
  ...(event.v === undefined ? {} : { v: event.v }),
  s: event.s,
  ...(event.e === undefined ? {} : { e: event.e }),
  ...(event.ct === undefined ? {} : { ct: event.ct }),
  ...(event.cr === undefined ? {} : { cr: event.cr }),
});

/**
 * What the archive holds after a run: everything it held, plus what left the
 * feed today, each event once and the newest sighting winning — a title
 * corrected on the way out is the one the address should use.
 */
export const mergedArchive = (
  held: readonly ArchiveEntry[],
  pruned: readonly CompactEvent[],
): readonly ArchiveEntry[] => {
  const byId = new Map(held.map((entry) => [entry.id, entry]));
  for (const event of pruned) byId.set(event.id, archiveEntry(event));
  return [...byId.values()];
};
