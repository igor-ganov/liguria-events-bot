/**
 * Teatro Carlo Felice collector (design §4.6). Genoa's opera house — opera,
 * ballet and symphonic concerts, a category the other sources barely cover.
 * The season homepage is an Elementor slider; verified markup (2026-07-02):
 *
 *   <div class="swiper-slide">
 *     <a class="swiper-slide-inner" href="…/spettacolo/le-nozze-di-figaro/">
 *       <div class="swiper-slide-contents">
 *         <div class="elementor-slide-heading">LE NOZZE DI FIGARO</div>
 *         <div class="elementor-slide-description">Dal 16 al 25 ottobre 2026</div>
 *
 * robots.txt permits crawling (only /wp-admin/ is disallowed), no TDM opt-out.
 */
import type { RawEvent } from '../domain/event.ts';
import { decodeEntities, parseSeasonDate } from './italian-dates.ts';
import type { CollectOutcome, Collector, FetchFn } from './types.ts';

export const CARLOFELICE_SOURCE = 'carlofelice';
const LISTING_URL = 'https://operacarlofelicegenova.it/';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const VENUE = 'Teatro Carlo Felice';

type Draft = { href: string; title: string; date: string };

export const parseCarlofeliceHtml = async (html: string): Promise<readonly RawEvent[]> => {
  const drafts: Draft[] = [];
  const current = (): Draft | undefined => drafts.at(-1);
  const rewriter = new HTMLRewriter()
    .on('a.swiper-slide-inner', {
      element: (element) => {
        const href = element.getAttribute('href');
        drafts.push({ href: href ?? '', title: '', date: '' });
      },
    })
    .on('a.swiper-slide-inner .elementor-slide-heading', {
      text: (chunk) => {
        const draft = current();
        if (draft !== undefined) draft.title += chunk.text;
      },
    })
    .on('a.swiper-slide-inner .elementor-slide-description', {
      text: (chunk) => {
        const draft = current();
        if (draft !== undefined) draft.date += chunk.text;
      },
    });
  await rewriter.transform(new Response(html)).arrayBuffer();

  type Parsed = { href: string; title: string; startDate: string; endDate?: string };
  const seen = new Set<string>();
  const parsed: Parsed[] = [];
  for (const draft of drafts) {
    const range = parseSeasonDate(draft.date);
    // The theatre publishes ONE production as several dated pages (…paganini_1,
    // …paganini_2). Strip the trailing _N so the same show groups into one.
    const title = decodeEntities(draft.title).replace(/_\d+$/, '').trim();
    if (range === undefined || title === '' || !draft.href.includes('/spettacolo/')) continue;
    if (seen.has(draft.href)) continue; // the slider repeats slides
    seen.add(draft.href);
    parsed.push({
      href: draft.href,
      title,
      startDate: range.startDate,
      ...(range.endDate === undefined ? {} : { endDate: range.endDate }),
    });
  }

  const groups = new Map<string, Parsed[]>();
  for (const item of parsed) {
    const key = item.href.replace(/_\d+\/?$/, ''); // …/paganini_2/ → …/paganini
    const bucket = groups.get(key) ?? [];
    bucket.push(item);
    groups.set(key, bucket);
  }

  return [...groups.values()].flatMap((items): readonly RawEvent[] => {
    const first = items[0];
    if (first === undefined) return [];
    const startDate = items.map((item) => item.startDate).toSorted()[0] ?? first.startDate;
    const endDate =
      items.map((item) => item.endDate ?? item.startDate).toSorted().at(-1) ?? startDate;
    const altLinks = items.slice(1).map((item) => ({ source: CARLOFELICE_SOURCE, url: item.href }));
    return [
      {
        title: first.title,
        startDate,
        url: first.href,
        source: CARLOFELICE_SOURCE,
        city: 'genova',
        venue: VENUE,
        categoryHint: 'music',
        ...(endDate === startDate ? {} : { endDate }),
        ...(altLinks.length === 0 ? {} : { altLinks }),
      },
    ];
  });
};

export const makeCarlofeliceCollector =
  (fetchFn: FetchFn): Collector =>
  async (): Promise<CollectOutcome> => {
    try {
      const response = await fetchFn(LISTING_URL, { headers: { 'user-agent': USER_AGENT } });
      if (!response.ok) {
        return { source: CARLOFELICE_SOURCE, events: [], posts: [], failed: true };
      }
      const events = await parseCarlofeliceHtml(await response.text());
      return { source: CARLOFELICE_SOURCE, events, posts: [], failed: false };
    } catch {
      return { source: CARLOFELICE_SOURCE, events: [], posts: [], failed: true };
    }
  };
