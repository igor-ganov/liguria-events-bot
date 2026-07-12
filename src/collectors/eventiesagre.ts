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
 * The region search takes one page at a time:
 *   /cerca/Eventi/sez/mesi/<Regione>/prov/cit/rilib
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

const regionUrl = (region: string): string =>
  `${BASE_URL}/cerca/Eventi/sez/mesi/${encodeURIComponent(region)}/prov/cit/rilib`;

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

/** One collector per region — they run concurrently with every other source. */
export const makeEventiesagreCollector =
  (fetchFn: FetchFn, region: string): Collector =>
  async (): Promise<CollectOutcome> => {
    try {
      const response = await fetchFn(regionUrl(region), { headers: { 'user-agent': USER_AGENT } });
      if (!response.ok) {
        return { source: EVENTIESAGRE_SOURCE, events: [], posts: [], failed: true };
      }
      const events = await parseEventiesagreHtml(await response.text());
      return { source: EVENTIESAGRE_SOURCE, events, posts: [], failed: false };
    } catch {
      return { source: EVENTIESAGRE_SOURCE, events: [], posts: [], failed: true };
    }
  };
