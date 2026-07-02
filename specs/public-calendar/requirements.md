# Public Calendar Feed — Requirements

## Overview

The bot's collected corpus is exposed as a **publicly accessible iCalendar
feed** served by the same Worker. Anyone can subscribe from Google Calendar /
Apple Calendar / Outlook via URL — no Telegram account needed. The bot
advertises the link via a `/calendar` command.

Out of scope: HTML calendar page, per-user private feeds, write access.

## US-1: Subscribe to the corpus as a calendar

As anyone with the link, I want a standards-compliant iCal feed of upcoming
Genoa events, so my calendar app shows them automatically.

- **AC-1.1** WHEN a client sends `GET /calendar.ics` THE SYSTEM SHALL respond
  200 with `content-type: text/calendar; charset=utf-8` and a valid
  RFC 5545 `VCALENDAR` containing one `VEVENT` per upcoming indexed event.
- **AC-1.2** The feed SHALL be public: no webhook secret, no auth header
  (read-only data, no PII). All other paths keep their existing gates.
- **AC-1.3** WHERE an event has a known time THE VEVENT SHALL be timed in
  `Europe/Rome` (with a `VTIMEZONE` block); otherwise it SHALL be an all-day
  event spanning startDate..endDate inclusive (iCal `DTEND` exclusive → +1
  day).
- **AC-1.4** Every VEVENT SHALL carry: stable `UID` (event id), `SUMMARY`
  (category emoji + title), `URL` (source link), and when known `LOCATION`
  (venue). `DESCRIPTION` SHALL include the category label and the source URL.
- **AC-1.5** Text values SHALL be escaped per RFC 5545 (backslash, comma,
  semicolon, newline) and lines folded at ≤75 octets.
- **AC-1.6** The response SHALL send `cache-control: public, max-age=3600` —
  calendar apps poll aggressively; KV reads stay bounded.

## US-2: Filtered feeds

As a subscriber, I want to narrow the feed to my interests.

- **AC-2.1** WHEN the query contains `cat=<c1>,<c2>` THE SYSTEM SHALL include
  only events of those categories; unknown category tokens are ignored; if
  none remain valid the full feed is served.
- **AC-2.2** WHEN the query contains `free=1` THE SYSTEM SHALL include only
  free events. Filters compose (AND).

## US-3: Discoverability via the bot

- **AC-3.1** WHEN a user sends `/calendar` THE SYSTEM SHALL reply with the
  subscription URL derived from the webhook request's origin, plus a filtered
  example, localized RU/EN.
- **AC-3.2** `/calendar` SHALL appear in the help text.

## US-4: Public JSON data endpoint (amendment 2026-07-02)

As the static-site build (GitHub Pages UI), I want the corpus as JSON, so the
site can render a calendar and feed without touching KV directly.

- **AC-4.1** WHEN a client sends `GET /events.json` THE SYSTEM SHALL respond
  200 `application/json` with `{ generatedAt, events: CompactEvent[] }` — the
  same compact index that feeds the iCal route, same public/cache semantics
  as AC-1.2/AC-1.6.
- **AC-4.2** The endpoint SHALL honor the same `cat`/`free` query filters
  (AC-2.x) and SHALL send `access-control-allow-origin: *` so browser
  clients can read it too.

## NFR

- **AC-4.1** The ICS renderer SHALL be a pure function over the compact index
  (single KV read per request) with unit tests for escaping, folding, all-day
  vs timed shaping, and filtering.
