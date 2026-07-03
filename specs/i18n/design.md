# Trilingual Support — Bot & Data — Design

Satisfies `specs/i18n/requirements.md`. Conventions: typescript-style
(no any/as/null, readonly), pure DI pipeline.

## 1. Types (`src/domain/event.ts`)

```ts
export const LANGS = ['en', 'it', 'ru'] as const;
export type Lang = (typeof LANGS)[number];
export type LocalizedText = Readonly<Record<Lang, string>>;

const localized = (en: string, it?: string, ru?: string): LocalizedText =>
  ({ en, it: it ?? en, ru: ru ?? en });
```

- `EventRecord.description: string` → `descriptions: LocalizedText`.
- `CompactEvent.d?: string` → `d?: LocalizedText`.
- `parseEventRecord` (AC-1.2): read `descriptions` if object; else read the
  legacy `description` string into `localized(str)`. Same tolerant pattern in
  `parseCompact` for `d`.
- `toCompact`: copy `descriptions` → `d` verbatim.
- `mergeDuplicates` / `mergeEvent`: the primary's `descriptions` win; a gap
  (primary lang === fallback of en) fills from the secondary per-language.
  Simplest rule: keep primary.descriptions (already all-3); no per-lang merge
  needed since enrichment always fills all three.

Rejected: separate `descriptionEn/It/Ru` fields — a map keys cleanly by the
`Lang` union and the site indexes it by the active locale.

## 2. Enrichment (`src/llm/enrich.ts`)

- `Enrichment.description: string` → `descriptions: LocalizedText`.
- `ENRICH_SYSTEM` returns per event:
  `{ id, categories:[…], unusual:bool, descriptions:{ en, it, ru } }` —
  "a fresh 1–2 sentence paraphrase in English, Italian and Russian; never copy
  the source; titles/venues are NOT translated (do not include them)."
- `parseEnrichment`: require `descriptions.en` (non-empty); it/ru fall back to
  en. Missing en → skip (event stays enriched:false).
- `ENRICH_BATCH 6 → 4`: three descriptions ≈ 3× tokens; 4 events keeps the
  completion under the 4096 cap (the truncation failure mode we already hit).

## 3. Pipeline (`src/pipeline/collect-run.ts`)

- `toRecord` / retry path write `descriptions` from the enrichment; the
  `enriched:false` fallback uses `localized(rawDescription ?? title)`.
- No other pipeline change; dedupe/fuzzy/merge already treat descriptions as a
  single field (now an object).

## 4. Q&A & plan (`src/llm/answer.ts`)

- Corpus serialization uses `descriptions.en` (neutral grounding); the LLM
  translates facts when answering.
- `answerSystem`: drop the forced language directive; add "Answer in the SAME
  language as the user's question (Russian, Italian or English)." An explicit
  settings language, when not Auto, appends "Always answer in <lang>."
  (AC-4.1).
- `planSystem`: answer in the passed UI `lang` (AC-4.2). `Language` type widens
  to `Lang` (see §5).

## 5. Bot UI (`src/i18n.ts`, `src/pipeline/settings.ts`)

- `Language = 'ru' | 'en'` → `Lang` (`'en'|'it'|'ru'`). `LanguageChoice =
  Lang | 'auto'`.
- `TABLES` gains an `it` column; every `TranslationKey` gets an Italian string
  (types force completeness). Category labels `cat.*` localized to IT.
- `uiLanguage(settings, hint)`: Auto → hint; hint from `language_code`
  (`ru`→ru, `it`→it, else en) via `langHintOf` in `index.ts`.
- `/settings` language menu: Auto / RU / IT / EN (callback `set:lang:it`).
- `render.ts` `renderCard`/`renderList` unchanged except they receive the full
  `EventRecord`/`CompactEvent`; card description picks `descriptions[lang]`.

## 6. Feeds (`src/calendar/ics.ts`, `src/index.ts`)

- `filterFromQuery` also reads `lang` → `Lang` (default en, unknown→en).
- `eventLines` DESCRIPTION uses `d[lang] ?? d.en` (AC-5.1).
- `serveEventsJson` returns records with the full `d` map (AC-5.2); no lang
  param applied to JSON.

## 7. Migration / rollout

Re-enrichment is required (existing records have a string description). After
deploy: wipe `event:*` + `events:index`, run several `/collect` passes
(batch 4, 60-record retry cap). `parseEventRecord` back-compat (AC-1.2) keeps
the bot serving during the transition.

## 8. Traceability

| Req | Design | Tests |
|---|---|---|
| AC-1.x | §1 | event round-trip (legacy string + new map), toCompact |
| AC-2.x | §2 §3 | enrich parse (3 langs, fallback, en-missing skip), batch size |
| AC-3.x | §5 | i18n IT key parity, uiLanguage hint, settings it round-trip |
| AC-4.x | §4 | answerSystem mirror directive, plan lang |
| AC-5.x | §6 | ics lang selection + fallback, events.json carries map |
