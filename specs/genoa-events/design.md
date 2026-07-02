# Genoa Events Bot — Design

Satisfies: `specs/genoa-events/requirements.md`. Architecture mirrors the
proven `input-collector` project (Cloudflare Worker, KV, Workers AI + Gemini
fallback, pure DI pipeline) — deviations are called out with reasons.

## 1. Runtime & topology (US-8)

```
Cloudflare Worker (free tier)
  fetch()      ──▶ /webhook  : commands, callbacks, free-text Q&A
                              ack fast → heavy work in ctx.waitUntil
  scheduled()  ──▶ hourly cron (Rome-local dispatch):
                     05/11/17 → collection run
                     10:00    → saved-event reminders
                     per-user → digest push at chosen hour
  collectors: visitgenoa (HTMLRewriter) + t.me/s public channels (HTMLRewriter)
  llm:        Workers AI (llama-3.3-70b) primary → Gemini 2.5 Flash fallback
  weather:    Open-Meteo (no key)
  state:      KV namespace EVENTS
```

- Package runner: `bun`; deploy via `wrangler`. Tests: `bun test` — Bun ships
  a native `HTMLRewriter`, so the collectors' parsing layer is unit-testable
  against stored HTML fixtures without workerd (AC-8.5).
- Webhook auth: `X-Telegram-Bot-Api-Secret-Token` equality check → 401
  otherwise (AC-8.1), same as reference.

### Rejected alternatives

- **D1 (SQLite) instead of KV** — the corpus is small (≲500 upcoming events);
  every query is either a date-window scan (served by one compact index key)
  or LLM-side reasoning over the serialized corpus. D1 would add migrations
  and bindings for no query we actually run.
- **grammY/telegraf** — raw Bot API `fetch` wrappers (reference idiom) keep
  the Worker dependency-free and cold-start-cheap.
- **Vectorize / embeddings RAG** — the whole upcoming corpus fits in one LLM
  context (~30k chars serialized); full-context grounding is simpler and
  strictly more accurate at this scale. Revisit if corpus grows 10×.
- **GenovaToday as a source** — returns 403 to non-browser agents (verified
  2026-07-02); rejected in favor of visitgenoa.it (parses cleanly, verified)
  plus configurable public Telegram channels.

## 2. Domain model (US-1, US-2)

```ts
// src/domain/event.ts
type Category = 'music' | 'theatre' | 'art' | 'food' | 'sport' | 'family'
              | 'market' | 'nightlife' | 'culture' | 'workshop' | 'other';

type EventRecord = Readonly<{
  id: string;             // hash(normTitle + startDate) — dedupe key (AC-1.2)
  title: string;
  startDate: string;      // 'YYYY-MM-DD' (Europe/Rome)
  endDate?: string;       // multi-day ranges
  time?: string;          // 'HH:MM' when the source exposes it
  venue?: string;
  address?: string;
  category: Category;     // AC-2.1
  description: string;    // canonical EN, 1–2 sentences (AC-2.2)
  rawDescription?: string;
  priceInfo?: string;
  free?: boolean;         // derived: price says free / gratuito (AC-3.4)
  url: string;            // source link (AC-4.3)
  source: string;         // 'visitgenoa' | 'tg:<channel>'
  enriched: boolean;      // false → retry enrichment next run (AC-2.3)
  addedAt: number;        // unix seconds
}>;
```

- `id` = 12-hex-char prefix of SHA-256 over
  `normalize(title) + '|' + startDate`, where `normalize` lowercases, strips
  accents/punctuation/whitespace. Same event from two sources collapses; the
  merge keeps existing fields and fills gaps from the newcomer (AC-1.2).
- Dates are calendar dates in Europe/Rome, derived via
  `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' })` — no manual DST
  offsets (`src/pipeline/clock.ts`).

## 3. Storage — KV layout (US-1, US-5, US-6)

| Key | Value | TTL |
|---|---|---|
| `events:index` | `CompactEvent[]` — `{id,t,s,e?,c,f?,v?,h?}` (title, start, end, category, free, venue, time) | none (rewritten each run, pruned of past events per AC-1.5) |
| `event:<id>` | full `EventRecord` | `endOrStart + 3d` |
| `lock:collect` | `'1'` | 600 s (AC-8.2) |
| `runlog` | last 20 `RunLogEntry` | none (AC-8.3) |
| `user:<id>:settings` | `Settings` | none |
| `user:<id>:saved` | `SavedEntry[]` `{eventId, remindedFor?}` | none |
| `user:<id>:chat` | chat id (user enumeration for cron, reference idiom) | none |

One index key serves every browse/Q&A read with a single KV `get`; full
records are fetched per-id only when a card or the Q&A context needs bodies.

## 4. Collectors (US-1)

`Collector = (deps) => Promise<CollectOutcome>` where
`CollectOutcome = { source: string; events: readonly RawEvent[]; failed: boolean }`
— a failed source yields `failed: true` and never throws (AC-1.3).

### 4.1 visitgenoa (`src/collectors/visitgenoa/`)

Verified structure (2026-07-02): listing `https://www.visitgenoa.it/en/events?page=N`
(N = 0..), cards carry `date range → title → categories → /en/node/<id>` link;
detail pages carry venue, time, price, description (no JSON-LD anywhere).

- Fetch pages 0–2 per run; HTMLRewriter handlers only *accumulate strings*
  (thin, untested shell); all interpretation lives in pure, fixture-tested
  functions:
  - `parseDateRange('01/07/2026 - 31/08/2026') → {startDate, endDate}`
  - `mapCategories(['CULTURA','MOSTRE']) → Category` — an Italian→taxonomy
    hint map; the LLM confirms/overrides during enrichment.
- For events *new to the index*, fetch up to `DETAIL_FETCH_CAP = 10` detail
  pages per run (venue/time/price/rawDescription) — bounds Worker subrequests.

### 4.2 mentelocale.it (`src/collectors/mentelocale.ts`)

*Amendment 2026-07-02: second web source added after live verification.*
Listing `https://www.mentelocale.it/genova/eventi/` is server-rendered
(verified; the earlier `genova.mentelocale.it` host no longer resolves):
cards are `div.Evento` with the detail link on the first anchor, title in
`span.Titolo`, date in `span.Date` as `06/07/2026` or
`Dal 09/07/2026 al 12/07/2026`. One page per run (the agenda covers the next
15 days). No category labels on cards → no hint; the LLM categorizes during
enrichment. Shared Italian date parsing lives in
`src/collectors/italian-dates.ts` (handles both `-` and `al` separators).

### 4.3 genovateatro.it (`src/collectors/genovateatro.ts`)

*Amendment 2026-07-02 (2nd pass): promoted from "deferred".* Federated
theatre agenda on the same CMS family as mentelocale: `div.Evento` cards with
`span.Title` / `span.SubTitle` / `span.Abstract` / `span.Date`
(`Dal 02/07/2026 al 26/07/2026`). Static `categoryHint: 'theatre'`; the
abstract feeds `rawDescription`.

### 4.4 palazzoducale.genova.it (`src/collectors/palazzoducale.ts`)

*Amendment 2026-07-02 (2nd pass).* WordPress; the "in programma" tab is
server-rendered via plain GET
(`/eventi/?archive_type=2%23in-programma`, verified: 25 upcoming events).
Cards are `article.exhibition-item`: type (`Evento | Cinema` → hint map),
linked title, `p.exhibition-info` = venue line + Italian-month date line
(`01 lug 2026 — 03 lug 2026, ore 21:30`) parsed by `parseItalianDateInfo`
(months gen..dic, `ore HH:MM` time, prefix = venue).

### 4.5 portoantico.it (`src/collectors/portoantico.ts`)

*Amendment 2026-07-02 (3rd pass): recovered from "rejected".* The HTML site
has no listing, but the WordPress REST API is open: custom post type
`eventi` (~1500 records) at `/wp-json/wp/v2/eventi` plus a `location-eventi`
taxonomy for venues. Event date/time are parsed from the post body text
("Martedì 21 luglio 2026 – ore 21.30") via `parseItalianDateInfo` (full month
names). Two requests per run (`_fields`-trimmed, newest 50 posts); posts with
no parseable date (venue marketing) are skipped; past dates are pruned by the
pipeline (AC-1.5).

Source verification log:
- GenovaToday → 403 is deliberate policy: robots.txt prohibits scraping and
  AI/LLM use without written permission (Citynews, EU DSM Art. 4 opt-out).
  Technically bypassable via a browser User-Agent — **rejected on legal
  grounds, do not circumvent**; ask Citynews for permission if ever needed.
- `smart.comune.genova.it/eventi` → 404, and the root exposes no agenda; the
  Comune's public events channel is visitgenoa.it (§4.1), already covered.
- `genova.mentelocale.it` host → DNS dead, use `www.mentelocale.it/genova/`.

### 4.6 Teatro Carlo Felice (`src/collectors/carlofelice.ts`)

*Amendment 2026-07-02 (4th pass).* Genoa's opera house — opera, ballet,
symphonic concerts, a category the other sources barely carry. Season
homepage is an Elementor slider (`a.swiper-slide-inner` →
`.elementor-slide-heading` title + `.elementor-slide-description` date);
dates use full Italian months and a shared-month range grammar
(`Dal 16 al 25 ottobre 2026`, `Dall'11 al 13 dicembre 2026`) parsed by
`parseSeasonDate`. robots.txt allows crawling (only `/wp-admin/`), no TDM
opt-out, no llms.txt. `categoryHint: 'music'`; the LLM refines (opera →
music+theatre). Slides repeat — deduped by href.

Rejected in this pass: **Eventbrite** — the public event-search API was
removed Feb 2020 (only by-id / by-venue / by-org you own remains), so
city-wide search is impossible; **TicketOne** — anti-bot wall (robots times
out), concerts largely duplicate Porto Antico; **Facebook** — public event
data is behind the Graph API auth wall, automated access breaches ToS.

### 4.7 Public Telegram channels (`src/collectors/tg-public.ts`)

Reference `public-web.ts` pattern verbatim: `t.me/s/<channel>` preview via
HTMLRewriter → posts. Channels come from env `TG_CHANNELS` (JSON array,
operator-configurable; e.g. `aluhaevents` = Aluha/Balena Festival promoter).
Posts are *not* structured events; the LLM extracts zero-or-more events from
each post batch. Freshness window is 180 days, not days — event promoters
announce months ahead then go quiet, so what gates a post is the *event's*
date (LLM-dropped when past), not the post's age; re-extraction is idempotent
via dedupe. This is also the path for hyper-local grassroots events (a
neighbourhood show, a Pro Loco sagra) that never reach the big aggregators —
add the organiser's public channel to `TG_CHANNELS`.

## 5. LLM layer (US-2, US-4, US-6)

`src/llm/client.ts` — one JSON-mode chat helper: Workers AI
`@cf/meta/llama-3.3-70b-instruct-fp8-fast` primary, Gemini `gemini-2.5-flash`
fallback with timeout + bounded retries (reference idiom, AC-2.5). Tolerant
JSON extraction (strip code fences) in a pure, tested function.

- `enrichEvents(batch)` — one call per ≤15 events (AC-2.4): returns
  `{id, category, description}[]`; unmatched ids → `enriched:false` (AC-2.3).
- `extractFromPosts(posts)` — one call per ≤20 posts: returns RawEvents with
  dates resolved relative to `today` passed in the prompt.
- `answerQuestion(question, corpus, lang)` — grounded Q&A (AC-4.1/2/3):
  system prompt forbids inventing events, requires source URLs, answers in
  `lang` (AC-4.4 — detected from message by Cyrillic heuristic, settings
  override wins).
- `buildPlan(corpus, forecast?, prefs, lang)` — weekend itinerary
  (AC-6.2/6.3): morning/afternoon/evening slots, indoor bias on rain slots.

## 6. Pipeline (US-1..US-6) — pure, DI (AC-8.4)

```ts
// src/pipeline/collect-run.ts
type CollectDeps = Readonly<{
  kv: KvLike; collectors: readonly Collector[];
  enrich: EnrichFn; extract: ExtractFn;
  now: () => number; log: (e: RunLogEntry) => Promise<void>;
}>;
runCollect(deps): Promise<RunSummary>   // lock → collect → normalize →
                                        // dedupe/merge → enrich → store →
                                        // prune index → unlock → log
```

- `src/pipeline/dedupe-candidates.ts` + `src/llm/same-event.ts` + 
  `src/domain/merge-duplicates.ts` *(amendment 2026-07-02, AC-1.9)* — fuzzy
  cross-source dedupe, three phases inside `runCollect`: (1) certain merges —
  index entries sharing a url (resurrected duplicates) merge without a model
  call; (2) scored candidates — date-overlapping pairs ranked by title-token
  Jaccard ×4 + same-start ×2 + same-end + same-venue, threshold 2, top-20 per
  run; (3) a conservative LLM judge confirms pairs, the older record absorbs
  the newer (gaps fill, links/categories union) and the loser is deleted.
  Collection maps sightings by url back onto survivors so merged duplicates
  never resurrect.
- `src/pipeline/windows.ts` — pure date-window math over the index:
  `today / tonight (≥18:00 or nightlife|music) / weekend (Sat–Sun, current if
  today∈{Sat,Sun}) / next14 / next30 / free` (AC-3.x). An event covers a day
  when `startDate ≤ day ≤ (endDate ?? startDate)`.
- `src/pipeline/saved.ts` — toggle + `dueReminders(saved, index, todayRome)`:
  entries whose `startDate = tomorrow` and `remindedFor ≠ startDate` (AC-6.4).
- `src/pipeline/settings.ts` — `{language, digest: off|daily|weekly,
  digestHour, categories: Category[]}` (US-7).

## 7. Delivery & UX (US-3..US-7)

`src/delivery/bot-api.ts` — sendMessage(HTML), editMessageText,
answerCallbackQuery, sendChatAction. `src/delivery/render.ts` — pure:

- event line: `{emoji} <a href>title</a> — date, time?, venue?, (free?)`;
  digest = category-grouped lines; `splitMessage(text, 4096)` splits on entry
  boundaries (AC-3.7), fixture-tested.
- Event card (surprise/saved): title, description, when/where/price, buttons
  `[⭐ save/unsave] [🎲 another]` (AC-6.1/6.4/6.5).
- Callback data: `cat:<category>`, `sv:<eventId>`, `sur`, `set:*` — all
  ≤64 bytes.
- i18n: `src/i18n.ts` RU/EN table, `t(key, lang, vars)` (AC-7.3).

## 8. Cron dispatch (US-1, US-5, US-6)

Hourly `0 * * * *`; `scheduled()` computes the Rome hour once, then:

1. hour ∈ {5, 11, 17} → `runCollect` (AC-1.1).
2. hour = 10 → reminders for every user (AC-6.4).
3. every hour → digest push for users whose `digestHour` matches and mode
   matches (daily = every day covering tomorrow; weekly = Friday covering
   the weekend), category-filtered, silent when empty (AC-5.1–5.3).

## 9. Webhook dispatch (US-3, US-4, US-6, US-7)

`/start /help /today /tomorrow /tonight /weekend /free /categories /surprise
/plan /saved /settings /collect /status` — commands answer from the index
synchronously-ish; `/plan`, Q&A, and `/collect` ack + `ctx.waitUntil` with
progress (AC-4.5). Non-command text → Q&A (AC-4.1). Unknown callback → toast.

## 10. Config

`wrangler.jsonc`: KV binding `EVENTS`, `ai` binding, cron `0 * * * *`;
vars: `OWNER_CHAT_ID`, `TG_CHANNELS`, `SOURCE_PAGES`; secrets: `BOT_TOKEN`,
`WEBHOOK_SECRET`, `GEMINI_API_KEY` (optional).

## 11. Traceability

| Req | Design § | Tests |
|---|---|---|
| AC-1.x | §2 §3 §4 §6 | dedupe/merge, parseDateRange, runCollect with fake deps |
| AC-2.x | §5 §6 | enrich batching, fallback order, tolerant JSON |
| AC-3.x | §6 windows, §7 render | window math, grouping, splitMessage |
| AC-4.x | §5 §9 | prompt grounding assembly, lang detection |
| AC-5.x | §6 settings, §8 | digest due-matching, silent-empty |
| AC-6.x | §5 §6 saved, weather | surprise weighting, plan assembly, dueReminders |
| AC-7.x | §7 i18n | settings round-trip, i18n key coverage |
| AC-8.x | §1 §3 §6 | lock semantics, run-log append, 401 path |
