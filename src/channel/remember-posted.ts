/** The channel's memory, capped: a growing key is a KV value that one day
 *  stops being writable. Oldest ids fall off the front. */
export const rememberPosted = (
  posted: readonly string[],
  id: string,
  limit: number,
): readonly string[] =>
  posted.includes(id) ? posted : [...posted, id].slice(-limit);
