/**
 * A page of the site in English.
 *
 * English carries a prefix like the other two languages since the site evened
 * them out; the addresses it used to own answer a 301 now. A check that asks
 * for the old spelling measures the redirect rather than the page — and the
 * three that did were reported as "answered 0", because an address that
 * redirects into a loop never answers at all.
 *
 * Takes the path without its leading slash: `enPage('liguria/genova/')`.
 */
export const enPage = (path: string): string => `/en/${path}`;
