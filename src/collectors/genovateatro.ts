/**
 * genovateatro.it collector (design §4.3). Federated theatre agenda — the
 * same CMS family as mentelocale. Verified markup (2026-07-02):
 *
 *   <div class="ElencoEventi">
 *     <div class="Evento">
 *       <a href="/eventi/2025-2026/teatrodellatosse/gothica.htm">
 *         <span class="Titles">
 *           <span class="Title">Gothica</span>
 *           <span class="SubTitle">spettacolo immersivo al Parco …</span>
 *         </span>
 *         <span class="Abstract">Un'esperienza immersiva …</span>
 *         <span class="Date">Dal 02/07/2026 al 26/07/2026</span>
 *
 * Everything here is theatre → static `categoryHint: 'theatre'`.
 */
import type { RawEvent } from '../domain/event.ts';
import { decodeEntities, parseDateRange } from './italian-dates.ts';
import type { CollectOutcome, Collector, FetchFn } from './types.ts';

export const GENOVATEATRO_SOURCE = 'genovateatro';
const BASE_URL = 'https://www.genovateatro.it';
const LISTING_URL = `${BASE_URL}/eventi/`;
const USER_AGENT = 'Mozilla/5.0 (compatible; event-collecter/0.0)';

type Draft = { href: string; title: string; date: string; abstract: string };

export const parseGenovateatroHtml = async (html: string): Promise<readonly RawEvent[]> => {
  const drafts: Draft[] = [];
  const current = (): Draft | undefined => drafts.at(-1);
  const rewriter = new HTMLRewriter()
    .on('div.Evento', {
      element: () => {
        drafts.push({ href: '', title: '', date: '', abstract: '' });
      },
    })
    .on('div.Evento > a', {
      element: (element) => {
        const draft = current();
        const href = element.getAttribute('href');
        if (draft !== undefined && draft.href === '' && href !== null && href.startsWith('/')) {
          draft.href = href;
        }
      },
    })
    .on('div.Evento span.Title', {
      text: (chunk) => {
        const draft = current();
        if (draft !== undefined) draft.title += chunk.text;
      },
    })
    .on('div.Evento span.Date', {
      text: (chunk) => {
        const draft = current();
        if (draft !== undefined) draft.date += chunk.text;
      },
    })
    .on('div.Evento span.Abstract', {
      text: (chunk) => {
        const draft = current();
        if (draft !== undefined && draft.abstract.length < 600) draft.abstract += chunk.text;
      },
    });
  await rewriter.transform(new Response(html)).arrayBuffer();

  return drafts.flatMap((draft): readonly RawEvent[] => {
    const range = parseDateRange(draft.date);
    const title = decodeEntities(draft.title);
    if (range === undefined || title === '' || draft.href === '') return [];
    const abstract = decodeEntities(draft.abstract);
    return [
      {
        title,
        startDate: range.startDate,
        url: new URL(draft.href, BASE_URL).toString(),
        source: GENOVATEATRO_SOURCE,
        categoryHint: 'theatre',
        ...(range.endDate === undefined ? {} : { endDate: range.endDate }),
        ...(abstract === '' ? {} : { rawDescription: abstract }),
      },
    ];
  });
};

export const makeGenovateatroCollector =
  (fetchFn: FetchFn): Collector =>
  async (): Promise<CollectOutcome> => {
    try {
      const response = await fetchFn(LISTING_URL, {
        headers: { 'user-agent': USER_AGENT },
      });
      if (!response.ok) {
        return { source: GENOVATEATRO_SOURCE, events: [], posts: [], failed: true };
      }
      const events = await parseGenovateatroHtml(await response.text());
      return { source: GENOVATEATRO_SOURCE, events, posts: [], failed: false };
    } catch {
      return { source: GENOVATEATRO_SOURCE, events: [], posts: [], failed: true };
    }
  };
