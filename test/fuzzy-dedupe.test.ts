// AC-1.9 — fuzzy cross-source dedupe: candidates, judge parsing, record merge.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  certainDuplicates,
  dedupeCandidates,
  significantTokens,
} from '../src/pipeline/dedupe-candidates.ts';
import { makeJudgeSameEvent } from '../src/llm/same-event.ts';
import { mergeDuplicates } from '../src/domain/merge-duplicates.ts';
import type { ChatFn } from '../src/llm/client.ts';
import type { CompactEvent, EventRecord } from '../src/domain/event.ts';

const compact = (
  overrides: Partial<CompactEvent> & Pick<CompactEvent, 'id' | 't' | 's' | 'u'>,
): CompactEvent => ({ c: ['other'], ...overrides });

const fuoriA = compact({
  id: 'a',
  t: 'FuoriFormato 26. Festival internazionale di danza contemporanea e videodanza',
  s: '2026-06-30',
  e: '2026-07-03',
  u: 'https://www.visitgenoa.it/en/node/27181',
});
const fuoriB = compact({
  id: 'b',
  t: 'FuoriFormato Festival',
  s: '2026-06-30',
  e: '2026-07-03',
  u: 'https://www.genovateatro.it/eventi/2025-2026/comune/fuoriformato-festival.htm',
});
const unrelated = compact({
  id: 'z',
  t: 'Sagra del pesto a Rapallo',
  s: '2026-07-01',
  u: 'https://www.mentelocale.it/z.htm',
});

describe('significantTokens', () => {
  test('drops stopwords, short words and numbers', () => {
    assert.deepEqual(
      [...significantTokens('FuoriFormato 26. Festival internazionale di danza')].sort(),
      ['fuoriformato'],
    );
  });
  test('drops the generic event vocabulary two unrelated sagre share', () => {
    assert.deepEqual([...significantTokens('Sagra del raviolo con musica')].sort(), ['raviolo']);
  });
});

describe('a word that half the city uses is not a name', () => {
  // Measured on the live corpus: of 172 pairs above the threshold, the top of
  // the list was "MILANO CUP" against "TORNEI CLUB MILANO", ten JAZZMI
  // concerts against each other, and every event at Castello D'Albertis
  // against every other. What they share is a town, a season and a venue —
  // words that appear in dozens of titles and name none of them.
  const many = (n: number, make: (index: number) => string) =>
    Array.from({ length: n }, (_, index) =>
      compact({
        id: `m${index}`,
        t: make(index),
        s: '2026-11-08',
        ct: 'milano',
        u: `https://x/m${index}`,
      }),
    );

  test('a festival brand on twenty concerts stops counting as evidence', () => {
    const nights = many(20, (index) => `Concerto ${index} | JAZZMI 2026`);
    assert.deepEqual(dedupeCandidates(nights), []);
  });

  test('a word two events share is still evidence', () => {
    // The same shape, but the word is theirs: two sources on one sagra.
    const pair = [
      ...many(18, (index) => `Concerto ${index} | JAZZMI 2026`),
      compact({ id: 'f1', t: 'Sagra del Fagiolo a Lamon', s: '2026-11-08', ct: 'belluno', u: 'https://x/f1' }),
      compact({ id: 'f2', t: 'A Tavola nel Feltrino: il Fagiolo', s: '2026-11-08', ct: 'belluno', u: 'https://x/f2' }),
    ];
    const found = dedupeCandidates(pair);
    assert.equal(found.length, 1);
    assert.deepEqual([found[0]?.a.id, found[0]?.b.id], ['f1', 'f2']);
  });
});

describe('the vocabulary a listing shares with every other listing', () => {
  // A museum in Prato runs "Visita con Degustazione" and "Visita della Poesia"
  // on the same afternoon. They shared one word — "visita" — and that word was
  // the whole of both titles once the rest was filtered, which scored them 8.0
  // and put eight such pairs at the top of a 60-pair cap. The real
  // cross-source duplicates never got a judge call at all.
  test('a guided tour is not a name', () => {
    assert.deepEqual([...significantTokens('Visita con Degustazione')], []);
    assert.deepEqual([...significantTokens('Visita guidata al Castello')].sort(), ['castello']);
    assert.deepEqual([...significantTokens('Laboratorio per bambini')], []);
    assert.deepEqual([...significantTokens('Aperitivo in mostra')], []);
  });

  test('what makes a listing itself survives', () => {
    assert.deepEqual([...significantTokens('Aperitivo in mostra "Mimmo Rotella 1945-2005"')].sort(), [
      'mimmo',
      'rotella',
    ]);
  });

  test('two tours of one museum on one afternoon are not a pair', () => {
    const tour = (id: string, t: string) =>
      compact({ id, t, s: '2026-09-12', h: '16:00', ct: 'prato', v: 'Museo Pecci', u: `https://x/${id}` });
    assert.deepEqual(dedupeCandidates([tour('t1', 'Visita con Degustazione'), tour('t2', 'Visita della Poesia')]), []);
    assert.deepEqual(certainDuplicates([tour('t1', 'Visita con Degustazione'), tour('t2', 'Visita della Poesia')]), []);
  });
});

describe('dedupeCandidates', () => {
  test('pairs overlapping events sharing a significant token, skips unrelated', () => {
    const pairs = dedupeCandidates([fuoriA, fuoriB, unrelated]);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0]?.a.id, 'a');
    assert.equal(pairs[0]?.b.id, 'b');
  });
  test('skips pairs already linked via altLinks', () => {
    const linked = { ...fuoriA, l: [{ source: 'genovateatro', url: fuoriB.u }] };
    assert.deepEqual(dedupeCandidates([linked, fuoriB]), []);
  });
  test('urlDuplicates flags shared-url pairs as certain merges', async () => {
    const { urlDuplicates } = await import('../src/pipeline/dedupe-candidates.ts');
    const linked = { ...fuoriA, l: [{ source: 'genovateatro', url: fuoriB.u }] };
    const pairs = urlDuplicates([linked, fuoriB, unrelated]);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0]?.b.id, 'b');
    assert.deepEqual(urlDuplicates([fuoriA, unrelated]), []);
  });
  // A venue plus a date is not evidence: an opera house runs a different
  // opera every night. Pairing on that alone flooded the cap with false
  // positives and starved the real cross-source duplicates of a judge call.
  test('does not pair same-venue same-date events with nothing in the titles', () => {
    const v1 = compact({ id: 'v1', t: 'Rigoletto', s: '2026-07-05', u: 'https://x/1', v: 'Teatro Carlo Felice' });
    const v2 = compact({ id: 'v2', t: 'Tosca', s: '2026-07-05', u: 'https://y/2', v: 'Teatro Carlo Felice' });
    assert.deepEqual(dedupeCandidates([v1, v2]), []);
  });
  // What the reader photographed on 2026-09-07: four cards for the Sagra del
  // Fuoco di Recco — a flag-raising, a blessing, a vespers and the fireworks —
  // under one photo, one body of text and one day. The titles of a programme
  // share no word with each other, so the pre-filter could not see them at
  // all, and nothing was ever asked about them.
  test('one poster, one town, one day: a programme is at least worth asking about', () => {
    const poster = 'https://www.mentelocale.it/repository/contenuti/horizontal/131_half.jpg?rand=99';
    const row = (id: string, t: string, h: string) =>
      compact({ id, t, s: '2026-09-07', h, ct: 'genova', img: poster, u: `https://x/${id}` });
    const pairs = dedupeCandidates([
      row('p1', 'Alzabandiera del Comitato e dei sette Quartieri', '21:00'),
      row('p2', 'Benedizione dei bambini e omaggio floreale alla Madonna', '10:00'),
    ]);
    assert.equal(pairs.length, 1);
  });

  test('a tour poster in another town is a different night', () => {
    // Gianni Morandi plays ten cities off one press photo. Same image, and
    // nothing else the same.
    const poster = 'https://ticketmaster/x_TABLET_LANDSCAPE_LARGE_16_9.jpg';
    const rimini = compact({ id: 't1', t: 'Gianni Morandi', s: '2026-09-10', ct: 'rimini', img: poster, u: 'https://x/1' });
    const brindisi = compact({ id: 't2', t: 'Gianni Morandi', s: '2026-09-12', ct: 'brindisi', img: poster, u: 'https://x/2' });
    assert.deepEqual(dedupeCandidates([rimini, brindisi]), []);
  });

  test('two towns are two events, however alike the names', () => {
    // Oktoberfest is held in Genova and in Padova on the same weekend, and a
    // tour plays a different town every night. One happening does not move.
    const beer = (id: string, ct: string) =>
      compact({ id, t: `Oktoberfest ${ct}`, s: '2026-09-19', ct, u: `https://x/${id}` });
    assert.deepEqual(dedupeCandidates([beer('o1', 'genova'), beer('o2', 'padova')]), []);
  });

  test('but a missing town does not block a pair', () => {
    // The geocoder does not place everything, and our gap must not become a
    // reason to keep two listings of one evening apart.
    const placed = compact({ id: 'p1', t: 'Oktoberfest Genova 2026', s: '2026-09-19', ct: 'genova', u: 'https://x/p1' });
    const { ct: _ct, ...unplaced } = compact({ id: 'p2', t: 'Oktoberfest a Genova', s: '2026-09-19', ct: 'genova', u: 'https://x/p2' });
    assert.equal(dedupeCandidates([placed, unplaced]).length, 1);
  });

  test('caps the output', () => {
    assert.equal(dedupeCandidates([fuoriA, fuoriB], 0).length, 0);
    assert.equal(dedupeCandidates([fuoriA, fuoriB]).length, 1);
  });
});

// Every record below was read out of the live corpus on 2026-09-10, where all
// four sat in the Liguria feed as separate cards.
describe('certainDuplicates', () => {
  const quasiVisit = compact({
    id: 'q1',
    t: 'Quasi notte bianca 2026',
    s: '2026-09-12',
    h: '18:00',
    ct: 'genova',
    v: 'Luoghi vari in città',
    u: 'https://www.visitgenoa.it/en/node/27382',
  });
  const quasiMente = compact({
    id: 'q2',
    t: 'Quasi Notte Bianca a Genova 2026 con musica, artisti di strada e street food',
    s: '2026-09-12',
    h: '18:00',
    ct: 'genova',
    v: 'Piazza delle Erbe',
    u: 'https://www.mentelocale.it/genova/136209-quasi-notte-bianca-a-genova-2026.htm',
  });
  const rotellaMente = compact({
    id: 'r1',
    t: 'Aperitivo e dj set con visita guidata alla mostra su Mimmo Rotella',
    s: '2026-09-09',
    h: '18:30',
    ct: 'genova',
    v: 'Palazzo Ducale',
    u: 'https://www.mentelocale.it/genova/136187-aperitivo-e-dj-set.htm',
  });
  const rotellaDucale = compact({
    id: 'r2',
    t: 'Aperitivo in mostra "Mimmo Rotella 1945-2005"',
    s: '2026-09-09',
    h: '18:30',
    ct: 'genova',
    u: 'https://palazzoducale.genova.it/evento/aperitivo-in-mostra-mimmo-rotella-1945-2005/',
  });

  test('one happening listed by two sites at the same hour needs no judge', () => {
    // Both pairs reached the judge for months and both came back "different" —
    // on a prompt that was shown neither the hour nor the city. A model's
    // caution is not a rule, and this is the rule: same town, same day, same
    // minute, one title inside the other.
    const pairs = certainDuplicates([quasiVisit, quasiMente, rotellaMente, rotellaDucale]);
    assert.deepEqual(
      pairs.map((pair) => [pair.a.id, pair.b.id]),
      [
        ['q1', 'q2'],
        ['r1', 'r2'],
      ],
    );
  });

  test('a venue named in both titles is the venue talking, not the event', () => {
    // Castello D'Albertis runs a dozen unrelated things; its name inside both
    // titles is the only thing they share, and merging on it would delete a
    // real event.
    const secret = compact({
      id: 'c1',
      t: "I passaggi segreti di Castello D'Albertis",
      s: '2026-09-12',
      h: '18:00',
      ct: 'genova',
      v: "Castello D'Albertis",
      u: 'https://x/1',
    });
    const yoga = compact({
      id: 'c2',
      t: "Yoga d'estate a Castello D'Albertis",
      s: '2026-09-12',
      h: '18:00',
      ct: 'genova',
      v: "Castello D'Albertis",
      u: 'https://y/2',
    });
    assert.deepEqual(certainDuplicates([secret, yoga]), []);
  });

  test('the same name on another day is another occurrence', () => {
    const later = { ...quasiMente, id: 'q3', s: '2026-09-13' };
    assert.deepEqual(certainDuplicates([quasiVisit, later]), []);
  });

  test('an unstated hour is not a match', () => {
    // Two listings that both omit the time say nothing about each other.
    const { h: _a, ...visitNoHour } = quasiVisit;
    const { h: _b, ...menteNoHour } = quasiMente;
    assert.deepEqual(certainDuplicates([visitNoHour, menteNoHour]), []);
  });
});

describe('makeJudgeSameEvent', () => {
  test('returns only confirmed pairs, tolerates junk verdicts', async () => {
    const chat: ChatFn = async () =>
      JSON.stringify({ pairs: [{ i: 0, same: true }, { i: 1, same: false }, { i: 99, same: true }] });
    const confirmed = await makeJudgeSameEvent(chat)([
      { a: fuoriA, b: fuoriB, score: 4 },
      { a: fuoriA, b: unrelated, score: 2 },
    ]);
    assert.equal(confirmed.length, 1);
    assert.equal(confirmed[0]?.b.id, 'b');
  });
  test('the judge is shown what makes a duplicate obvious', async () => {
    // It used to be handed a title, a date range and a venue. Two sites
    // describing one night out differ in exactly those three and agree on
    // everything it was never shown: the hour, the town, the photo and the
    // opening line of the text.
    const sent: string[] = [];
    const chat: ChatFn = async (_system, user) => {
      sent.push(user);
      return JSON.stringify({ pairs: [] });
    };
    const a = compact({
      id: 'j1',
      t: 'Quasi notte bianca 2026',
      s: '2026-09-12',
      h: '18:00',
      ct: 'genova',
      u: 'https://www.visitgenoa.it/en/node/27382',
      img: 'https://visitgenoa/poster.jpg',
      d: { en: 'The Quasi Notte Bianca event returns for its second edition.', it: '', ru: '' },
    });
    const b = compact({
      id: 'j2',
      t: 'Quasi Notte Bianca a Genova 2026 con musica',
      s: '2026-09-12',
      h: '18:00',
      ct: 'genova',
      u: 'https://www.mentelocale.it/genova/136209.htm',
      img: 'https://visitgenoa/poster.jpg',
      d: { en: 'The Quasi Notte Bianca event returns to Genova for its second edition.', it: '', ru: '' },
    });
    await makeJudgeSameEvent(chat)([{ a, b, score: 6 }]);
    const payload = sent.join('');
    assert.match(payload, /18:00/);
    assert.match(payload, /genova/);
    assert.match(payload, /second edition/);
    assert.match(payload, /"poster":\s*"same"/);
    assert.match(payload, /visitgenoa\.it/);
  });

  test('a failing chat confirms nothing (conservative)', async () => {
    const chat: ChatFn = async () => {
      throw new Error('down');
    };
    assert.deepEqual(await makeJudgeSameEvent(chat)([{ a: fuoriA, b: fuoriB, score: 4 }]), []);
  });
});

describe('mergeDuplicates', () => {
  const older: EventRecord = {
    id: 'a',
    title: 'FuoriFormato 26',
    startDate: '2026-06-30',
    endDate: '2026-07-03',
    categories: ['theatre'],
    descriptions: { en: 'LLM summary.', it: 'Sintesi.', ru: 'Сводка.' },
    url: 'https://www.visitgenoa.it/en/node/27181',
    source: 'visitgenoa',
    enriched: true,
    addedAt: 100,
  };
  const newer: EventRecord = {
    id: 'b',
    title: 'FuoriFormato Festival',
    startDate: '2026-06-30',
    categories: ['music', 'theatre'],
    descriptions: { en: 'Other summary.', it: 'Altro.', ru: 'Другое.' },
    venue: 'Teatro della Tosse',
    image: 'https://img/x.jpg',
    url: 'https://www.genovateatro.it/x.htm',
    source: 'genovateatro',
    enriched: true,
    addedAt: 200,
  };
  test('older stays primary; gaps fill; links and categories union', () => {
    const merged = mergeDuplicates(newer, older);
    assert.equal(merged.id, 'a');
    assert.equal(merged.descriptions.en, 'LLM summary.'); // primary's descriptions win
    assert.equal(merged.venue, 'Teatro della Tosse');
    assert.equal(merged.image, 'https://img/x.jpg');
    assert.deepEqual(merged.categories, ['theatre', 'music']);
    // The merged-away source keeps its cover image on its link, so it can still
    // contribute a photo to the multi-source gallery.
    assert.deepEqual(merged.altLinks, [
      { source: 'genovateatro', url: 'https://www.genovateatro.it/x.htm', image: 'https://img/x.jpg' },
    ]);
  });

  test('re-merging an image-bearing sighting fills an older image-less link', () => {
    // The primary already links this source but without a photo (merged before
    // per-source images existed). A fresh sighting of the same url carries one.
    const primary: EventRecord = {
      ...older,
      altLinks: [{ source: 'genovateatro', url: 'https://www.genovateatro.it/x.htm' }],
    };
    const freshSighting: EventRecord = {
      ...newer,
      id: 'c',
      url: 'https://www.genovateatro.it/x.htm',
      source: 'genovateatro',
      image: 'https://img/fresh.jpg',
      addedAt: 300,
    };
    const merged = mergeDuplicates(primary, freshSighting);
    const link = merged.altLinks?.find((l) => l.url === 'https://www.genovateatro.it/x.htm');
    assert.equal(link?.image, 'https://img/fresh.jpg');
  });
});
