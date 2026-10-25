/**
 * genovateatro.it collector (design §4.3). Federated theatre agenda — the
 * same CMS family as mentelocale. Verified markup (2026-10-25), one card shape
 * on three kinds of listing page:
 *
 *   <div class="Evento">
 *     <a href="/eventi/2026-2027/teatrodellatosse/can-can.htm">
 *       <span class="Title">Can Can</span>
 *       <span class="Abstract">…</span>
 *       <span class="Date">Dal 30/10/2026 al 01/11/2026</span>
 *       <span class="DownEventBox">Teatro della Tosse</span>
 *
 * - `/eventi/` — the agenda: the next TEN shows and nothing more (no further
 *   pages; query strings are ignored). Reading only this page is why the
 *   corpus held 11 of the site's ~80 shows. Dates are runs; the abstract is
 *   a description.
 * - `/` — home: about six weeks of shows, each dated by its NEXT performance
 *   (not its run) and carrying the venue in `DownEventBox`.
 * - `/argomenti/<topic>.htm` — one per genre, ten shows each, reaching further
 *   out. Dates are runs; the "abstract" here is the venue's name.
 *
 * Each show's own page (`p.EventDates`, `p.EventLocation`, `div.EventText`)
 * then gives the run, the venue with its street address and the full text.
 *
 * Everything here is theatre → static `categoryHint: 'theatre'`.
 */
import type { RawEvent } from '../domain/event.ts';
import { mapBounded } from '../util/bounded.ts';
import { decodeEntities, parseDateRange } from './italian-dates.ts';
import type { DateRange } from './italian-dates.ts';
import type { CollectOutcome, Collector, FetchFn } from './types.ts';

export const GENOVATEATRO_SOURCE = 'genovateatro';
const BASE_URL = 'https://www.genovateatro.it';
const HOME_URL = `${BASE_URL}/`;
const AGENDA_URL = `${BASE_URL}/eventi/`;
const USER_AGENT = 'Mozilla/5.0 (compatible; event-collecter/0.0)';

/** The whole site lists ~80 shows; the cap only guards against a listing
 *  that suddenly links hundreds. The crawl runs every six hours. */
const DETAIL_FETCH_CAP = 120;
const DETAIL_CONCURRENCY = 8;
const DESCRIPTION_MAX = 4000;

// ───────────────────────────────────────────────────────────── venues ──

/** GOG (Giovine Orchestra Genovese) prefixes its name to the hall it plays. */
const ORGANISER_PREFIX = /^GOG\s+/;

/** genovateatro's spellings → the one the rest of the corpus uses, so the
 *  site files the show on the same venue page as every other source does. */
const SPELLINGS: ReadonlyMap<string, string> = new Map([['Teatro Duse', 'Teatro Eleonora Duse']]);

export const canonicalVenue = (name: string): string => {
  const bare = decodeEntities(name).replace(ORGANISER_PREFIX, '');
  return SPELLINGS.get(bare) ?? bare;
};

/** The house a show page is filed under (`/eventi/<season>/<house>/…`), for
 *  the houses with ONE stage. Teatro Nazionale runs four, GOG plays wherever
 *  it is booked, Lunaria and Sarabanda tour — those get no fallback. */
const HOUSES: ReadonlyMap<string, string> = new Map([
  ['teatrodellatosse', 'Teatro della Tosse'],
  ['teatrogovi', 'Teatro Rina e Gilberto Govi'],
  ['teatrogarage', 'Teatro Garage'],
  ['politeamagenovese', 'Politeama Genovese'],
  ['ilsipariostrappato', 'Teatro Il Sipario Strappato'],
  ['laquintapraticabile', 'Teatro Instabile'],
]);

export const venueOfTheatrePath = (url: string): string | undefined => {
  const house = new URL(url).pathname.split('/')[3];
  return house === undefined ? undefined : HOUSES.get(house);
};

const STREET =
  /^(via|viale|vico|vicolo|piazza|piazzale|corso|largo|salita|passo|calata|lungomare|strada)\b/i;
const CITY_ONLY = /^genova\b/i;

const segmentsOf = (location: string): readonly string[] =>
  location
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '');

/** "Teatro Duse, Via Nicolò Bacigalupo 6, Genova" → its venue, when the
 *  location leads with one rather than with a street or the city. */
const venueOfLocation = (location: string): string | undefined => {
  const head = segmentsOf(location)[0];
  return head === undefined || STREET.test(head) || CITY_ONLY.test(head)
    ? undefined
    : canonicalVenue(head);
};

/** The location as an address, its venue spelled canonically. A bare venue
 *  name is not an address. */
const addressOfLocation = (location: string): string | undefined => {
  const [head, ...rest] = segmentsOf(location);
  if (head === undefined || rest.length === 0) return undefined;
  return [venueOfLocation(location) ?? head, ...rest].join(', ');
};

// ──────────────────────────────────────────────────────────── listings ──

type Card = { href: string; title: string; date: string; abstract: string; img: string; aside: string };

/** What one listing card tells us, once read for its page kind. */
type Listing = Readonly<{
  href: string;
  title: string;
  dates?: DateRange;
  venue?: string;
  description?: string;
  image?: string;
}>;

type ListingKind = 'agenda' | 'topic' | 'home';

const datesOf = (card: Card): Pick<Listing, 'dates'> => {
  const dates = parseDateRange(card.date);
  return dates === undefined ? {} : { dates };
};

const venueOfText = (text: string): Pick<Listing, 'venue'> => {
  const venue = decodeEntities(text);
  return venue === '' ? {} : { venue: canonicalVenue(venue) };
};

const descriptionOf = (text: string): Pick<Listing, 'description'> => {
  const description = decodeEntities(text);
  return description === '' ? {} : { description };
};

/** How each kind of page is read — see the header for why they differ. */
const READINGS: Readonly<Record<ListingKind, (card: Card) => Omit<Listing, 'href' | 'title'>>> = {
  agenda: (card) => ({ ...datesOf(card), ...descriptionOf(card.abstract) }),
  topic: (card) => ({ ...datesOf(card), ...venueOfText(card.abstract) }),
  // The home date is the next performance, not the start of the run.
  home: (card) => venueOfText(card.aside),
};

const parseCards = async (html: string): Promise<readonly Card[]> => {
  const cards: Card[] = [];
  const current = (): Card | undefined => cards.at(-1);
  const append =
    (field: 'title' | 'date' | 'abstract' | 'aside') =>
    (chunk: Text): void => {
      const card = current();
      if (card !== undefined && card[field].length < 600) card[field] += chunk.text;
    };
  const rewriter = new HTMLRewriter()
    .on('div.Evento', {
      element: () => {
        cards.push({ href: '', title: '', date: '', abstract: '', img: '', aside: '' });
      },
    })
    .on('div.Evento > a', {
      element: (element) => {
        const card = current();
        const href = element.getAttribute('href') ?? '';
        if (card !== undefined && card.href === '' && href.startsWith('/')) card.href = href;
      },
    })
    .on('div.Evento img', {
      element: (element) => {
        const card = current();
        if (card !== undefined && card.img === '') card.img = element.getAttribute('src') ?? '';
      },
    })
    .on('div.Evento span.Title', { text: append('title') })
    .on('div.Evento span.Date', { text: append('date') })
    .on('div.Evento span.Abstract', { text: append('abstract') })
    .on('div.Evento span.DownEventBox', { text: append('aside') });
  await rewriter.transform(new Response(html)).arrayBuffer();
  return cards;
};

const listingsOf = async (kind: ListingKind, html: string): Promise<readonly Listing[]> =>
  (await parseCards(html)).flatMap((card): readonly Listing[] => {
    const title = decodeEntities(card.title);
    if (title === '' || card.href === '') return [];
    return [
      {
        href: new URL(card.href, BASE_URL).toString(),
        title,
        ...(card.img === '' ? {} : { image: new URL(card.img, BASE_URL).toString() }),
        ...READINGS[kind](card),
      },
    ];
  });

/** One listing per show: the earlier page wins, later pages fill its gaps. */
const unionByHref = (listings: readonly Listing[]): readonly Listing[] =>
  [
    ...listings
      .reduce(
        (byHref, listing) => byHref.set(listing.href, { ...listing, ...byHref.get(listing.href) }),
        new Map<string, Listing>(),
      )
      .values(),
  ];

/** The genre pages home links to — discovered, so a new genre is read too. */
export const topicPagesOf = (html: string): readonly string[] => [
  ...new Set([...html.matchAll(/href="(\/argomenti\/[a-z0-9-]+\.htm)"/g)].flatMap((match) =>
    match[1] === undefined ? [] : [new URL(match[1], BASE_URL).toString()],
  )),
];

// ───────────────────────────────────────────────────────── show page ──

export type GenovateatroDetail = Readonly<{
  title?: string;
  dates?: DateRange;
  /** "Teatro della Tosse, piazza Renato Negri 4, Genova" — venue first. */
  location?: string;
  description?: string;
  image?: string;
}>;

export const parseGenovateatroDetail = async (html: string): Promise<GenovateatroDetail> => {
  const raw = { title: '', dates: '', location: '', description: '', image: '' };
  let inText = false;
  const append =
    (field: 'title' | 'dates' | 'location' | 'description') =>
    (text: string): void => {
      if (raw[field].length < DESCRIPTION_MAX * 2) raw[field] += text;
    };
  const rewriter = new HTMLRewriter()
    .on('h1.PageTitle', { text: (chunk) => append('title')(chunk.text) })
    .on('p.EventDates', { text: (chunk) => append('dates')(chunk.text) })
    .on('p.EventLocation span', { text: (chunk) => append('location')(chunk.text) })
    .on('img.PageImage', {
      element: (element) => {
        raw.image ||= element.getAttribute('src') ?? '';
      },
    })
    // The body nests <strong>/<br> freely; a scoped universal collector reads
    // the whole subtree, and a line break must not glue two sentences.
    .on('div.EventText', {
      element: (element) => {
        inText = true;
        element.onEndTag(() => {
          inText = false;
        });
      },
    })
    .on('div.EventText br', { element: () => append('description')(' ') })
    .on('*', {
      text: (chunk) => {
        if (inText) append('description')(chunk.text);
      },
    });
  await rewriter.transform(new Response(html)).arrayBuffer();

  const title = decodeEntities(raw.title);
  const dates = parseDateRange(raw.dates);
  const location = decodeEntities(raw.location);
  const description = decodeEntities(raw.description).slice(0, DESCRIPTION_MAX);
  return {
    ...(title === '' ? {} : { title }),
    ...(dates === undefined ? {} : { dates }),
    ...(location === '' ? {} : { location }),
    ...(description === '' ? {} : { description }),
    ...(raw.image === '' ? {} : { image: new URL(raw.image, BASE_URL).toString() }),
  };
};

// ───────────────────────────────────────────────────────────── events ──

/**
 * A show, from what its listings said and what its own page said. The page
 * wins on run, venue and text; the venue falls back to the listing, then to
 * the house in the url. No trustworthy run → no event (the home page's
 * next-performance date would re-date the show every day it runs).
 */
const eventOf = (listing: Listing, detail: GenovateatroDetail): RawEvent | undefined => {
  const dates = detail.dates ?? listing.dates;
  if (dates === undefined) return undefined;
  const location = detail.location ?? '';
  const venue =
    venueOfLocation(location) ?? listing.venue ?? venueOfTheatrePath(listing.href);
  const address = addressOfLocation(location);
  const description = detail.description ?? listing.description;
  const image = detail.image ?? listing.image;
  return {
    title: listing.title,
    startDate: dates.startDate,
    url: listing.href,
    source: GENOVATEATRO_SOURCE,
    city: 'genova',
    categoryHint: 'theatre',
    ...(dates.endDate === undefined ? {} : { endDate: dates.endDate }),
    ...(venue === undefined ? {} : { venue }),
    ...(address === undefined ? {} : { address }),
    ...(description === undefined ? {} : { rawDescription: description }),
    ...(image === undefined ? {} : { image }),
  };
};

/** The agenda page alone, read without visiting any show page. */
export const parseGenovateatroHtml = async (html: string): Promise<readonly RawEvent[]> =>
  (await listingsOf('agenda', html)).flatMap((listing) => eventOf(listing, {}) ?? []);

// ─────────────────────────────────────────────────────────── collector ──

const fetchText = async (fetchFn: FetchFn, url: string): Promise<string | undefined> => {
  try {
    const response = await fetchFn(url, { headers: { 'user-agent': USER_AGENT } });
    return response.ok ? await response.text() : undefined;
  } catch {
    return undefined;
  }
};

const detailOf =
  (fetchFn: FetchFn) =>
  async (listing: Listing): Promise<GenovateatroDetail> => {
    const html = await fetchText(fetchFn, listing.href);
    return html === undefined ? {} : parseGenovateatroDetail(html);
  };

const FAILED: CollectOutcome = { source: GENOVATEATRO_SOURCE, events: [], posts: [], failed: true };

export const makeGenovateatroCollector =
  (fetchFn: FetchFn): Collector =>
  async (): Promise<CollectOutcome> => {
    try {
      const [home, agenda] = await Promise.all([
        fetchText(fetchFn, HOME_URL),
        fetchText(fetchFn, AGENDA_URL),
      ]);
      const topics = await Promise.all(
        topicPagesOf(home ?? '').map((url) => fetchText(fetchFn, url)),
      );
      // Pages whose dates are runs come first, so their reading wins.
      const pages: readonly (readonly [ListingKind, string | undefined])[] = [
        ['agenda', agenda],
        ...topics.map((html): readonly [ListingKind, string | undefined] => ['topic', html]),
        ['home', home],
      ];
      const answered = pages.flatMap(([kind, html]) =>
        html === undefined ? [] : [{ kind, html }],
      );
      if (answered.length === 0) return FAILED;

      const listings = unionByHref(
        (await Promise.all(answered.map(({ kind, html }) => listingsOf(kind, html)))).flat(),
      ).slice(0, DETAIL_FETCH_CAP);
      const details = await mapBounded(DETAIL_CONCURRENCY)(listings, detailOf(fetchFn));
      const events = listings.flatMap((listing, i) => eventOf(listing, details[i] ?? {}) ?? []);
      return { source: GENOVATEATRO_SOURCE, events, posts: [], failed: false };
    } catch {
      return FAILED;
    }
  };
