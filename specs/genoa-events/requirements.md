# Genoa Events Bot — Requirements

## Overview

A Telegram bot that autonomously collects interesting events and activities
happening in Genoa (Italy) from public web sources, normalizes and deduplicates
them, enriches each event with an LLM (category + concise description), stores
the corpus, and lets a user ask free-form questions ("what's on this weekend
for kids?") answered by an LLM grounded strictly on the collected data.

The runtime and architecture mirror the proven `input-collector` project:
a single Cloudflare Worker (free tier) with `fetch()` (Telegram webhook) and
`scheduled()` (cron) entry points, KV for state, Workers AI as the primary LLM
with Gemini as fallback, and a pure, transport-agnostic pipeline built from
injected dependencies.

Out of scope for V1: payments/plans, admin panel, MTProto userbot, inline
mode, Italian UI language (data sources are Italian; UI is RU/EN).

## Actors

- **Visitor/Resident** — any Telegram user chatting with the bot.
- **Operator** — the bot owner (`OWNER_CHAT_ID`); can force collection runs.
- **Cron** — Cloudflare scheduled trigger; collects sources and pushes digests.

## Categories (fixed taxonomy)

`music` · `theatre` · `art` · `food` · `sport` · `family` · `market` ·
`nightlife` · `culture` · `workshop` · `other`

---

## US-1: Automatic event collection

As the operator, I want the bot to collect events from public Genoa sources on
a schedule, so the corpus stays fresh without manual work.

- **AC-1.1** WHEN the cron trigger fires on the collection schedule THE SYSTEM
  SHALL fetch every configured source, parse events, and store new ones.
- **AC-1.2** WHEN a fetched event matches an already-stored event (same
  normalized title + same start date) THE SYSTEM SHALL NOT create a duplicate;
  it SHALL merge missing fields into the stored event instead.
- **AC-1.3** IF a source fails (network error, HTTP ≥ 400, unparseable markup)
  THEN THE SYSTEM SHALL continue with the remaining sources and record the
  failure in the run log; a partial run is a valid run.
- **AC-1.4** WHEN an event is stored THE SYSTEM SHALL persist at least: id,
  title, start date, source, source URL; and when present in the source:
  end date, time, venue, address, price info, raw description, and an
  **image URL** *(added 2026-07-02 for the site's event cards)*.
- **AC-1.8** *(added 2026-07-02)* WHEN the same event is sighted by another
  source THE SYSTEM SHALL keep every source's link (`altLinks`), so event
  cards can reference all origins.
- **AC-1.9 (fuzzy dedupe)** *(added 2026-07-02)* Sources title the same event
  differently, so exact title+date matching misses them. WHEN two stored
  events overlap in dates, come via different links, and share a significant
  title token or venue, THE SYSTEM SHALL ask the LLM whether they are the
  same real-world event (conservative: uncertain = different, bounded pairs
  per run); IF confirmed THEN the records SHALL merge (gaps fill, links and
  categories union, the duplicate record is deleted).
- **AC-1.5** WHEN an event's start date is in the past (before today, Europe/
  Rome) THE SYSTEM SHALL exclude it from storage and from every user-facing
  answer; stored events expire automatically (TTL) after their date passes.
- **AC-1.6** WHEN the operator sends `/collect` THE SYSTEM SHALL run the same
  collection pipeline on demand and reply with a per-source outcome summary
  (fetched / new / merged / failed).
- **AC-1.7** IF a non-operator sends `/collect` THEN THE SYSTEM SHALL reply
  with a friendly not-allowed notice and perform no collection.

## US-2: LLM enrichment — category + description

As a user, I want every event categorized and described in a consistent,
compact way, so lists are scannable and filters work.

- **AC-2.1** *(revised 2026-07-02: events span several categories — a food
  festival with live music is both)* WHEN a new event is stored THE SYSTEM
  SHALL assign **one to three** categories from the fixed taxonomy via the
  LLM, most specific first; the first is the primary category used where a
  single one is needed (grouping, emoji).
- **AC-2.2** WHEN a new event is stored THE SYSTEM SHALL generate a 1–2
  sentence neutral description (what/where/why interesting) in English as the
  canonical stored form.
- **AC-2.3** IF the LLM call fails for an event THEN THE SYSTEM SHALL store the
  event with category `other` and the raw source description, and mark it
  `enriched: false` so a later run can retry.
- **AC-2.4** WHILE enriching a batch THE SYSTEM SHALL send events to the LLM in
  batches (not one call per event) to respect Worker CPU/API budgets.
- **AC-2.5** WHEN Workers AI fails THE SYSTEM SHALL fall back to Gemini; only
  when both fail does AC-2.3 apply.

## US-3: Browse — digest commands

As a user, I want quick commands for common time windows, so I don't have to
type a prompt for the basics.

- **AC-3.1** WHEN a user sends `/today` THE SYSTEM SHALL reply with events
  whose date range covers today (Europe/Rome), grouped by category, each line:
  emoji + title + time/venue when known + link.
- **AC-3.2** WHEN a user sends `/weekend` THE SYSTEM SHALL reply with events
  covering the upcoming (or current, if today is Sat/Sun) Saturday–Sunday.
- **AC-3.3** WHEN a user sends `/tonight` THE SYSTEM SHALL reply with today's
  events starting at 18:00 or later, or marked nightlife/music.
- **AC-3.4** WHEN a user sends `/free` THE SYSTEM SHALL reply with upcoming
  events whose price info marks them free.
- **AC-3.5** WHEN a user sends `/categories` THE SYSTEM SHALL show an inline
  keyboard of the taxonomy; tapping a category SHALL list its upcoming events
  (next 14 days).
- **AC-3.6** IF a window contains no events THEN THE SYSTEM SHALL say so
  explicitly ("nothing collected for …") rather than replying with silence.
- **AC-3.7** WHERE a reply would exceed Telegram's 4096-char message limit THE
  SYSTEM SHALL split it into multiple messages on entry boundaries.

## US-4: Ask anything — grounded Q&A

As a user, I want to write a free-form prompt and get an answer based on the
collected events, so the bot works like a local concierge.

- **AC-4.1** WHEN a user sends a non-command text message THE SYSTEM SHALL
  answer it with the LLM, grounded on the stored upcoming events (next 30
  days) serialized as context.
- **AC-4.2** THE SYSTEM SHALL instruct the LLM to use ONLY the provided events;
  IF the corpus has nothing relevant THEN the answer SHALL say so instead of
  inventing events.
- **AC-4.3** WHEN the answer references an event THE SYSTEM SHALL include its
  source link.
- **AC-4.4** WHEN a user's message language is Russian THE SYSTEM SHALL answer
  in Russian; otherwise in English (settings override wins — see US-7).
- **AC-4.5** WHILE a Q&A request is being processed THE SYSTEM SHALL show a
  progress indication (sendChatAction typing or a status message) and answer
  within the webhook's `waitUntil` window, not synchronously.
- **AC-4.6** IF the LLM fails THEN THE SYSTEM SHALL reply with a friendly error
  and never leave the user without a response.

## US-5: Personal digest subscription

As a user, I want a daily or weekly push of events matching my interests, so I
don't have to remember to ask.

- **AC-5.1** WHEN a user enables the digest in `/settings` THE SYSTEM SHALL
  push a digest at the user's chosen local hour: daily (tomorrow's events) or
  weekly (Friday push covering the weekend).
- **AC-5.2** WHERE the user selected preferred categories THE SYSTEM SHALL
  include only those categories in the pushed digest.
- **AC-5.3** IF the user's digest window has no matching events THEN THE SYSTEM
  SHALL send nothing (silent skip) — no noise.
- **AC-5.4** WHEN a user disables the digest THE SYSTEM SHALL stop pushing
  immediately.

## US-6: Product features (serendipity & planning)

As a user, I want the bot to feel like a local friend, not a database dump.

- **AC-6.1 (Surprise me)** WHEN a user sends `/surprise` (or taps 🎲) THE
  SYSTEM SHALL pick one upcoming event — weighted toward the user's preferred
  categories when set, random otherwise — and present it as a single rich
  card with a "🎲 another one" button.
- **AC-6.2 (Weekend planner)** WHEN a user sends `/plan` THE SYSTEM SHALL
  generate an LLM itinerary for the upcoming weekend (morning/afternoon/
  evening slots per day) from stored events, respecting preferred categories.
- **AC-6.3 (Weather-aware)** WHEN building `/plan` THE SYSTEM SHALL fetch the
  Genoa weekend forecast (Open-Meteo, no key) and instruct the LLM to prefer
  indoor events on rainy slots; IF the forecast fetch fails THEN the plan is
  generated without weather notes (graceful degradation).
- **AC-6.4 (Save + remind)** WHEN a user taps "⭐ save" on an event card THE
  SYSTEM SHALL store it in the user's saved list (`/saved` lists them) and
  the cron SHALL send a reminder the day before the event at ~10:00 local.
- **AC-6.5** WHEN a user taps "⭐ save" on an already-saved event THE SYSTEM
  SHALL unsave it (toggle) and confirm via callback toast.

## US-7: Settings

As a user, I want to control language, digest, and interests.

- **AC-7.1** WHEN a user opens `/settings` THE SYSTEM SHALL show an inline
  menu: language (RU/EN), digest (off/daily/weekly + hour), preferred
  categories (multi-toggle).
- **AC-7.2** WHEN a setting changes THE SYSTEM SHALL persist it per-user and
  confirm in the updated menu message (edit in place, no new messages).
- **AC-7.3** All user-facing strings SHALL come from the i18n table; no
  hardcoded UI text in handlers.

## US-8: Platform & operations (NFR)

- **AC-8.1** The webhook SHALL be authenticated via
  `X-Telegram-Bot-Api-Secret-Token`; requests with a wrong/missing token get
  401 and no processing.
- **AC-8.2** Collection runs SHALL be guarded by a KV lock (TTL) so
  overlapping cron/manual runs never double-store.
- **AC-8.3** Every collection run SHALL append a structured run-log entry
  (per-source counts, failures, duration) readable by the operator via
  `/status`.
- **AC-8.4** The pipeline SHALL be a pure function of injected dependencies
  (collectors, kv, llm, delivery, clock) — unit-testable without network.
- **AC-8.5** Every acceptance criterion above SHALL map to at least one unit
  test over the pure layer; parsers SHALL be tested against stored HTML
  fixtures of the real sources.

## V2 backlog (explicitly out of V1)

- Inline mode (share event cards into any chat).
- 👍/👎 feedback loop → personal ranking model.
- "Hidden gems" tag (LLM flags non-touristy events).
- Italian UI language.
- Trending badge (events gaining sources/mentions).
- Geolocation "near me" filter.
