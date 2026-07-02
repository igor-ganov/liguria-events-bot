/**
 * palazzoducale.genova.it collector (design §4.4). The "in programma" tab is
 * server-rendered via a plain GET query. Verified markup (2026-07-02):
 *
 *   <article class="exhibition-item">
 *     <p class="exhibition-type">Evento | Cinema</p>
 *     <h2 class="exhibition-title"><a href="…/evento/le-citta-di-pianura/">…</a></h2>
 *     <p class="exhibition-info">
 *       Palazzo Ducale Cortile Maggiore<br />
 *       01 lug 2026 — 01 lug 2026, ore 21:30
 *     </p>
 *
 * Dates use Italian month abbreviations → `parseItalianDateInfo`; the text
 * before the first date is the venue.
 */
import type { Category, RawEvent } from '../domain/event.ts';
import { decodeEntities, parseItalianDateInfo } from './italian-dates.ts';
import type { CollectOutcome, Collector, FetchFn } from './types.ts';

export const PALAZZODUCALE_SOURCE = 'palazzoducale';
const LISTING_URL = 'https://palazzoducale.genova.it/eventi/?archive_type=2%23in-programma';
const USER_AGENT = 'Mozilla/5.0 (compatible; event-collecter/0.0)';

/** `exhibition-type` labels → taxonomy hint (LLM confirms during enrichment). */
const TYPE_HINTS: readonly (readonly [RegExp, Category])[] = [
  [/mostra|arte/i, 'art'],
  [/musica|concert/i, 'music'],
  [/cinema|letteratura|incontro/i, 'culture'],
  [/convegno|didattica|laborator/i, 'workshop'],
  [/bambin|famigli/i, 'family'],
];

export const mapDucaleType = (label: string): Category | undefined =>
  TYPE_HINTS.find(([pattern]) => pattern.test(label))?.[1];

type Draft = { href: string; title: string; type: string; info: string };

export const parsePalazzoducaleHtml = async (html: string): Promise<readonly RawEvent[]> => {
  const drafts: Draft[] = [];
  const current = (): Draft | undefined => drafts.at(-1);
  const rewriter = new HTMLRewriter()
    .on('article.exhibition-item', {
      element: () => {
        drafts.push({ href: '', title: '', type: '', info: '' });
      },
    })
    .on('article.exhibition-item h2.exhibition-title a', {
      element: (element) => {
        const draft = current();
        const href = element.getAttribute('href');
        if (draft !== undefined && draft.href === '' && href !== null) draft.href = href;
      },
      text: (chunk) => {
        const draft = current();
        if (draft !== undefined) draft.title += chunk.text;
      },
    })
    .on('article.exhibition-item p.exhibition-type', {
      text: (chunk) => {
        const draft = current();
        if (draft !== undefined) draft.type += chunk.text;
      },
    })
    .on('article.exhibition-item p.exhibition-info', {
      text: (chunk) => {
        const draft = current();
        if (draft !== undefined) draft.info += ` ${chunk.text}`;
      },
    });
  await rewriter.transform(new Response(html)).arrayBuffer();

  return drafts.flatMap((draft): readonly RawEvent[] => {
    const info = parseItalianDateInfo(decodeEntities(draft.info));
    const title = decodeEntities(draft.title);
    if (info === undefined || title === '' || draft.href === '') return [];
    const venue = info.prefix;
    const hint = mapDucaleType(draft.type);
    return [
      {
        title,
        startDate: info.startDate,
        url: draft.href,
        source: PALAZZODUCALE_SOURCE,
        ...(info.endDate === undefined ? {} : { endDate: info.endDate }),
        ...(info.time === undefined ? {} : { time: info.time }),
        ...(venue === '' ? {} : { venue }),
        ...(hint === undefined ? {} : { categoryHint: hint }),
      },
    ];
  });
};

export const makePalazzoducaleCollector =
  (fetchFn: FetchFn): Collector =>
  async (): Promise<CollectOutcome> => {
    try {
      const response = await fetchFn(LISTING_URL, {
        headers: { 'user-agent': USER_AGENT },
      });
      if (!response.ok) {
        return { source: PALAZZODUCALE_SOURCE, events: [], posts: [], failed: true };
      }
      const events = await parsePalazzoducaleHtml(await response.text());
      return { source: PALAZZODUCALE_SOURCE, events, posts: [], failed: false };
    } catch {
      return { source: PALAZZODUCALE_SOURCE, events: [], posts: [], failed: true };
    }
  };
