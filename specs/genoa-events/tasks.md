# Genoa Events Bot — Tasks

Each task references the requirement(s) it satisfies and the test(s) that
verify it. Keep the tree green between tasks (`bun test` + `bun run typecheck`).

- [x] **T1. Scaffold** — package.json (bun scripts), tsconfig (strict),
  wrangler.jsonc (EVENTS KV, AI, cron), .gitignore, .dev.vars.example.
  _Req: AC-8.x. Test: typecheck passes._
- [x] **T2. Domain: EventRecord + normalize/dedupe id + merge** —
  `src/domain/event.ts`. _Req: AC-1.2, AC-1.4. Tests: `test/event.test.ts`
  (normalization, id stability, merge fills gaps only)._
- [x] **T3. Rome clock + date windows** — `src/pipeline/clock.ts`,
  `src/pipeline/windows.ts`. _Req: AC-1.5, AC-3.1–3.5. Tests:
  `test/windows.test.ts` (today/tonight/weekend incl. Sat edge, next14,
  free, multi-day coverage)._
- [x] **T4. KV store: index + records + prune** — `src/pipeline/store.ts`,
  `test/kv-stub.ts` (test double). _Req: AC-1.1, AC-1.5. Tests:
  `test/store.test.ts` (round-trip, prune past, TTL args)._
- [x] **T5. visitgenoa parsing (pure)** — `parseDateRange`, `mapCategories`,
  listing/detail accumulation over HTMLRewriter with HTML fixtures.
  _Req: AC-1.1, AC-1.4. Tests: `test/visitgenoa.test.ts` on
  `test/fixtures/*.html`._
- [x] **T6. tg-public collector** — t.me/s preview → posts (reference
  pattern). _Req: AC-1.1, AC-1.3. Tests: `test/tg-public.test.ts` on fixture._
- [x] **T7. LLM client + tolerant JSON** — Workers AI → Gemini fallback,
  timeout/retry. _Req: AC-2.5, AC-4.6. Tests: `test/llm-client.test.ts`
  (fallback order, fence stripping) with fake fetch/ai._
- [x] **T8. Enrichment + post extraction** — batching, `enriched:false` path.
  _Req: AC-2.1–2.4. Tests: `test/enrich.test.ts` (batch split, unmatched id,
  LLM-fail degradation)._
- [x] **T9. runCollect pipeline** — lock → collect → dedupe/merge → enrich →
  store → prune → log. _Req: AC-1.1–1.3, AC-8.2–8.4. Tests:
  `test/collect-run.test.ts` with fake deps (partial failure, lock busy,
  merge, run-log entry)._
- [x] **T10. i18n RU/EN** — `src/i18n.ts`. _Req: AC-7.3, AC-4.4. Tests:
  `test/i18n.test.ts` (key parity RU/EN, var interpolation)._
- [x] **T11. Rendering** — event lines, category grouping, cards,
  `splitMessage`. _Req: AC-3.1–3.7, AC-6.1. Tests: `test/render.test.ts`._
- [x] **T12. Q&A + plan prompts** — grounding assembly, lang detect, weather
  merge. _Req: AC-4.1–4.4, AC-6.2–6.3. Tests: `test/answer.test.ts`
  (corpus serialization cap, no-events honesty instruction present,
  Cyrillic detection; plan slots + rain bias present)._
- [x] **T13. Settings + saved + reminders** — toggle, dueReminders, digest
  due-matching. _Req: AC-5.1–5.4, AC-6.4–6.5, AC-7.1–7.2. Tests:
  `test/settings.test.ts`, `test/saved.test.ts`._
- [x] **T14. Surprise** — weighted pick. _Req: AC-6.1. Tests:
  `test/surprise.test.ts` (prefers user categories, uniform otherwise,
  injectable rng)._
- [x] **T15. Weather** — Open-Meteo fetch + forecast shaping, graceful fail.
  _Req: AC-6.3. Tests: `test/weather.test.ts` with fake fetch._
- [x] **T16. Bot API delivery** — send/edit/answerCallback/sendChatAction
  wrappers. _Req: AC-4.5, AC-3.7. Tests: covered via render + fake fetch
  smoke in `test/bot-api.test.ts`._
- [x] **T17. Webhook + cron entry** — routing, 401 gate, waitUntil, operator
  gate for /collect, /status. _Req: AC-1.6–1.7, AC-8.1, US-3/4/6/7 wiring.
  Tests: `test/webhook.test.ts` (401, command routing table, non-command →
  Q&A path) with fake deps._
- [x] **T18. Docs** — README (setup, deploy, webhook), .dev.vars.example.
  _Req: operability. Test: n/a (review)._
- [x] **T19. Full green** — `bun test` + `bun run typecheck` clean; tick all
  boxes; update specs if implementation revealed gaps.
- [x] **T20. mentelocale collector** (amendment, design §4.2) — shared
  Italian date parsing (`italian-dates.ts`). _Tests: `test/mentelocale.test.ts`._
- [x] **T21. genovateatro collector** (amendment, design §4.3). _Tests:
  `test/genovateatro.test.ts`._
- [x] **T22. palazzoducale collector** (amendment, design §4.4) — Italian
  month-name dates + venue prefix (`parseItalianDateInfo`). _Tests:
  `test/palazzoducale.test.ts`._
- [x] **T23. portoantico collector** (amendment, design §4.5) — open WP REST
  API (`eventi` CPT + `location-eventi` taxonomy), dates from body text.
  _Tests: `test/portoantico.test.ts`._
