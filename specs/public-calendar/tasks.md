# Public Calendar Feed — Tasks

- [x] **C1. ICS renderer** — `src/calendar/ics.ts`: escape, fold, all-day vs
  timed VEVENTs, VTIMEZONE, filterEvents. _Req: AC-1.3–1.5, AC-2.x, AC-4.1.
  Tests: `test/ics.test.ts`._
- [x] **C2. Route** — `GET /calendar.ics` in `src/index.ts`, public, cached.
  _Req: AC-1.1–1.2, AC-1.6. Tests: `test/webhook.test.ts`._
- [x] **C3. /calendar command + i18n + help** — origin-derived link.
  _Req: AC-3.1–3.2. Tests: `test/webhook.test.ts`, i18n parity via types._
- [x] **C4. Docs** — README section (subscribe instructions, filters).
- [x] **C5. Green** — `bun test` + `bun run typecheck` clean.
