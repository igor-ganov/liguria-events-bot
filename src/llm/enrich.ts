/**
 * LLM enrichment (design §5, US-2): batch categorize + describe stored
 * events, and extract structured events from Telegram post text. Both parse
 * defensively — an unusable LLM item is skipped, never trusted (AC-2.3).
 */
import { CATEGORIES, isCategory, isIsoDate } from '../domain/event.ts';
import type { Category, RawEvent } from '../domain/event.ts';
import type { RawPost } from '../collectors/types.ts';
import { extractJson } from './client.ts';
import type { ChatFn } from './client.ts';
import { asArray, asNonEmptyString, readProp } from '../util/json.ts';

export type PendingEnrich = Readonly<{
  id: string;
  title: string;
  dates: string;
  categoryHint?: Category;
  raw?: string;
}>;

export type Enrichment = Readonly<{ category: Category; description: string }>;

const ENRICH_BATCH = 15;
const EXTRACT_BATCH = 20;

export const chunk = <T>(items: readonly T[], size: number): readonly (readonly T[])[] =>
  items.length === 0
    ? []
    : Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
        items.slice(i * size, (i + 1) * size),
      );

const ENRICH_SYSTEM = [
  'You are a data curator for a Genoa (Italy) events guide.',
  'For EVERY input event return exactly one category from this fixed list:',
  CATEGORIES.join(', '),
  'and a neutral 1-2 sentence English description: what it is, where, and why',
  'it is interesting. Do not invent facts absent from the input.',
  'Respond with STRICT valid JSON, no markdown, no backticks:',
  '{ "events": [ { "id": "<input id>", "category": "<category>", "description": "<1-2 sentences>" } ] }',
].join('\n');

const parseEnrichment = (value: unknown): readonly (readonly [string, Enrichment])[] => {
  const id = asNonEmptyString(readProp(value, 'id'));
  const category = readProp(value, 'category');
  const description = asNonEmptyString(readProp(value, 'description'));
  if (id === undefined || !isCategory(category) || description === undefined) return [];
  return [[id, { category, description }]];
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
