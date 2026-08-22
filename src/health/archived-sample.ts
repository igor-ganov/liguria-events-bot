import type { CompactEvent } from '../domain/event.ts';
import type { KvLike } from '../pipeline/store.ts';

/**
 * An id that has left the index but is still archived — exactly the case the
 * past-event page exists to serve, and therefore the one worth probing.
 *
 * One list page is enough: we need any such id, not all of them.
 */
export const archivedSample = async (
  kv: KvLike,
  index: readonly CompactEvent[],
): Promise<string | undefined> => {
  const live = new Set(index.map((event) => event.id));
  const page = await kv.list({ prefix: 'archive:' });
  return page.keys
    .map((key) => key.name.slice('archive:'.length))
    .filter((id) => !live.has(id))
    .at(0);
};
