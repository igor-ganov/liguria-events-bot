// The dates a source's listing gives are not always the dates its own page
// states. visitgenoa listed the Festival della Scienza 14/10/2026–24/02/2027;
// its page says 22 October to 1 November. The page's own words win, but only
// inside what the listing allowed, and a later sighting of the listing does
// not undo them.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { narrowedToRun } from '../src/domain/narrowed-to-run.ts';
import { needsReRead } from '../src/pipeline/needs-re-read.ts';
import { mergeEvent } from '../src/domain/event.ts';
import type { EventRecord } from '../src/domain/event.ts';
import { ENRICH_SYSTEM, parseAnalysis } from '../src/llm/enrich.ts';
import type { Enrichment } from '../src/llm/enrich.ts';
import { runCollect } from '../src/pipeline/collect-run.ts';
import type { CollectDeps } from '../src/pipeline/collect-run.ts';
import { readIndex, writeEventRecord, writeIndex } from '../src/pipeline/store.ts';
import { toCompact } from '../src/domain/event.ts';
import type { StatedRun } from '../src/domain/event.ts';
import { makeKvStub } from './kv-stub.ts';
import type { KvStub } from './kv-stub.ts';

const festival: EventRecord = {
  id: 'e839413789b5',
  title: 'Festival della Scienza 2026',
  startDate: '2026-10-14',
  endDate: '2027-02-24',
  url: 'https://www.visitgenoa.it/en/node/27280',
  source: 'visitgenoa',
  city: 'genova',
  categories: ['culture'],
  descriptions: {
    en: 'The 24th edition.\n\n## [when] When\nFrom Thursday 22 October to Sunday 1 November 2026.',
    it: 'La 24a edizione.',
    ru: '24-й фестиваль.',
  },
  enriched: true,
  enrichVersion: 12,
  addedAt: 1_784_645_169,
};

describe('narrowedToRun', () => {
  test('takes the run the page states when it lies inside the listing', () => {
    const narrowed = narrowedToRun(festival, { start: '2026-10-22', end: '2026-11-01' });
    assert.equal(narrowed.startDate, '2026-10-22');
    assert.equal(narrowed.endDate, '2026-11-01');
    assert.deepEqual(narrowed.statedRun, { start: '2026-10-22', end: '2026-11-01' });
  });

  test('a postponed concert listed for a year is on its one night', () => {
    const narrowed = narrowedToRun(
      { ...festival, startDate: '2026-09-18', endDate: '2027-09-17' },
      { start: '2027-09-17' },
    );
    assert.equal(narrowed.startDate, '2027-09-17');
    assert.equal(narrowed.endDate, undefined);
  });

  test('a run outside the listing is not trusted', () => {
    assert.equal(narrowedToRun(festival, { start: '2026-10-01', end: '2026-11-01' }), festival);
    assert.equal(narrowedToRun(festival, { start: '2026-10-22', end: '2027-06-01' }), festival);
  });

  test('a listing with only a first day learns its last from the page', () => {
    const { endDate: _none, ...oneDay } = festival;
    const narrowed = narrowedToRun(
      { ...oneDay, startDate: '2026-10-22' },
      { start: '2026-10-22', end: '2026-11-01' },
    );
    assert.equal(narrowed.endDate, '2026-11-01');
  });

  test('a container keeps the span of its programme', () => {
    const container: EventRecord = { ...festival, kind: 'container', sessions: [{ date: '2026-10-24' }] };
    assert.equal(narrowedToRun(container, { start: '2026-10-22', end: '2026-11-01' }), container);
  });
});

describe('a stated run against the next sighting', () => {
  test('the listing seen again does not widen the record back', () => {
    const narrowed = narrowedToRun(festival, { start: '2026-10-22', end: '2026-11-01' });
    const { event } = mergeEvent(narrowed, {
      title: 'Festival della Scienza 2026',
      startDate: '2026-10-14',
      endDate: '2027-02-24',
      url: 'https://www.visitgenoa.it/en/node/27280',
      source: 'visitgenoa',
    });
    assert.equal(event.startDate, '2026-10-22');
    assert.equal(event.endDate, '2026-11-01');
  });
});

describe('the model is asked for the run', () => {
  test('the prompt asks for the run the text states, not the dates it was given', () => {
    assert.match(ENRICH_SYSTEM, /"run"/);
    assert.match(ENRICH_SYSTEM, /never copy the input "dates"/i);
  });

  test('a run in the answer is read', () => {
    const [entry] = parseAnalysis({
      id: 'x',
      categories: ['culture'],
      description: 'A festival.',
      run: { start: '2026-10-22', end: '2026-11-01' },
    });
    assert.deepEqual(entry?.[1].run, { start: '2026-10-22', end: '2026-11-01' });
  });

  test('a run that is not dates is dropped', () => {
    const [entry] = parseAnalysis({ id: 'x', categories: ['culture'], description: 'A festival.', run: { start: 'soon' } });
    assert.equal(entry?.[1].run, undefined);
  });

  test('a festival running every day with a few highlights is not a container', () => {
    assert.match(ENRICH_SYSTEM, /highlights/i);
    assert.match(ENRICH_SYSTEM, /every day of its run/i);
  });
});

describe('needsReRead', () => {
  test('a container read before the run and the highlights rule is read again', () => {
    assert.equal(needsReRead({ ...festival, kind: 'container', sessions: [{ date: '2026-10-24' }] }), true);
  });

  test('a span wider than the dates its own article gives is read again', () => {
    assert.equal(needsReRead(festival), true);
  });

  test('a standalone whose article agrees with its span is left alone', () => {
    assert.equal(
      needsReRead({ ...festival, startDate: '2026-10-22', endDate: '2026-11-01' }),
      false,
    );
  });

  test('a programme a source lists date by date is never re-read for it', () => {
    assert.equal(
      needsReRead({ ...festival, kind: 'container', listedProgramme: true, sessions: [{ date: '2026-10-24' }] }),
      false,
    );
  });

  test('a record already read with the current prompt is left alone', () => {
    assert.equal(needsReRead({ ...festival, enrichVersion: 13 }), false);
  });
});

describe('the festival through the pipeline', () => {
  const listing = {
    title: 'Festival della Scienza 2026',
    startDate: '2026-10-14',
    endDate: '2027-02-24',
    url: 'https://www.visitgenoa.it/en/node/27280',
    source: 'visitgenoa',
    city: 'genova',
  };
  const answer = (run: StatedRun | undefined, kind?: 'container'): Enrichment => ({
    categories: ['culture'],
    descriptions: festival.descriptions,
    unusual: false,
    ...(run === undefined ? {} : { run }),
    ...(kind === undefined ? {} : { kind, sessions: [{ date: '2026-10-24' }] }),
  });
  const deps = (kv: KvStub, enrich: ReadonlyMap<string, Enrichment>): CollectDeps => ({
    kv,
    collectors: [async () => ({ source: 'visitgenoa', events: [listing], posts: [], failed: false })],
    extract: async () => [],
    enrich: async () => enrich,
    details: async (raws) => raws,
    judgeSameEvent: async () => [],
    fetchFn: async () => new Response('', { status: 404 }),
    now: () => Date.parse('2026-10-20T10:00:00Z'),
  });

  test('is read again, put on the days its page states, and kept there', async () => {
    const kv = makeKvStub();
    await writeEventRecord(kv, festival, Date.parse('2026-10-20T10:00:00Z'));
    await writeIndex(kv, [toCompact(festival)]);
    await runCollect(deps(kv, new Map([[festival.id, answer({ start: '2026-10-22', end: '2026-11-01' })]])));
    await runCollect(deps(kv, new Map()));
    const [stored] = await readIndex(kv);
    assert.equal(stored?.s, '2026-10-22');
    assert.equal(stored?.e, '2026-11-01');
  });

  test('a festival read as a container of its highlights becomes a run again', async () => {
    const kv = makeKvStub();
    const container: EventRecord = {
      ...festival,
      startDate: '2026-10-22',
      endDate: '2026-11-01',
      kind: 'container',
      sessions: [{ date: '2026-10-22' }, { date: '2026-11-01' }],
    };
    await writeEventRecord(kv, container, Date.parse('2026-10-20T10:00:00Z'));
    await writeIndex(kv, [toCompact(container)]);
    await runCollect(deps(kv, new Map([[festival.id, answer(undefined)]])));
    const [stored] = await readIndex(kv);
    assert.equal(stored?.k, undefined);
  });
  test('is still read again when it may be wrong', async () => {
    // Baglioni's postponed concert stayed listed for the whole year in
    // between: it had left mentelocale's listings, and only what a listing
    // shows was ever read again.
    const kv = makeKvStub();
    const concert: EventRecord = {
      ...festival,
      id: '0c07157ab408',
      title: 'Claudio Baglioni in concerto in piazza San Carlo. Rimandato al 2027',
      startDate: '2026-09-18',
      endDate: '2027-09-17',
      url: 'https://www.mentelocale.it/torino/baglioni.htm',
      source: 'mentelocale',
      descriptions: { ...festival.descriptions, en: 'Postponed.\n\n## [when] When\nFriday 17 September 2027.' },
    };
    await writeEventRecord(kv, concert, Date.parse('2026-10-20T10:00:00Z'));
    await writeIndex(kv, [toCompact(concert)]);
    const asked: string[] = [];
    await runCollect({
      ...deps(kv, new Map([[concert.id, answer({ start: '2027-09-17' })]])),
      collectors: [async () => ({ source: 'mentelocale', events: [], posts: [], failed: false })],
      enrich: async (pending) => {
        asked.push(...pending.map((item) => item.id));
        return new Map([[concert.id, answer({ start: '2027-09-17' })]]);
      },
    });
    assert.deepEqual(asked, [concert.id]);
    const [stored] = await readIndex(kv);
    assert.equal(stored?.s, '2027-09-17');
  });
});
