/** Minimal structural fetch type — the global `fetch` satisfies it, and test
 *  doubles can implement it without the full RequestInfo surface. */
export type FetchFn = (
  input: string,
  init?: Readonly<{
    method?: string;
    headers?: Readonly<Record<string, string>>;
    /** FormData because one call — setChatPhoto — takes an upload rather than
     *  a URL, and it has to go through the same injectable fetch as the rest. */
    body?: string | FormData;
    signal?: AbortSignal;
  }>,
) => Promise<Response>;
