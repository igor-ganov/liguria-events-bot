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

// ─────────────────────────────────────────────────────────── detail page ──

export type MentelocaleDetail = Readonly<{
  venue?: string;
  time?: string;
  priceInfo?: string;
  rawDescription?: string;
}>;

// The listing card carries only a title + date. The real body — venue, start
// time, programme, price — lives in the article's <div class="Testo">, with the
// facts wrapped in <strong>/<em>, so a plain <p> text handler misses them; a
// scoped universal text collector captures the whole subtree instead.
// "alle 21", "ore 21", "h 18:30", "alle 20:45", "21.30": hour, optional minutes.
const ML_TIME_PATTERN =
  /\b(?:alle|ore|h)\s+(?:ore\s+|le\s+)?([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\b|\b([01]?\d|2[0-3]):([0-5]\d)\b/i;
const ML_PRICE_PATTERN =
  /(bigliett[oi][^.]{0,80}€\s?\d+[.,]?\d*|€\s?\d+[.,]?\d*|ingresso\s+(?:libero|gratuito|a\s+offerta\s+libera)|offerta\s+libera|gratuito|free\s+(?:entry|admission))/i;

export const parseMentelocaleDetail = async (html: string): Promise<MentelocaleDetail> => {
  let body = '';
  let collecting = false;
  let inScript = false;
  const rewriter = new HTMLRewriter()
    .on('div.Testo', {
      element: (element) => {
        collecting = true;
        element.onEndTag(() => {
          collecting = false;
        });
      },
    })
    .on('script, style', {
      element: (element) => {
        inScript = true;
        element.onEndTag(() => {
          inScript = false;
        });
      },
    })
    .on('*', {
      text: (chunk) => {
        if (collecting && !inScript && body.length < 6000) body += chunk.text;
      },
    });
  await rewriter.transform(new Response(html)).arrayBuffer();

  const text = decodeEntities(body).replace(/\s+/g, ' ').trim();
  const timeMatch = ML_TIME_PATTERN.exec(text) ?? undefined;
  const time =
    timeMatch === undefined
      ? undefined
      : `${(timeMatch[1] ?? timeMatch[3] ?? '').padStart(2, '0')}:${timeMatch[2] ?? timeMatch[4] ?? '00'}`;
  const priceInfo = ML_PRICE_PATTERN.exec(text)?.[0]?.trim();
  const rawDescription = text.slice(0, 4000);
  return {
    ...(time === undefined ? {} : { time }),
    ...(priceInfo === undefined ? {} : { priceInfo }),
    ...(rawDescription === '' ? {} : { rawDescription }),
  };
};

const fetchDetailHtml = async (fetchFn: FetchFn, url: string): Promise<string | undefined> => {
  try {
    const response = await fetchFn(url, { headers: { 'user-agent': USER_AGENT } });
    if (!response.ok) return undefined;
    return await response.text();
  } catch {
    return undefined;
  }
};

// Matches the pipeline's ENRICH_PER_RUN so every record about to be re-enriched
// has had its detail page attempted first (never enriched from a bare title
// while its body was still unfetched). The whole mentelocale corpus was
// collected listing-only, so there is a large backlog to heal.
const DETAIL_FETCH_CAP = 24;

/**
 * Fill venue/time/price/description for mentelocale events by fetching their
 * detail pages — the listing carries only a title, so without this the LLM has
 * nothing to describe and falls back to filler. Only touches mentelocale events
 * (others pass through untouched) and is bounded per run.
 */
export const makeMentelocaleDetailFetcher =
  (fetchFn: FetchFn) =>
  async (events: readonly RawEvent[]): Promise<readonly RawEvent[]> => {
    let budget = DETAIL_FETCH_CAP;
    return Promise.all(
      events.map(async (event) => {
        if (event.source !== MENTELOCALE_SOURCE || event.rawDescription !== undefined || budget <= 0) {
          return event;
        }
        budget -= 1;
        const html = await fetchDetailHtml(fetchFn, event.url);
        if (html === undefined) return event;
        const detail = await parseMentelocaleDetail(html);
        // Existing event fields win; the fetched detail only fills the gaps.
        return { ...detail, ...event };
      }),
    );
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
