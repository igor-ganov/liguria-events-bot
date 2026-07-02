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

  const seen = new Set<string>();
  return drafts.flatMap((draft): readonly RawEvent[] => {
    const range = parseSeasonDate(draft.date);
    const title = decodeEntities(draft.title);
    if (range === undefined || title === '' || !draft.href.includes('/spettacolo/')) return [];
    if (seen.has(draft.href)) return []; // the slider repeats slides
    seen.add(draft.href);
    return [
      {
        title,
        startDate: range.startDate,
        url: draft.href,
        source: CARLOFELICE_SOURCE,
        venue: VENUE,
        categoryHint: 'music',
        ...(range.endDate === undefined ? {} : { endDate: range.endDate }),
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
