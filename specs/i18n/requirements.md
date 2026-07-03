# Trilingual Support (EN / IT / RU) — Bot & Data — Requirements

## Overview

Add Italian and Russian alongside English across the whole system. Two
translation surfaces: **UI chrome** (static strings — bot menus, site labels)
and **event data** (LLM descriptions, translated by the crawler into all three
languages at enrichment time). Source content stays Italian: event **titles
and venues are never translated** (proper nouns); only the generated
description is localized. This spec covers the **bot + data model + crawler**;
the **site** is specified in `liguria-events-site/specs/i18n/`.

Supported languages: `en` (default), `it`, `ru`. English remains the canonical
fallback whenever a translation is missing.

## US-1: Localized event descriptions (data model)

- **AC-1.1** THE SYSTEM SHALL store an event's description as a localized map
  `{ en, it, ru }` instead of a single string.
- **AC-1.2** WHEN reading a stored record written before this change (a plain
  `description` string) THE SYSTEM SHALL treat it as the `en` value and fall
  the other languages back to `en` (no data loss, no migration script).
- **AC-1.3** The compact index and `/events.json` SHALL carry all three
  description languages so the static site can render any locale from one
  fetch. Titles, venues, dates, categories, links are language-agnostic and
  stored once.

## US-2b: Smart title translation (amendment 2026-07-03)

- **AC-2b.1** WHEN enriching an event THE SYSTEM SHALL produce a **display
  title** in each language: translate the descriptive / common-noun parts but
  KEEP proper nouns in their original form (festival & event names, venue
  names, person & brand names). A title that is wholly a proper noun stays
  unchanged in all languages.
- **AC-2b.2** The original source title SHALL remain the canonical `title`
  used for dedupe/id/matching (never translated); display titles are a
  separate localized map that falls back to the original when missing.

## US-2: Crawler translates descriptions (AC-2.6 extension)

- **AC-2.1** WHEN the LLM enriches an event THE SYSTEM SHALL obtain the 1–2
  sentence description in **all three languages in a single call** (no extra
  round-trips), each a fresh paraphrase — never a copy of the source.
- **AC-2.2** IF the LLM returns only some languages THEN the missing ones
  SHALL fall back to `en`; IF `en` itself is missing the event stays
  `enriched:false` for retry (existing AC-2.3 path).
- **AC-2.3** Batch size SHALL be tuned so a three-language batch fits the
  model's completion budget (no truncated JSON — the failure mode fixed
  earlier).

## US-3: Bot UI in three languages

- **AC-3.1** Every bot-facing string SHALL exist in en/it/ru; no hardcoded UI
  text in handlers (extends AC-7.3). Category labels SHALL be localized;
  category *keys* stay stable.
- **AC-3.2** `/settings` language choice SHALL offer Auto / Русский / Italiano
  / English; the chosen language drives all command output and digests.
- **AC-3.3** WHERE language is Auto THE SYSTEM SHALL pick from the Telegram
  client hint: `language_code` starting `ru`→ru, `it`→it, else en.

## US-4: Grounded Q&A mirrors the question language

- **AC-4.1** WHEN a user asks a free-form question THE SYSTEM SHALL instruct
  the LLM to answer **in the same language as the question** (RU/IT/EN),
  grounded on the corpus; an explicit `/settings` language overrides the
  mirror.
- **AC-4.2** The `/plan` itinerary SHALL be produced in the user's UI language
  (settings, else client hint).

## US-5: Localized public feeds

- **AC-5.1** `GET /calendar.ics?lang=<en|it|ru>` SHALL emit event
  descriptions in that language (default `en`); an unknown value falls back
  to `en`. Titles/venues stay original.
- **AC-5.2** `GET /events.json` SHALL return the full localized description
  map unchanged by `lang` (the site needs every language at build time).

## NFR

- **AC-6.1** Every new pure function (localized parse/merge, lang detection,
  fallback resolution, ICS lang selection) SHALL be unit-tested; the existing
  green suite stays green.
- **AC-6.2** Re-enrichment of the live corpus (wipe `event:*` + `events:index`,
  several `/collect` passes) SHALL populate all three languages.
