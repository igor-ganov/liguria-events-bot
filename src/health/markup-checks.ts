import { fetchStatus, fetchText } from './fetch-text.ts';
import type { CheckResult } from './types.ts';
import type { FetchFn } from '../collectors/types.ts';

const jsonLdOf = (html: string): Record<string, unknown> => {
  const raw = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '{}';
  try {
    return JSON.parse(raw.replace(/\\u003c/g, '<'));
  } catch {
    return {};
  }
};

const REQUIRED = ['name', 'startDate', 'location', 'offers', 'eventStatus', 'eventAttendanceMode'];

/**
 * The Event document on a live page still carries what Google requires. This
 * has been wrong twice: `location` was dropped whenever an event had neither
 * venue nor street, and the start time never reached the markup at all.
 */
export const eventMarkupCheck = async (
  fetchFn: FetchFn,
  origin: string,
  eventId: string,
): Promise<CheckResult> => {
  const id = 'event-jsonld';
  const title = 'An event page carries the markup Google needs to show it';
  const { status, body } = await fetchText(fetchFn, `${origin}/event/${eventId}/`);
  if (status !== 200) return { id, title, status: 'fail', detail: `the sample event answered ${status}` };
  const json = jsonLdOf(body);
  const missing = REQUIRED.filter((field) => json[field] === undefined);
  const address = Object(Object(json['location'])['address'])['addressCountry'];
  if (missing.length > 0) return { id, title, status: 'fail', detail: `missing ${missing.join(', ')}` };
  if (address === undefined) return { id, title, status: 'fail', detail: 'location carries no postal address' };
  return { id, title, status: 'ok', detail: `complete on ${eventId}` };
};

/**
 * Every language version a page advertises actually exists. We once published
 * hreflang for /it/terms/ and /ru/privacy/, which had never been built — broken
 * URLs handed to Google in our own markup.
 */
export const hreflangCheck = async (
  fetchFn: FetchFn,
  origin: string,
  paths: readonly string[],
): Promise<CheckResult> => {
  const id = 'hreflang';
  const title = 'Every language version we advertise exists';
  const pages = await Promise.all(paths.map((path) => fetchText(fetchFn, `${origin}${path}`)));
  const links = pages.flatMap((page) =>
    [...page.body.matchAll(/<link rel="alternate" hreflang="[^"]+" href="([^"]+)"/g)].map((m) => m[1] ?? ''),
  );
  const unique = [...new Set(links)];
  const codes = await Promise.all(unique.map((href) => fetchStatus(fetchFn, href)));
  const broken = unique.filter((_, i) => codes[i] !== 200);
  return broken.length === 0
    ? { id, title, status: 'ok', detail: `${unique.length} alternates, all answering` }
    : { id, title, status: 'fail', detail: `${broken.length} broken: ${broken.slice(0, 3).join(', ')}` };
};
