# Trilingual Support — Bot & Data — Tasks

Phase B1 — data model & crawler (ship first; site depends on the `d` map):

- [x] **I1. Lang types + LocalizedText** in `domain/event.ts`; `descriptions`
  on EventRecord, `d` map on CompactEvent; tolerant parse (legacy string →
  `{en}`), toCompact, merge. _AC-1.x. Tests: `test/event.test.ts`._
- [x] **I2. Enrichment 3-lang** — prompt returns `descriptions{en,it,ru}` +
  parse w/ en-fallback; `ENRICH_BATCH` 6→4. _AC-2.x. Tests: `test/enrich.test.ts`._
- [x] **I3. Pipeline wiring** — toRecord/retry write `descriptions`; failure
  fallback `localized(raw ?? title)`. _AC-2.2. Tests: `test/collect-run.test.ts`._
- [x] **I4. ICS + events.json lang** — `?lang=` on /calendar.ics (default en),
  events.json carries the map. _AC-5.x. Tests: `test/ics.test.ts`, webhook._
- [x] **I5. Deploy B1 + re-enrich** — wipe KV, several /collect passes; verify
  all events have en/it/ru. _AC-6.2._ Added `POST /rebuild-index` (tick-secret)
  to rebuild `events:index` from stored records after a lost index without
  re-collecting/clobbering enrichment — used to recover when Workers AI hit its
  daily quota mid-re-enrichment. 189 events, 108 genuinely trilingual; the rest
  fall back to en until the next enrichment drains them.

Phase B2 — bot UI & Q&A:

- [ ] **I6. i18n IT column** — add `it` to TABLES, all keys + category labels;
  `Language`→`Lang`. _AC-3.1. Tests: `test/i18n.test.ts` (3-lang parity)._
- [ ] **I7. Settings + hint** — LanguageChoice adds `it`; `/settings` menu +
  callbacks; `langHintOf` ru/it/en. _AC-3.2/3.3. Tests: `test/settings.test.ts`._
- [ ] **I8. Q&A mirror + plan lang** — answerSystem mirrors question language
  (settings overrides); card/list pick `descriptions[lang]`. _AC-4.x. Tests:
  `test/answer.test.ts`, `test/render.test.ts`._
- [ ] **I9. Deploy B2** — setMyCommands unchanged; verify /settings→Italiano,
  IT/RU Q&A, IT digest.

- [ ] **I10. Green** — `bun test` + `bun run typecheck` clean; specs updated.
