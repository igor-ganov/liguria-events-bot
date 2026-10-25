/** Bounded-concurrency map: at most `limit` calls in flight, results in input
 *  order. For network round trips that are too many to run one after another
 *  and too many to fire all at once. */
export const mapBounded =
  (limit: number) =>
  async <T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<readonly R[]> => {
    const out: R[] = [];
    for (let i = 0; i < items.length; i += limit) {
      out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
    }
    return out;
  };
