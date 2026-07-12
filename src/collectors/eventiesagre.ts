/**
 * eventiesagre.it — the national aggregator (design §4.7). It is the only
 * source that reaches every Italian region, and it hands us the one thing the
 * city dimension needs: each card names its comune with the province code,
 * "Borgo San Lorenzo (FI)", which files the event under Firenze.
 *
 * Verified markup (2026-07-12):
 *
 *   <div class="risultatoEvento">
 *     <a href="/Eventi_Sagre/21104872_Sagra-....html" >
 *       <img src="/eventi/21104872/thumb/....jpg">
 *       <h3 class="titolo">Sagra Del Cinghiale ...</h3>
 *       <div><b>Dal</b> 10/07/2026 <b>Al</b> 12/07/2026</div>
 *       <span class="grassetto">Toscana</span>
 *       <span class="corsivo">Borgo San Lorenzo (FI)</span>
 *
 * The search answers with a dozen cards and has no pagination. It has a SECTION
 * axis, and sweeping it does surface many more events — but they are the
 * ARCHIVE: 19 sections x 3 date windows over Toscana returned 27 upcoming
 * events, where the sections alone returned 157, nearly all of them past. So we
 * walk the axis that pays: region x date window.
 *
 *   /cerca/Eventi/sez/<dd-mm-yyyy>_<dd-mm-yyyy>/<Regione>/prov/cit/rilib
 */
import type { RawEvent } from '../domain/event.ts';
import { cityOfProvince } from '../domain/city.ts';
import { decodeEntities } from './italian-dates.ts';
import type { CollectOutcome, Collector, FetchFn } from './types.ts';

export const EVENTIESAGRE_SOURCE = 'eventiesagre';
const BASE_URL = 'https://www.eventiesagre.it';
const USER_AGENT = 'Mozilla/5.0 (compatible; event-collecter/0.0)';

export const REGIONS: readonly string[] = [
  'Abruzzo', 'Basilicata', 'Calabria', 'Campania', 'Emilia Romagna',
  'Friuli Venezia Giulia', 'Lazio', 'Liguria', 'Lombardia', 'Marche', 'Molise',
  'Piemonte', 'Puglia', 'Sardegna', 'Sicilia', 'Toscana', 'Trentino Alto Adige',
  'Umbria', "Valle d'Aosta", 'Veneto',
];

/** Politeness, and self-preservation: firing every query at once at one small
 *  site is abuse and would get us blocked. */
const CONCURRENCY = 6;

/** How far ahead to look, in windows. Each query answers with about a dozen
 *  events, so the horizon is cut into chunks rather than asked for at once. */
const WINDOW_DAYS = 30;
const WINDOWS = 4;

const itDate = (date: Date): string =>
  [date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCFullYear()]
    .map((part, index) => (index === 2 ? String(part) : String(part).padStart(2, '0')))
    .join('-');

const windowsFrom = (todayMs: number): readonly string[] =>
  Array.from({ length: WINDOWS }, (_, index) => {
    const from = new Date(todayMs + index * WINDOW_DAYS * 86_400_000);
    const to = new Date(todayMs + ((index + 1) * WINDOW_DAYS - 1) * 86_400_000);
    return `${itDate(from)}_${itDate(to)}`;
  });

const searchUrl = (region: string, window: string): string =>
  `${BASE_URL}/cerca/Eventi/sez/${window}/${encodeURIComponent(region)}/prov/cit/rilib`;

/** "10/07/2026" → "2026-07-10". */
const isoDate = (value: string): string | undefined => {
  const match = value.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return match === null ? undefined : `${match[3]}-${match[2]}-${match[1]}`;
};

type Draft = { href: string; title: string; img: string; text: string; place: string };

export const parseEventiesagreHtml = async (html: string): Promise<readonly RawEvent[]> => {
  const drafts: Draft[] = [];
  const current = (): Draft | undefined => drafts.at(-1);
  const rewriter = new HTMLRewriter()
    .on('div.risultatoEvento', {
      element: () => {
        drafts.push({ href: '', title: '', img: '', text: '', place: '' });
      },
    })
    .on('div.risultatoEvento a', {
      element: (element) => {
        const draft = current();
        const href = element.getAttribute('href');
        if (draft !== undefined && draft.href === '' && href !== null) draft.href = href;
      },
    })
    .on('div.risultatoEvento img', {
      element: (element) => {
        const draft = current();
        const src = element.getAttribute('src');
        if (draft !== undefined && draft.img === '' && src !== null) draft.img = src;
      },
    })
    .on('div.risultatoEvento h3.titolo', {
      text: (chunk) => {
        const draft = current();
        if (draft !== undefined && draft.title.length < 200) draft.title += chunk.text;
      },
    })
    // Dates arrive as loose text ("<b>Dal</b> 10/07/2026 <b>Al</b> 12/07/2026"),
    // so one buffer and a regex beat a brittle selector.
    .on('div.risultatoEvento div', {
      text: (chunk) => {
        const draft = current();
        if (draft !== undefined && draft.text.length < 300) draft.text += `${chunk.text} `;
      },
    })
    // The comune and its province code have a span of their own: "Lovere (BG)".
    .on('div.risultatoEvento span.corsivo', {
      text: (chunk) => {
        const draft = current();
        if (draft !== undefined && draft.place.length < 80) draft.place += chunk.text;
      },
    });
  await rewriter.transform(new Response(html)).arrayBuffer();

  return drafts.flatMap((draft): readonly RawEvent[] => {
    const dates = draft.text.match(/\d{2}\/\d{2}\/\d{4}/g) ?? [];
    const startDate = isoDate(dates[0] ?? '');
    const endDate = isoDate(dates[1] ?? '');
    const place = decodeEntities(draft.place).match(/^\s*(.{2,60}?)\s*\(([A-Z]{2})\)/);
    const city = cityOfProvince(place?.[2] ?? '');
    const title = decodeEntities(draft.title).trim();
    if (startDate === undefined || title === '' || draft.href === '' || city === undefined) {
      return [];
    }
    return [
      {
        title,
        startDate,
        url: new URL(draft.href, BASE_URL).toString(),
        source: EVENTIESAGRE_SOURCE,
        city: city.slug,
        ...(endDate === undefined || endDate < startDate ? {} : { endDate }),
        ...(place?.[1] === undefined ? {} : { venue: place[1].trim() }),
        ...(draft.img === '' ? {} : { image: new URL(draft.img, BASE_URL).toString() }),
      },
    ];
  });
};

const fetchSearch = async (
  fetchFn: FetchFn,
  region: string,
  window: string,
): Promise<readonly RawEvent[]> => {
  try {
    const response = await fetchFn(searchUrl(region, window), {
      headers: { 'user-agent': USER_AGENT },
    });
    return response.ok ? await parseEventiesagreHtml(await response.text()) : [];
  } catch {
    return [];
  }
};

/** One collector for the whole country: region x date window, six at a time. */
export const makeEventiesagreCollector =
  (fetchFn: FetchFn, now: () => number): Collector =>
  async (): Promise<CollectOutcome> => {
    const queries = REGIONS.flatMap((region) =>
      windowsFrom(now()).map((window) => ({ region, window })),
    );
    const events: RawEvent[] = [];
    for (let i = 0; i < queries.length; i += CONCURRENCY) {
      const batch = await Promise.all(
        queries
          .slice(i, i + CONCURRENCY)
          .map(({ region, window }) => fetchSearch(fetchFn, region, window)),
      );
      events.push(...batch.flat());
    }
    return {
      source: EVENTIESAGRE_SOURCE,
      events,
      posts: [],
      failed: events.length === 0,
    };
  };
