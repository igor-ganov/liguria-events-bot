/** Minimal structural fetch type — the global `fetch` satisfies it, and test
 *  doubles can implement it without the full RequestInfo surface. */
export type FetchFn = (
  input: string,
  init?: Readonly<{
    method?: string;
    headers?: Readonly<Record<string, string>>;
    body?: string;
    signal?: AbortSignal;
  }>,
) => Promise<Response>;
