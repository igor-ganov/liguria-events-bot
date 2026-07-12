/**
 * Composition root (reference idiom): build the pipeline's injected
 * dependencies from the environment. Everything behind `CollectDeps` stays
 * pure and unit-testable (AC-8.4).
 */
import { makeVisitgenoaCollector, makeDetailFetcher } from './collectors/visitgenoa.ts';
import { makeMentelocaleCollector, MENTELOCALE_CITIES } from './collectors/mentelocale.ts';
import { makeEventiesagreCollector } from './collectors/eventiesagre.ts';
import { makeTicketmasterCollector } from './collectors/ticketmaster.ts';
import { makeGenovateatroCollector } from './collectors/genovateatro.ts';
import { makePalazzoducaleCollector } from './collectors/palazzoducale.ts';
import { makePortoanticoCollector } from './collectors/portoantico.ts';
import { makeCarlofeliceCollector } from './collectors/carlofelice.ts';
import { makeTgCollector } from './collectors/tg-public.ts';
import { makeChat } from './llm/client.ts';
import type { ChatFn } from './llm/client.ts';
import { makeEnrichEvents, makeExtractFromPosts } from './llm/enrich.ts';
import { makeJudgeSameEvent } from './llm/same-event.ts';
import type { CollectDeps } from './pipeline/collect-run.ts';
import type { GeocodeDeps } from './pipeline/geocode.ts';

/** One minute of lookups a run: ~55 addresses at Nominatim's one-per-second.
 *  The backlog drains over a few runs and then only new venues cost anything. */
const GEOCODE_BUDGET_MS = 60_000;
import { romeDate } from './pipeline/clock.ts';
import { sourcePagesOf, tgChannelsOf } from './config.ts';
import type { Env } from './config.ts';

export const chatOf = (env: Env): ChatFn =>
  makeChat({
    ai: env.AI,
    ...(env.GEMINI_API_KEY === undefined ? {} : { geminiApiKey: env.GEMINI_API_KEY }),
  });

/** The geocoding pass — deliberately separate from collecting, so a slow or
 *  unhappy Nominatim can never cost us a crawl. */
export const buildGeocodeDeps = (env: Env): GeocodeDeps => ({
  kv: env.EVENTS,
  fetchFn: fetch,
  now: () => Date.now(),
  budgetMs: GEOCODE_BUDGET_MS,
});

export const buildCollectDeps = (env: Env): CollectDeps => {
  const chat = chatOf(env);
  const now = (): number => Date.now();
  return {
    kv: env.EVENTS,
    collectors: [
      makeVisitgenoaCollector(fetch, sourcePagesOf(env)),
      // Genoa keeps its dedicated sources; the rest of Italy arrives through
      // mentelocale's other two agendas and the national aggregator.
      ...MENTELOCALE_CITIES.map((city) => makeMentelocaleCollector(fetch, city)),
      makeEventiesagreCollector(fetch),
      // The only source that answers in JSON, with coordinates — no scraping and
      // no geocoding. Sits out entirely when no key is configured.
      ...(env.TICKETMASTER_KEY === undefined
        ? []
        : [makeTicketmasterCollector(fetch, env.TICKETMASTER_KEY, () => romeDate(now()))]),
      makeGenovateatroCollector(fetch),
      makePalazzoducaleCollector(fetch),
      makePortoanticoCollector(fetch),
      makeCarlofeliceCollector(fetch),
      ...tgChannelsOf(env).map((channel) => makeTgCollector(fetch, channel, now)),
    ],
    extract: makeExtractFromPosts(chat),
    enrich: makeEnrichEvents(chat),
    details: makeDetailFetcher(fetch),
    judgeSameEvent: makeJudgeSameEvent(chat),
    fetchFn: fetch,
    now,
  };
};
