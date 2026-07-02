/**
 * mentelocale.it collector (design §4.2). Verified markup (2026-07-02):
 *
 *   <div class="ElencoEventi">
 *     <div class="Evento WithButton">
 *       <a href="/genova/126887-....htm">
 *         <span class="Testi">
 *           <span class="Titolo"> La città delle sette isole …</span>
 *           <span class="Date">Dal 09/07/2026 al 12/07/2026</span>
 *
 * Cards carry no category labels — the LLM categorizes during enrichment.
 * The agenda page covers the next 15 days; one fetch per run.
 */
import type { RawEvent } from '../domain/event.ts';
import { decodeEntities, parseDateRange } from './italian-dates.ts';
import type { CollectOutcome, Collector, FetchFn } from './types.ts';

export const MENTELOCALE_SOURCE = 'mentelocale';
const BASE_URL = 'https://www.mentelocale.it';
const LISTING_URL = `${BASE_URL}/genova/eventi/`;
const USER_AGENT = 'Mozilla/5.0 (compatible; event-collecter/0.0)';

type Draft = { href: string; title: string; date: string };

export const parseMentelocaleHtml = async (html: string): Promise<readonly RawEvent[]> => {
  const drafts: Draft[] = [];
  const current = (): Draft | undefined => drafts.at(-1);
  const rewriter = new HTMLRewriter()
    .on('div.Evento', {
      element: () => {
        drafts.push({ href: '', title: '', date: '' });
      },
    })
    .on('div.Evento > a', {
      element: (element) => {
        const draft = current();
        const href = element.getAttribute('href');
        // The card has two anchors (detail + ticket shop); the first,
        // site-relative one is the detail link.
        if (draft !== undefined && draft.href === '' && href !== null && href.startsWith('/')) {
          draft.href = href;
        }
      },
    })
    .on('div.Evento span.Titolo', {
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
    });
  await rewriter.transform(new Response(html)).arrayBuffer();

  return drafts.flatMap((draft): readonly RawEvent[] => {
    const range = parseDateRange(draft.date);
    const title = decodeEntities(draft.title);
    if (range === undefined || title === '' || draft.href === '') return [];
    return [
      {
        title,
        startDate: range.startDate,
        url: new URL(draft.href, BASE_URL).toString(),
        source: MENTELOCALE_SOURCE,
        ...(range.endDate === undefined ? {} : { endDate: range.endDate }),
      },
    ];
  });
};

export const makeMentelocaleCollector =
  (fetchFn: FetchFn): Collector =>
  async (): Promise<CollectOutcome> => {
    try {
      const response = await fetchFn(LISTING_URL, {
        headers: { 'user-agent': USER_AGENT },
      });
      if (!response.ok) {
        return { source: MENTELOCALE_SOURCE, events: [], posts: [], failed: true };
      }
      const events = await parseMentelocaleHtml(await response.text());
      return { source: MENTELOCALE_SOURCE, events, posts: [], failed: false };
    } catch {
      return { source: MENTELOCALE_SOURCE, events: [], posts: [], failed: true };
    }
  };
