/**
 * LLM enrichment (design §5, US-2): batch categorize + describe stored
 * events, and extract structured events from Telegram post text. Both parse
 * defensively — an unusable LLM item is skipped, never trusted (AC-2.3).
 */
import { CATEGORIES, hasCjk, isCategory, isIsoDate, parseLocalized, parseSessions } from '../domain/event.ts';
import type { Category, EventKind, LocalizedText, RawEvent, Session } from '../domain/event.ts';
import type { RawPost } from '../collectors/types.ts';
import { extractJson } from './client.ts';
import { classifyFailure, emptyReason, tallyFailures } from './llm-failure.ts';
import type { ChatFn } from './client.ts';
import { asArray, asBoolean, asNonEmptyString, readProp } from '../util/json.ts';

export type PendingEnrich = Readonly<{
  id: string;
  title: string;
  dates: string;
  venue?: string;
  /** City the event is filed under — the model must not assume Genoa. */
  city?: string;
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
  /** Start time HH:MM, only when the source text states one; else absent. */
  time?: string;
  /** Attendance length in minutes, only when the source clearly states it. */
  durationMin?: number;
  /** The dated programme inside an umbrella event — individual occurrences. */
  sessions?: readonly Session[];
  /** Whether the dates are the event's own run (`standalone`) or only the days
   *  its programme occupies (`container`). See EventKind. */
  kind?: EventKind;
  unusual: boolean;
  /** Content-policy violation — such events are dropped, never stored. */
  blocked?: boolean;
}>;

// Three-language descriptions cost ~3× tokens, and the fuller bodies below push
// the per-event output higher still — ONE event per call keeps the completion
// well under the 4096 cap (the truncated-JSON batch loss we hit before).
const ENRICH_BATCH = 1;

// Bump when the enrichment prompt changes materially: records enriched at an
// older version are re-run so the whole corpus converges on the new output.
// v2 = the richer 3-5 sentence descriptions (was 1-2 sentences at v1/undefined).
// v3 = also extract a start time (HH:MM) from the source text when stated.
// v4 = also extract an attendance duration (minutes) when the source states it.
// v5 = fuller descriptions that keep the FULL schedule; 1 event/call for headroom.
// v6 = extract a dated "sessions" programme (umbrella events become findable on
// a specific day), and write the address in Italian so it matches OSM/the map.
// v7 = full descriptions with an absolute ban on "no details provided" filler;
// mentelocale now fetches its detail page so the body is real, not just a title.
// v8 = descriptions are a STRUCTURED Markdown article (lead + labelled sections:
// Programme, Performers, Getting there, Tickets, When), not one wall of text.
// v9 = each section heading carries a stable "[tag]" (programme/performers/
// getting-there/tickets/when) so the site can icon + style sections per type.
// v10 = the prompt actually PRODUCES that structure: the old "no markdown"
// envelope note made the model emit plain prose; the example now shows the
// Markdown-with-\n-and-[tags] shape the description strings must follow.
// v11 = classify "kind": a container happens ONLY on its session dates (a
// concert series, a festival of separate nights) and must not surface on the
// empty days between them; a standalone runs across its whole span.
export const ENRICH_VERSION = 11;
const EXTRACT_BATCH = 20;

export const chunk = <T>(items: readonly T[], size: number): readonly (readonly T[])[] =>
  items.length === 0
    ? []
    : Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
        items.slice(i * size, (i + 1) * size),
      );

const ENRICH_SYSTEM = [
  'You are a data curator for an Italian events guide covering the whole',
  'country. Each input event carries a "city" — the Italian city it belongs',
  'to. Never assume Genoa; use the city each event names.',
  'For EVERY input event return 1 to 3 categories from this fixed list,',
  'most specific first (a food festival with concerts is ["food","music"]):',
  CATEGORIES.join(', '),
  'a thorough, neutral description IN YOUR OWN WORDS in EACH of English, Italian',
  'and Russian, written as a STRUCTURED ARTICLE in light Markdown — NEVER one',
  'undifferentiated wall of text. Structure every description exactly so:',
  '- Open with a lead paragraph (2-4 sentences): what the event is and why it is',
  '  worth attending.',
  '- Then add short labelled sections, each as a Markdown heading on its own line',
  '  in the form "## [tag] <Label>": <Label> is the section name in the',
  '  description\'s OWN language, and [tag] is a fixed English keyword the app',
  '  uses to choose an icon and styling. Use ONLY these tags, and only the',
  '  sections you truly have content for, in this order when present:',
  '  [programme] (the programme / line-up), [performers] (who is involved),',
  '  [getting-there] (the venue and how to reach it), [tickets] (price and how',
  '  to book), [when] (all dates, start times, recurrence). For example a',
  '  Tickets section in Italian is exactly "## [tickets] Biglietti". Use "- "',
  '  bullet lists for programmes, line-ups and multiple dates or times.',
  'Cover EVERY concrete detail the input gives, placed in the right section, and',
  'never drop schedule or programme detail. ABSOLUTELY FORBIDDEN: never output an',
  'empty section, a section saying the information is unknown, or any phrase like',
  '"no further details", "not specified", "unfortunately", "no information',
  'available", "details are unknown" — omit what you do not have in SILENCE. Never',
  'copy source sentences verbatim, and NEVER invent facts: if the source does not',
  'state something, just leave it out — but say NOTHING about its absence.',
  'Write each language in ITS OWN script only: Latin for English and Italian,',
  'Cyrillic for Russian. NEVER emit a Chinese, Japanese or Korean character — not',
  'one glyph, anywhere in any field.',
  'Also give a display "titles" map with the event title in each language:',
  'translate only the descriptive / common-noun parts and KEEP proper nouns',
  'unchanged (festival & event names, venue names, person & brand names). If a',
  'title is wholly a proper noun, repeat it identically in all three.',
  'Also give "address": a concise, geocodable location for the venue, e.g.',
  '"Teatro della Tosse, Piazza Renato Negri 4, Genova". Write it IN ITALIAN, the',
  'way the place is labelled locally ("Musei Reali", not "Royal Museums"), so it',
  'matches the map. Use the input venue and the comune the event names; always',
  'end with the comune and the province, never with a city the event is not in.',
  'Omit the field ONLY if you truly cannot place it.',
  'Also give "time": the start time as "HH:MM" (24-hour) ONLY when the source',
  'text explicitly states a clock time (e.g. "ore 21", "h 18:30", "alle 20:45");',
  'omit the field otherwise — never guess a time.',
  'Also give "durationMin": the attendance length in whole minutes ONLY when the',
  'source clearly implies it (e.g. "spettacolo di 90 minuti", "tour di 2 ore",',
  'explicit start AND end times). Omit it otherwise — never guess a duration.',
  'Also give "sessions": the concrete dated PROGRAMME inside the event, when the',
  'source lists individual occurrences — a festival\'s separate concert nights, a',
  'run\'s specific show dates, a season\'s dated events. Each item:',
  '{ "date": "YYYY-MM-DD", "time": "HH:MM" (when stated), "title": "<what is on',
  'that date>" (when the programme names it) }. List EVERY dated occurrence the',
  'source gives, in date order; expand an explicit recurrence ("ogni venerdì e',
  'sabato di luglio, ore 21") into its concrete dates within the run. This is how',
  'a months-long umbrella event becomes findable on a specific day, so do not skip',
  'programme detail the source states. Omit the field for a single-date event, or',
  'when the source gives no per-date programme — NEVER invent dates or times.',
  'Also give "kind", the single most consequential field here — it decides which',
  'days the event is findable on:',
  '- "container" — the event happens ONLY on the dates in "sessions" and NOTHING',
  '  happens in between. A concert series, a festival of separate nights, a',
  '  cinema season, a course meeting weekly, a market held on given weekends. If',
  '  someone asks "what is on" on a date between two sessions, this event is NOT',
  '  an answer, so it must never be listed on those days.',
  '- "standalone" — the event genuinely runs across its whole span, every day of',
  '  it. An exhibition open daily for three months, a month-long installation, a',
  '  venue\'s continuous opening. It IS an answer on any day in its span.',
  'Decide by ONE question: on a day between two listed dates, with no session,',
  'can a visitor turn up and experience this event? Yes → "standalone". No →',
  '"container". An exhibition that also runs a few guided tours stays',
  '"standalone" — the tours are highlights inside a run that is open regardless.',
  'A festival whose ONLY content is its dated nights is "container", even when',
  'the source advertises it as one long season.',
  'A single-date event is "standalone". When "sessions" is empty or absent, the',
  'answer is "standalone" — never mark an event a container with no programme to',
  'stand on, or it disappears from the site entirely.',
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
  'Respond with STRICT valid JSON only — no code fences, no backticks around the',
  'JSON envelope. The description STRINGS, however, MUST contain the Markdown',
  'described above: a lead paragraph, then "## [tag] Label" section headings on',
  'their own lines and "- " bullet lists, with real "\\n" newlines between them.',
  'That Markdown inside the strings is required, not a violation. Follow the',
  'shape of this example exactly (note the \\n newlines and the [tags]):',
  '{ "events": [ { "id": "<input id>", "categories": ["<category>", "..."], "titles": { "en": "…", "it": "…", "ru": "…" }, "descriptions": { "en": "Two-time-Grammy pianist Andrea Bacchetti plays a candlelit recital in a Baroque villa — a rare chance to hear a 1772 Guadagnini up close.\\n\\n## [programme] Programme\\n- Beethoven — Romance in F\\n- Kreisler — Liebesleid\\n\\n## [getting-there] Getting there\\nVilla Borzino, Busalla (Genoa); A7 motorway or the Genoa–Arquata rail line.\\n\\n## [tickets] Tickets\\nFree admission, donation welcome.\\n\\n## [when] When\\nFriday 14 August 2026, 21:00.", "it": "<same shape, in Italian, with localized labels>", "ru": "<same shape, in Russian, with localized labels>" }, "address": "…", "time": "HH:MM", "durationMin": 90, "sessions": [ { "date": "YYYY-MM-DD", "time": "HH:MM", "title": "…" } ], "kind": "container"|"standalone", "unusual": true|false, "blocked": true|false } ] }',
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
  // Reject a hallucinated CJK glyph in a Latin/Cyrillic description or title:
  // dropping the item leaves the record unenriched, so it re-generates cleanly.
  if (hasCjk(descriptions) || (titles !== undefined && hasCjk(titles))) return [];
  const address = asNonEmptyString(readProp(value, 'address'));
  const rawTime = asNonEmptyString(readProp(value, 'time'));
  const time = rawTime !== undefined && /^([01]\d|2[0-3]):[0-5]\d$/.test(rawTime) ? rawTime : undefined;
  const rawDur = readProp(value, 'durationMin');
  const durationMin =
    typeof rawDur === 'number' && rawDur >= 15 && rawDur <= 1440 ? Math.round(rawDur) : undefined;
  const sessions = parseSessions(readProp(value, 'sessions'));
  // A container is only meaningful with a programme to stand on: marking one
  // without sessions would leave an event with no days at all, i.e. invisible.
  // Anything the model returns other than the exact word is standalone.
  const kind: EventKind | undefined =
    readProp(value, 'kind') === 'container' && sessions !== undefined ? 'container' : undefined;
  const enrichment: Enrichment = {
    categories,
    descriptions,
    unusual: asBoolean(readProp(value, 'unusual')) === true,
    ...(titles === undefined ? {} : { titles }),
    ...(address === undefined ? {} : { address }),
    ...(time === undefined ? {} : { time }),
    ...(durationMin === undefined ? {} : { durationMin }),
    ...(sessions === undefined ? {} : { sessions }),
    ...(kind === undefined ? {} : { kind }),
    ...(asBoolean(readProp(value, 'blocked')) === true ? { blocked: true } : {}),
  };
  return [[id, enrichment]];
};

/** Why the batches that produced nothing produced nothing, counted by reason.
 *  Read by the run log, so a failing model names itself. */
export const lastEnrichFailures: { reasons: Readonly<Record<string, number>> } = { reasons: {} };

export const makeEnrichEvents =
  (chat: ChatFn) =>
  async (events: readonly PendingEnrich[]): Promise<ReadonlyMap<string, Enrichment>> => {
    const failures: string[] = [];
    const results = await Promise.all(
      chunk(events, ENRICH_BATCH).map(async (batch) => {
        try {
          const reply = await chat(ENRICH_SYSTEM, JSON.stringify({ events: batch }));
          const items = asArray(readProp(extractJson(reply), 'events')) ?? [];
          // An answer that parses to nothing is a failure too, and used to be
          // indistinguishable from a batch that simply had nothing to add.
          if (items.length === 0) failures.push(emptyReason(reply));
          return items.flatMap(parseEnrichment);
        } catch (error: unknown) {
          failures.push(classifyFailure(error));
          return []; // failed batch → events stay enriched:false (AC-2.3)
        }
      }),
    );
    lastEnrichFailures.reasons = tallyFailures(failures);
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
