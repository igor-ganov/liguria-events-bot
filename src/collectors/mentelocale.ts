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
/** The only three cities mentelocale actually publishes an agenda for — every
 *  other Italian city redirects away. National coverage comes from
 *  eventiesagre instead. */
export const MENTELOCALE_CITIES: readonly string[] = ['genova', 'milano', 'torino'];
const listingUrl = (city: string): string => `${BASE_URL}/${city}/eventi/`;
const USER_AGENT = 'Mozilla/5.0 (compatible; event-collecter/0.0)';

type Draft = { href: string; title: string; date: string; img: string };

export const parseMentelocaleHtml = async (
  html: string,
  city: string,
): Promise<readonly RawEvent[]> => {
  const drafts: Draft[] = [];
  const current = (): Draft | undefined => drafts.at(-1);
  const rewriter = new HTMLRewriter()
    .on('div.Evento', {
      element: () => {
        drafts.push({ href: '', title: '', date: '', img: '' });
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
    .on('div.Evento img', {
      element: (element) => {
        const draft = current();
        const src = element.getAttribute('data-src') ?? element.getAttribute('src');
        if (draft !== undefined && draft.img === '' && src !== null) draft.img = src;
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
        city,
        ...(range.endDate === undefined ? {} : { endDate: range.endDate }),
        ...(draft.img === '' ? {} : { image: new URL(draft.img, BASE_URL).toString() }),
      },
    ];
  });
};

// The agenda is paginated 15-per-page ("Pagina 1 di 6"); reading only the first
// page dropped ~70 events — every sagra and out-of-town happening (Sori,
// Lavagna…) lives on the later pages.
const MAX_PAGES = 10;

/** Total pages from the "Pagina X di N" control, clamped. */
export const mentelocalePageCount = (html: string): number => {
  const match = html.match(/Pagina\s+\d+\s+di\s+(\d+)/i);
  const total = Number(match?.[1] ?? '1');
  return Math.min(Number.isFinite(total) && total > 0 ? total : 1, MAX_PAGES);
};

const pageUrl = (city: string, page: number): string =>
  page === 1 ? listingUrl(city) : `${listingUrl(city)}${page}/`;

export const makeMentelocaleCollector =
  (fetchFn: FetchFn, city: string): Collector =>
  async (): Promise<CollectOutcome> => {
    try {
      const first = await fetchFn(listingUrl(city), { headers: { 'user-agent': USER_AGENT } });
      if (!first.ok) {
        return { source: MENTELOCALE_SOURCE, events: [], posts: [], failed: true };
      }
      const firstHtml = await first.text();
      const pages = mentelocalePageCount(firstHtml);

      const rest = await Promise.all(
        Array.from({ length: pages - 1 }, (_, index) => index + 2).map(async (page) => {
          const response = await fetchFn(pageUrl(city, page), {
            headers: { 'user-agent': USER_AGENT },
          });
          if (!response.ok) return [];
          return parseMentelocaleHtml(await response.text(), city);
        }),
      );

      const events = [...(await parseMentelocaleHtml(firstHtml, city)), ...rest.flat()];
      return { source: MENTELOCALE_SOURCE, events, posts: [], failed: false };
    } catch {
      return { source: MENTELOCALE_SOURCE, events: [], posts: [], failed: true };
    }
  };
