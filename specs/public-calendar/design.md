# Public Calendar Feed — Design

Satisfies `specs/public-calendar/requirements.md`.

## 1. Route (AC-1.1, AC-1.2, AC-1.6)

`GET /calendar.ics` handled in `src/index.ts` BEFORE the webhook gate — the
gate applies only to `POST /webhook`. Pipeline: one `readIndex` (the compact
corpus is already pruned to upcoming events) → query-param filter →
`buildIcs` → `Response` with `text/calendar` and `max-age=3600`.

Rejected: serving from records (`event:<id>`) — N KV reads per poll for
fields (description) calendar UIs barely show; the compact index carries
title/dates/time/venue/url/category/free, which is the whole calendar
surface. DESCRIPTION is synthesized from category + URL (AC-1.4).

## 2. Renderer — `src/calendar/ics.ts` (pure, AC-4.1)

```ts
filterEvents(index, {categories?, freeOnly?}) → CompactEvent[]   // AC-2.x
buildIcs(events, nowMs) → string                                  // AC-1.x
```

- `escapeIcsText`: `\` `;` `,` and newlines per RFC 5545 §3.3.11 (AC-1.5).
- `foldIcsLine`: fold at 74 chars, continuation lines start with one space;
  CRLF line endings (AC-1.5).
- All-day events: `DTSTART;VALUE=DATE:<start>` /
  `DTEND;VALUE=DATE:<lastDay + 1>` (AC-1.3).
- Timed events: `DTSTART;TZID=Europe/Rome:<date>T<HHMM>00`, `DTEND` = start
  + 2h default duration; a static `VTIMEZONE` block for Europe/Rome (CET/CEST
  transitions) is embedded once per calendar (AC-1.3).
- `UID: <id>@event-collecter`, `DTSTAMP` from `nowMs` (AC-1.4).
- Header: `X-WR-CALNAME: Genoa Events`, `PRODID`, `VERSION:2.0`.

## 3. Bot discoverability (AC-3.x)

`worker.fetch` passes `url.origin` into `handleUpdate`; `/calendar` replies
`{origin}/calendar.ics` + one filtered example. New i18n keys
`calendar.text`, help gains a `/calendar` line.

## 4. Traceability

| Req | Design § | Tests |
|---|---|---|
| AC-1.1–1.6 | §1 §2 | `test/ics.test.ts`, `test/webhook.test.ts` (route) |
| AC-2.x | §2 filterEvents | `test/ics.test.ts` |
| AC-3.x | §3 | `test/webhook.test.ts` (/calendar reply contains origin) |
| AC-4.1 | §2 | `test/ics.test.ts` |
