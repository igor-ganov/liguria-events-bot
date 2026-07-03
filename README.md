# event-collecter

A Telegram bot that collects interesting events and activities in **Genoa
(Italy)**, categorizes and describes them with an LLM, and answers free-form
questions grounded strictly on the collected corpus. Runs entirely on a
**Cloudflare Worker** (free tier), architecture modeled on the sibling
`input-collector` project.

## What it does

- **Collects** on a cron (3×/day) from six live-verified sources —
  **visitgenoa.it** (official tourism calendar), **mentelocale.it/genova**
  (15-day agenda), **genovateatro.it** (federated theatre agenda),
  **palazzoducale.genova.it** ("in programma" tab), **portoantico.it**
  (open WordPress REST API) and **Teatro Carlo Felice** (opera/ballet/
  symphonic season) — all parsers tested on captured fixtures — plus any
  configured public Telegram channels (`t.me/s/` web preview; the LLM
  extracts dated events from post text; the path for hyper-local grassroots
  events). Evaluated and rejected: GenovaToday (robots.txt explicitly
  prohibits scraping/AI use — not circumvented), Eventbrite (public search
  API removed 2020), TicketOne (anti-bot), Facebook (Graph API auth wall).
- **Deduplicates** by normalized title + start date; re-sightings merge
  missing fields instead of duplicating.
- **Enriches** every event with one category (fixed 11-item taxonomy) and a
  concise description — Workers AI first, Gemini fallback.
- **Answers prompts**: any non-command message becomes a grounded Q&A over
  the upcoming 30 days of events ("куда сходить с детьми в субботу?").

## Commands

| Command | Purpose |
|---|---|
| `/today` `/tomorrow` `/tonight` `/weekend` | Time-window digests, grouped by category |
| `/free` | Free-entry events (30 days) |
| `/categories` | Browse by category (inline keyboard) |
| `/surprise` | 🎲 one random pick, weighted to your interests, with ⭐ save |
| `/plan` | LLM weekend itinerary, **weather-aware** (Open-Meteo) |
| `/saved` | Your ⭐ saved events (reminder arrives the day before at 10:00) |
| `/calendar` | 📆 Link to the **public iCal feed** (see below) |
| `/settings` | Language (RU/EN/auto), digest (daily/weekly + hour), interests |
| `/collect` `/status` | Operator: on-demand run + run log |

Product features beyond the basics: personal category preferences feed the
digest, the surprise pick and the planner; daily/weekly digest push (silent
when empty); day-before reminders for saved events; weather-aware planning
with indoor bias on rainy slots; RU/EN auto-detection per message.

## Public calendar

The whole corpus is exposed as a standards-compliant **iCalendar feed** at
`GET /calendar.ics` — public by design (read-only, no PII), cacheable
(1 hour), subscribable from Google Calendar ("From URL"), Apple Calendar or
Outlook. Timed events carry `Europe/Rome` times; multi-day events appear as
all-day spans. Filters compose:

```
https://<worker>/calendar.ics                      # everything
https://<worker>/calendar.ics?cat=music,art        # categories
https://<worker>/calendar.ics?free=1               # free entry only
https://<worker>/calendar.ics?lang=it              # descriptions in it/ru/en
```

Descriptions are stored per-language (`en`/`it`/`ru`, translated by the LLM at
enrichment); titles and venues stay original Italian. `/events.json` carries
all three so the static site renders any locale from one fetch.

Spec: [`specs/public-calendar/`](specs/public-calendar/).

## Architecture

```
Cloudflare Worker
  fetch()      ──▶ /webhook      : commands/callbacks/Q&A (secret-token gated)
               ──▶ /calendar.ics : public iCal feed (unauthenticated, cached)
  scheduled()  ──▶ hourly cron, Rome-local dispatch:
                     05/11/17 collection · 10:00 reminders · per-user digests
  collectors: visitgenoa + mentelocale + genovateatro + palazzoducale
              (HTMLRewriter) + portoantico (WP REST) + t.me/s channels
  llm:        Workers AI → Gemini 2.5 Flash fallback
  state:      KV — events:index (whole corpus, compact) + event:<id> (TTL)
```

The pipeline is a pure function of injected dependencies (`src/wire.ts`);
specs live in [`specs/genoa-events/`](specs/genoa-events/) (requirements →
design → tasks, with traceability).

## Setup

1. `bun install`
2. Create the KV namespace and paste its id into `wrangler.jsonc`:
   ```
   bun x wrangler kv namespace create EVENTS
   ```
3. Secrets:
   ```
   bun x wrangler secret put BOT_TOKEN
   bun x wrangler secret put WEBHOOK_SECRET
   bun x wrangler secret put GEMINI_API_KEY   # optional fallback
   ```
4. Set `OWNER_CHAT_ID` (and optionally `TG_CHANNELS`) in `wrangler.jsonc`,
   then `bun run deploy`.
5. Point Telegram at the webhook:
   ```
   curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<worker>/webhook&secret_token=<WEBHOOK_SECRET>"
   ```

Local dev: copy `.dev.vars.example` → `.dev.vars`, then `bun run dev`.

## Scripts

| Command | Purpose |
|---|---|
| `bun test` | Unit tests (128, incl. live-captured fixtures) |
| `bun run typecheck` | Type-check worker + tests |
| `bun run dev` | Local Worker (`wrangler dev`) |
| `bun run deploy` | Deploy to Cloudflare |
