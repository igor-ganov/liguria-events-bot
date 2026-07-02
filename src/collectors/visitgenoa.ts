/**
 * visitgenoa.it collector (design §4.1). Verified markup (2026-07-02):
 *
 *   <div class="grid-item …">
 *     <a href="/en/node/26286">
 *       <div class="title_classic"><h4>
 *         <span class="fs-14">01/02/2026 - 31/12/2026<br></span>
 *         Ventennale del sito UNESCO …
 *       </h4></div>
 *     </a>
 *     <div class="category_event">CULTURA, EVENTI TOP</div>
 *   </div>
 *
 * HTMLRewriter handlers only accumulate strings; every interpretation step is
 * a pure, fixture-tested function (AC-8.5).
 */
import type { Category, RawEvent } from '../domain/event.ts';
import { DATE_RANGE, decodeEntities, parseDateRange } from './italian-dates.ts';
import type { CollectOutcome, Collector, FetchFn } from './types.ts';

export { decodeEntities, parseDateRange } from './italian-dates.ts';

export const VISITGENOA_SOURCE = 'visitgenoa';
const BASE_URL = 'https://www.visitgenoa.it';
const LISTING_URL = (page: number): string => `${BASE_URL}/en/events?page=${page}`;
const USER_AGENT = 'Mozilla/5.0 (compatible; event-collecter/0.0)';
const DETAIL_FETCH_CAP = 10;

// ────────────────────────────────────────────────────────── pure parsing ──

/** Italian source labels → taxonomy hint. Specific labels beat generic ones;
 *  the LLM confirms or overrides during enrichment (AC-2.1). */
const CATEGORY_HINTS: readonly (readonly [RegExp, Category])[] = [
  [/MOSTR/i, 'art'],
  [/MUSICA/i, 'music'],
  [/CONCERT/i, 'music'],
  [/TEATR|SPETTACOL/i, 'theatre'],
  [/BAMBIN|FAMIGLI/i, 'family'],
  [/SPORT/i, 'sport'],
  [/SAGR|GASTRONOM|FOOD/i, 'food'],
  [/FIER|MERCAT/i, 'market'],
  [/LABORATOR|WORKSHOP|CORS/i, 'workshop'],
  [/TOUR|VISIT|PASSEGGIAT/i, 'culture'],
  [/CULTURA|LIBR|INCONTRI|RASSEGN|CONGRESS/i, 'culture'],
];

export const mapCategoryHint = (labels: string): Category | undefined =>
  CATEGORY_HINTS.find(([pattern]) => pattern.test(labels))?.[1];

/** The card's h4 text = date range + title in one blob; strip the range. */
export const stripLeadingDateRange = (heading: string): string =>
  decodeEntities(heading.replace(DATE_RANGE, ' '));

type ListingDraft = { href: string; heading: string; categories: string; img: string };

export const parseListingHtml = async (html: string): Promise<readonly RawEvent[]> => {
  const drafts: ListingDraft[] = [];
  const current = (): ListingDraft | undefined => drafts.at(-1);
  const rewriter = new HTMLRewriter()
    .on('div.grid-item', {
      element: () => {
        drafts.push({ href: '', heading: '', categories: '', img: '' });
      },
    })
    .on('div.grid-item > a', {
      element: (element) => {
        const draft = current();
        const href = element.getAttribute('href');
        if (draft !== undefined && draft.href === '' && href !== null) draft.href = href;
      },
    })
    .on('div.grid-item img', {
      element: (element) => {
        const draft = current();
        const src = element.getAttribute('src');
        if (draft !== undefined && draft.img === '' && src !== null) draft.img = src;
      },
    })
    .on('div.grid-item h4', {
      text: (chunk) => {
        const draft = current();
        if (draft !== undefined) draft.heading += chunk.text;
      },
    })
    .on('div.grid-item div.category_event', {
      text: (chunk) => {
        const draft = current();
        if (draft !== undefined) draft.categories += chunk.text;
      },
    });
  await rewriter.transform(new Response(html)).arrayBuffer();

  return drafts.flatMap((draft): readonly RawEvent[] => {
    const range = parseDateRange(draft.heading);
    const title = stripLeadingDateRange(draft.heading);
    if (range === undefined || title === '' || draft.href === '') return [];
    const hint = mapCategoryHint(draft.categories);
    return [
      {
        title,
        startDate: range.startDate,
        url: new URL(draft.href, BASE_URL).toString(),
        source: VISITGENOA_SOURCE,
        ...(range.endDate === undefined ? {} : { endDate: range.endDate }),
        ...(hint === undefined ? {} : { categoryHint: hint }),
        ...(draft.img === '' ? {} : { image: new URL(draft.img, BASE_URL).toString() }),
      },
    ];
  });
};

// ─────────────────────────────────────────────────────────── detail page ──

export type DetailFields = Readonly<{
  venue?: string;
  time?: string;
  priceInfo?: string;
  rawDescription?: string;
}>;

const TIME_PATTERN = /\bore\s+([01]?\d|2[0-3])[:.]([0-5]\d)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b/;
const PRICE_PATTERN =
  /(bigliett[oi][^.]{0,80}€\s?\d+[.,]?\d*|€\s?\d+[.,]?\d*|ingresso\s+(?:libero|gratuito)|gratuito|free\s+(?:entry|admission))/i;

export const parseDetailHtml = async (html: string): Promise<DetailFields> => {
  let venue = '';
  let body = '';
  let collecting = false;
  let venueAnchors = 0;
  const collectText = (chunk: Readonly<{ text: string }>): void => {
    if (collecting && body.length < 6000) body += chunk.text;
  };
  const rewriter = new HTMLRewriter()
    .on('h2.title', {
      element: () => {
        collecting = true;
      },
    })
    .on('p', { text: collectText })
    .on('li', { text: collectText })
    .on('div.mappa a', {
      element: () => {
        venueAnchors += 1;
      },
      // The sidebar has several marker anchors (venue link + plain-text copy);
      // the first one is the linked venue name.
      text: (chunk) => {
        if (venueAnchors === 1) venue += chunk.text;
      },
    });
  await rewriter.transform(new Response(html)).arrayBuffer();

  const text = decodeEntities(body);
  const timeMatch = TIME_PATTERN.exec(text);
  const time =
    timeMatch === null
      ? undefined
      : `${(timeMatch[1] ?? timeMatch[3] ?? '').padStart(2, '0')}:${timeMatch[2] ?? timeMatch[4] ?? '00'}`;
  const priceMatch = PRICE_PATTERN.exec(text);
  const priceInfo = priceMatch?.[0]?.trim();
  const venueText = decodeEntities(venue);
  const rawDescription = text.slice(0, 600).trim();
  return {
    ...(venueText === '' ? {} : { venue: venueText }),
    ...(time === undefined ? {} : { time }),
    ...(priceInfo === undefined ? {} : { priceInfo }),
    ...(rawDescription === '' ? {} : { rawDescription }),
  };
};

// ─────────────────────────────────────────────────────────────── fetching ──

const fetchHtml = async (fetchFn: FetchFn, url: string): Promise<string | undefined> => {
  try {
    const response = await fetchFn(url, { headers: { 'user-agent': USER_AGENT } });
    if (!response.ok) return undefined;
    return await response.text();
  } catch {
    return undefined;
  }
};

export const makeVisitgenoaCollector =
  (fetchFn: FetchFn, pages: number): Collector =>
  async (): Promise<CollectOutcome> => {
    const results = await Promise.all(
      Array.from({ length: Math.max(1, pages) }, async (_, page) => {
        const html = await fetchHtml(fetchFn, LISTING_URL(page));
        return html === undefined ? undefined : parseListingHtml(html);
      }),
    );
    const succeeded = results.flatMap((events) => (events === undefined ? [] : [events]));
    const events = (await Promise.all(succeeded)).flat();
    return {
      source: VISITGENOA_SOURCE,
      events,
      posts: [],
      failed: succeeded.length === 0,
    };
  };

/**
 * Fill venue/time/price/description for events new to the index by fetching
 * their detail pages — bounded per run (design §4.1). Applies the free flag
 * from the discovered price info.
 */
export const makeDetailFetcher =
  (fetchFn: FetchFn) =>
  async (events: readonly RawEvent[]): Promise<readonly RawEvent[]> => {
    let budget = DETAIL_FETCH_CAP;
    return Promise.all(
      events.map(async (event) => {
        if (event.source !== VISITGENOA_SOURCE || budget <= 0) return event;
        budget -= 1;
        const html = await fetchHtml(fetchFn, event.url);
        if (html === undefined) return event;
        const details = await parseDetailHtml(html);
        return { ...details, ...event };
      }),
    );
  };
