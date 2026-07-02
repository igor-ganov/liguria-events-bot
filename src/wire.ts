/**
 * Composition root (reference idiom): build the pipeline's injected
 * dependencies from the environment. Everything behind `CollectDeps` stays
 * pure and unit-testable (AC-8.4).
 */
import { makeVisitgenoaCollector, makeDetailFetcher } from './collectors/visitgenoa.ts';
import { makeMentelocaleCollector } from './collectors/mentelocale.ts';
import { makeGenovateatroCollector } from './collectors/genovateatro.ts';
import { makePalazzoducaleCollector } from './collectors/palazzoducale.ts';
import { makePortoanticoCollector } from './collectors/portoantico.ts';
import { makeTgCollector } from './collectors/tg-public.ts';
import { makeChat } from './llm/client.ts';
import type { ChatFn } from './llm/client.ts';
import { makeEnrichEvents, makeExtractFromPosts } from './llm/enrich.ts';
import type { CollectDeps } from './pipeline/collect-run.ts';
import { sourcePagesOf, tgChannelsOf } from './config.ts';
import type { Env } from './config.ts';

export const chatOf = (env: Env): ChatFn =>
  makeChat({
    ai: env.AI,
    ...(env.GEMINI_API_KEY === undefined ? {} : { geminiApiKey: env.GEMINI_API_KEY }),
  });

export const buildCollectDeps = (env: Env): CollectDeps => {
  const chat = chatOf(env);
  const now = (): number => Date.now();
  return {
    kv: env.EVENTS,
    collectors: [
      makeVisitgenoaCollector(fetch, sourcePagesOf(env)),
      makeMentelocaleCollector(fetch),
      makeGenovateatroCollector(fetch),
      makePalazzoducaleCollector(fetch),
      makePortoanticoCollector(fetch),
      ...tgChannelsOf(env).map((channel) => makeTgCollector(fetch, channel, now)),
    ],
    extract: makeExtractFromPosts(chat),
    enrich: makeEnrichEvents(chat),
    details: makeDetailFetcher(fetch),
    now,
  };
};
