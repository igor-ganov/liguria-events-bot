/**
 * LLM enrichment (design §5, US-2): batch categorize + describe stored
 * events, and extract structured events from Telegram post text. Both parse
 * defensively — an unusable LLM item is skipped, never trusted (AC-2.3).
 */
import { CATEGORIES, isCategory, isIsoDate, parseLocalized } from '../domain/event.ts';
import type { Category, LocalizedText, RawEvent } from '../domain/event.ts';
import type { RawPost } from '../collectors/types.ts';
import { extractJson } from './client.ts';
import type { ChatFn } from './client.ts';
import { asArray, asBoolean, asNonEmptyString, readProp } from '../util/json.ts';

export type PendingEnrich = Readonly<{
  id: string;
  title: string;
  dates: string;
  venue?: string;
  categoryHint?: Category;
  raw?: string;
}>;

export type Enrichment = Readonly<{
  categories: readonly Category[];
  /** Display titles; absent → the pipeline falls back to the original. */
  titles?: LocalizedText;
  descriptions: LocalizedText;
  /** Google-geocodable location string for the map link; absent if unknown. */
  address?: string;
  unusual: boolean;
  /** Content-policy violation — such events are dropped, never stored. */
  blocked?: boolean;
}>;

// Three-language descriptions cost ~3× tokens; 4 events per call keeps the
// completion under the 4096 cap (the truncated-JSON failure we hit before).
const ENRICH_BATCH = 4;
const EXTRACT_BATCH = 20;

export const chunk = <T>(items: readonly T[], size: number): readonly (readonly T[])[] =>
  items.length === 0
    ? []
    : Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
        items.slice(i * size, (i + 1) * size),
      );

const ENRICH_SYSTEM = [
  'You are a data curator for a Genoa (Italy) events guide.',
  'For EVERY input event return 1 to 3 categories from this fixed list,',
  'most specific first (a food festival with concerts is ["food","music"]):',
  CATEGORIES.join(', '),
  'a fresh, neutral 1-2 sentence description IN YOUR OWN WORDS in EACH of',
  'English, Italian and Russian — summarize what it is, where, and why it is',
  'interesting. Never copy source sentences verbatim and do not invent facts.',
  'Also give a display "titles" map with the event title in each language:',
  'translate only the descriptive / common-noun parts and KEEP proper nouns',
  'unchanged (festival & event names, venue names, person & brand names). If a',
  'title is wholly a proper noun, repeat it identically in all three.',
  'Also give "address": a concise Google-Maps-geocodable location for the',
  'venue, e.g. "Teatro della Tosse, Piazza Renato Negri 4, Genova". Use the',
  'input venue and your knowledge of Genoa; always end with ", Genova" (or the',
  'correct nearby comune). Omit the field ONLY if you truly cannot place it.',
  'Also set "unusual": true ONLY for offbeat, niche, experimental or',
  'distinctly non-touristy happenings (a neighbourhood performance, an',
  'unconventional venue, an oddball one-off, immersive/site-specific art);',
  'false for standard mainstream fare (big-name concerts, major museum',
  'exhibitions, routine guided tours). When in doubt, false.',
  'Also set "blocked": true for any event that violates our content policy —',
  'anything extremist, terrorist or violent, or hateful, discriminatory,',
  'racist or xenophobic, or that targets or demeans people by race, ethnicity,',
  'nationality, religion, gender, sexual orientation or disability, or is',
  'otherwise illegal. Ordinary cultural, political, religious or community',
  'events are NOT blocked — block only genuinely harmful content. In doubt, false.',
  'Respond with STRICT valid JSON, no markdown, no backticks:',
  '{ "events": [ { "id": "<input id>", "categories": ["<category>", "..."], "titles": { "en": "…", "it": "…", "ru": "…" }, "descriptions": { "en": "…", "it": "…", "ru": "…" }, "address": "…", "unusual": true|false, "blocked": true|false } ] }',
].join('\n');

const parseEnrichment = (value: unknown): readonly (readonly [string, Enrichment])[] => {
  const id = asNonEmptyString(readProp(value, 'id'));
  // Accept the descriptions map or a legacy flat "description" string (→ en).
  const descriptions = parseLocalized(
    readProp(value, 'descriptions'),
    asNonEmptyString(readProp(value, 'description')),
  );
  // Display titles are optional; the pipeline falls back to the original title.
  const titles = parseLocalized(readProp(value, 'titles'));
  const many = (asArray(readProp(value, 'categories')) ?? []).filter(isCategory);
  const legacy = readProp(value, 'category');
  const categories = [...many, ...(isCategory(legacy) ? [legacy] : [])].slice(0, 3);
  if (id === undefined || categories.length === 0 || descriptions === undefined) return [];
  const address = asNonEmptyString(readProp(value, 'address'));
  const enrichment: Enrichment = {
    categories,
    descriptions,
    unusual: asBoolean(readProp(value, 'unusual')) === true,
    ...(titles === undefined ? {} : { titles }),
    ...(address === undefined ? {} : { address }),
    ...(asBoolean(readProp(value, 'blocked')) === true ? { blocked: true } : {}),
  };
  return [[id, enrichment]];
};

export const makeEnrichEvents =
  (chat: ChatFn) =>
  async (events: readonly PendingEnrich[]): Promise<ReadonlyMap<string, Enrichment>> => {
    const results = await Promise.all(
      chunk(events, ENRICH_BATCH).map(async (batch) => {
        try {
          const reply = await chat(ENRICH_SYSTEM, JSON.stringify({ events: batch }));
          const items = asArray(readProp(extractJson(reply), 'events')) ?? [];
          return items.flatMap(parseEnrichment);
        } catch {
          return []; // failed batch → events stay enriched:false (AC-2.3)
        }
      }),
    );
    return new Map(results.flat());
  };

const extractSystem = (today: string): string =>
  [
    'You extract public events happening in or around Genoa (Italy) from',
    'Telegram channel posts. Today is ' + today + '.',
    'Only extract real, dated, attendable events (concerts, shows, markets,',
    'tours, festivals, workshops…). Skip news, ads, giveaways and past events.',
    'Resolve relative dates ("domani", "this Saturday") against today.',
    'Respond with STRICT valid JSON, no markdown:',
    '{ "events": [ {',
    '  "title": "<short title>",',
    '  "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD (optional)",',
    '  "time": "HH:MM (optional)", "venue": "<optional>", "address": "<optional>",',
    '  "priceInfo": "<optional>", "description": "<1-2 sentences, optional>",',
    '  "post": "<channel>/<messageId> of the source post"',
    '} ] }',
    'If nothing qualifies: { "events": [] }',
  ].join('\n');

const formatPost = (post: RawPost): string =>
  `[${post.channel}/${post.messageId}]\n${post.text}`;

const POST_REF = /^([A-Za-z0-9_]+)\/(\d+)$/;

const parseExtracted = (today: string) =>
  (value: unknown): readonly RawEvent[] => {
    const title = asNonEmptyString(readProp(value, 'title'));
    const startDate = asNonEmptyString(readProp(value, 'startDate'));
    const post = asNonEmptyString(readProp(value, 'post'));
    if (title === undefined || startDate === undefined || !isIsoDate(startDate)) return [];
    const endDate = asNonEmptyString(readProp(value, 'endDate'));
    if ((endDate ?? startDate) < today) return [];
    if (endDate !== undefined && !isIsoDate(endDate)) return [];
    const ref = post === undefined ? null : POST_REF.exec(post);
    if (ref === null) return [];
    const [, channel, messageId] = ref;
    if (channel === undefined || messageId === undefined) return [];
    const time = asNonEmptyString(readProp(value, 'time'));
    const venue = asNonEmptyString(readProp(value, 'venue'));
    const address = asNonEmptyString(readProp(value, 'address'));
    const priceInfo = asNonEmptyString(readProp(value, 'priceInfo'));
    const description = asNonEmptyString(readProp(value, 'description'));
    return [
      {
        title,
        startDate,
        url: `https://t.me/${channel}/${messageId}`,
        source: `tg:${channel}`,
        ...(endDate === undefined ? {} : { endDate }),
        ...(time === undefined ? {} : { time }),
        ...(venue === undefined ? {} : { venue }),
        ...(address === undefined ? {} : { address }),
        ...(priceInfo === undefined ? {} : { priceInfo }),
        ...(description === undefined ? {} : { rawDescription: description }),
      },
    ];
  };

export const makeExtractFromPosts =
  (chat: ChatFn) =>
  async (posts: readonly RawPost[], today: string): Promise<readonly RawEvent[]> => {
    if (posts.length === 0) return [];
    const results = await Promise.all(
      chunk(posts, EXTRACT_BATCH).map(async (batch) => {
        try {
          const reply = await chat(
            extractSystem(today),
            batch.map(formatPost).join('\n\n---\n\n'),
          );
          const items = asArray(readProp(extractJson(reply), 'events')) ?? [];
          return items.flatMap(parseExtracted(today));
        } catch {
          return [];
        }
      }),
    );
    return results.flat();
  };
