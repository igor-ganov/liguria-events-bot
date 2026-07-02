/** In-memory KvLike double shared by the pipeline tests (T4). */
import type { KvLike, KvListResult } from '../src/pipeline/store.ts';

export type KvStub = KvLike &
  Readonly<{
    /** Raw view for assertions. */
    data: Map<string, string>;
    /** TTLs recorded per put (seconds), for TTL assertions. */
    ttls: Map<string, number | undefined>;
  }>;

export const makeKvStub = (): KvStub => {
  const data = new Map<string, string>();
  const ttls = new Map<string, number | undefined>();
  return {
    data,
    ttls,
    get: async (key) => data.get(key) ?? null,
    put: async (key, value, options) => {
      data.set(key, value);
      ttls.set(key, options?.expirationTtl);
    },
    delete: async (key) => {
      data.delete(key);
      ttls.delete(key);
    },
    list: async (options) => {
      const keys = [...data.keys()]
        .filter((key) => key.startsWith(options.prefix))
        .map((name) => ({ name }));
      const result: KvListResult = { keys, list_complete: true };
      return result;
    },
  };
};
