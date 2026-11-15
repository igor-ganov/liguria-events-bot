// A weekly club stored as one span with no weekday is on, for the site, every
// day from October to April — so "Scacchi in Biblio", which meets on Mondays,
// turned up in Sunday evening's filter. The event's own words say which days
// it meets and at what time; these tests hold the collector to them. Every
// sample is a real record from the live corpus (2026-11-15).
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseIndex, toCompact } from '../src/domain/event.ts';
import type { CompactEvent, EventRecord } from '../src/domain/event.ts';
import { withExactSchedule } from '../src/schedule/exact-schedule.ts';
import { recurrenceIn } from '../src/schedule/recurrence.ts';
import { clockTimesIn } from '../src/schedule/clock-times.ts';
import { weekdayOf } from '../src/schedule/weekdays.ts';

const corpus: readonly CompactEvent[] =
  parseIndex(readFileSync(join(import.meta.dirname, 'fixtures', 'recurring-events.json'), 'utf8')) ?? [];

const live = (title: string): CompactEvent => {
  const found = corpus.find((event) => event.t.startsWith(title));
  assert.ok(found, `fixture ${title}`);
  return found;
};

/** The stored record behind an index entry, as far as the entry tells it. */
const recordOf = (event: CompactEvent): EventRecord => ({
  id: event.id,
  title: event.t,
  startDate: event.s,
  ...(event.e === undefined ? {} : { endDate: event.e }),
  ...(event.h === undefined ? {} : { time: event.h }),
  ...(event.du === undefined ? {} : { durationMin: event.du }),
  ...(event.p === undefined ? {} : { sessions: event.p }),
  ...(event.k === true ? { kind: 'container' as const } : {}),
  categories: event.c,
  descriptions: event.d ?? { en: '', it: '', ru: '' },
  url: event.u,
  source: 'visitgenoa',
  enriched: true,
  addedAt: event.cr ?? 0,
});

const SUNDAY = '2026-11-15';

/** Whether the site would list the event on a day: a container only on its
 *  sessions, anything else on every day of its span. */
const onDay = (event: CompactEvent, day: string): boolean =>
  event.k === true
    ? (event.p ?? []).some((session) => session.date === day)
    : event.s <= day && day <= (event.e ?? event.s);

const fixed = (title: string): CompactEvent => toCompact(withExactSchedule(recordOf(live(title))));

describe('a weekly event is a container of its real weekdays', () => {
  test('Scacchi in Biblio meets every Monday at 15:30, and not on Sunday', () => {
    const before = toCompact(recordOf(live('Scacchi in Biblio')));
    assert.equal(onDay(before, SUNDAY), true, 'the bug: stored as every day');
    const after = fixed('Scacchi in Biblio');
    assert.equal(after.k, true);
    assert.equal(onDay(after, SUNDAY), false);
    const sessions = after.p ?? [];
    assert.equal(sessions.length, 30);
    assert.deepEqual([...new Set(sessions.map((session) => weekdayOf(session.date)))], [1]);
    assert.deepEqual(sessions.at(0), { date: '2026-10-05', time: '15:30' });
    assert.deepEqual(sessions.at(-1), { date: '2027-04-26', time: '15:30' });
    assert.equal(after.s, '2026-10-05');
    assert.equal(after.e, '2027-04-26');
  });

  test('La passione viene creando is on Tuesdays only', () => {
    const after = fixed('La passione viene creando');
    assert.equal(after.k, true);
    assert.equal(onDay(after, SUNDAY), false);
    assert.equal(onDay(after, '2026-11-17'), true);
    assert.deepEqual([...new Set((after.p ?? []).map((session) => weekdayOf(session.date)))], [2]);
  });

  test('Giochiamo insieme is on Tuesdays at 18:00', () => {
    const after = fixed('Giochiamo insieme');
    assert.equal(after.k, true);
    assert.equal(onDay(after, SUNDAY), false);
    assert.ok((after.p ?? []).every((session) => weekdayOf(session.date) === 2 && session.time === '18:00'));
  });

  test('Maglia insieme: a programme without the container flag becomes one', () => {
    const before = live('Maglia insieme');
    assert.equal(before.k, undefined, 'the bug: p without k');
    const after = fixed('Maglia insieme');
    assert.equal(after.k, true);
    assert.equal(onDay(after, SUNDAY), false);
    assert.equal((after.p ?? []).length, 31);
    assert.ok((after.p ?? []).every((session) => weekdayOf(session.date) === 4));
  });

  test('Startup Social Club: alternate Thursdays from 15 January, starting at 18:00', () => {
    const before = live('Startup Social Club');
    assert.equal(before.h, '19:30', 'the bug: the end of "18:00-19:30" stored as the start');
    const after = fixed('Startup Social Club');
    assert.equal(after.h, '18:00');
    assert.equal(after.k, true);
    const dates = (after.p ?? []).map((session) => session.date);
    assert.equal(dates[0], '2026-01-15');
    assert.equal(dates[1], '2026-01-29');
    assert.equal(dates.at(-1), '2026-12-17');
    assert.equal(dates.includes('2026-11-19'), true);
    assert.equal(dates.includes('2026-11-12'), false);
    assert.ok((after.p ?? []).every((session) => session.time === '18:00'));
  });

  test('Aperitivi Felici: "every weekend" against a Thursday-to-Thursday span is not trusted', () => {
    const record = recordOf(live('Aperitivi Felici'));
    assert.deepEqual(withExactSchedule(record), record);
  });
});

describe('recurrenceIn reads the weekdays an event is held on', () => {
  const days = (text: string): readonly number[] | undefined => {
    const found = recurrenceIn(text);
    return found?.kind === 'weekly' ? found.days : undefined;
  };

  test('Italian and English weekly cues', () => {
    assert.deepEqual(days('Ogni martedì, dalle 15:30 alle 18:00'), [2]);
    assert.deepEqual(days('every Tuesday from 6 pm'), [2]);
    assert.deepEqual(days('Tutti i venerdì e sabato, ore 21'), [5, 6]);
    assert.deepEqual(days('On Saturdays and Sundays at 10:00'), [0, 6]);
    assert.deepEqual(days('il sabato e la domenica'), [0, 6]);
    assert.deepEqual(days('dal lunedì al venerdì, 9-13'), [1, 2, 3, 4, 5]);
    assert.deepEqual(days('ogni fine settimana'), [0, 6]);
  });

  test('alternate weeks', () => {
    assert.deepEqual(recurrenceIn('a giovedì alterni, dalle 18 alle 19.30'), { kind: 'weekly', days: [4], every: 2 });
    assert.deepEqual(recurrenceIn('Every other Thursday, 18:00-19:30'), { kind: 'weekly', days: [4], every: 2 });
  });

  test('a weekday of the month', () => {
    assert.deepEqual(recurrenceIn("ogni ultima domenica del mese, dalle 9 alle 18"), {
      kind: 'monthly',
      rules: [{ day: 0, nth: -1 }],
    });
    assert.deepEqual(recurrenceIn('the first Tuesday of the month'), {
      kind: 'monthly',
      rules: [{ day: 2, nth: 1 }],
    });
  });

  test('a dated day, a daily run and opening hours are not a recurrence', () => {
    assert.equal(recurrenceIn('sabato 21 novembre alle 21'), undefined);
    assert.equal(recurrenceIn('on Sunday 22 November at 18:00'), undefined);
    assert.equal(recurrenceIn('dal venerdì 20 al sabato 21 novembre'), undefined);
    assert.equal(recurrenceIn('tutti i giorni dalle 10 alle 19, chiuso il lunedì'), undefined);
    assert.equal(recurrenceIn('Open Tuesday to Sunday; closed on Mondays'), undefined);
  });
});

describe('clockTimesIn tells a start from an end', () => {
  test('ranges, Italian dots, and words around a single time', () => {
    assert.deepEqual(clockTimesIn('dalle 18 alle 19.30'), { starts: ['18:00'], ends: ['19:30'], ranges: [{ start: '18:00', end: '19:30' }] });
    assert.deepEqual(clockTimesIn('Every other Thursday, 18:00-19:30.'), { starts: ['18:00'], ends: ['19:30'], ranges: [{ start: '18:00', end: '19:30' }] });
    assert.deepEqual(clockTimesIn('ore 21'), { starts: ['21:00'], ends: [], ranges: [] });
    assert.deepEqual(clockTimesIn('Friday 14 August 2026, 21:00.'), { starts: ['21:00'], ends: [], ranges: [] });
    assert.deepEqual(clockTimesIn('from 3:30 pm to 5:30 pm'), { starts: ['15:30'], ends: ['17:30'], ranges: [{ start: '15:30', end: '17:30' }] });
    assert.deepEqual(clockTimesIn('fino alle 18'), { starts: [], ends: ['18:00'], ranges: [] });
  });

  test('a date, a year or a price is not a time', () => {
    assert.deepEqual(clockTimesIn('dal 15 gennaio 2026 al 17 dicembre 2026, biglietto 12,50 euro'), { starts: [], ends: [], ranges: [] });
  });
});

describe('a start time is what the text says it is', () => {
  const event = (time: string | undefined, when: string): EventRecord => ({
    id: 'x',
    title: 'Concerto',
    startDate: '2026-11-20',
    ...(time === undefined ? {} : { time }),
    categories: ['music'],
    descriptions: { en: `A concert.\n\n## [when] When\n${when}`, it: '', ru: '' },
    url: 'https://example.org',
    source: 'visitgenoa',
    enriched: true,
    addedAt: 0,
  });

  test('an end time stored as the start is moved to the start', () => {
    assert.equal(withExactSchedule(event('19:30', 'Friday 20 November, 18:00-19:30')).time, '18:00');
  });

  test('a time the text names is left alone', () => {
    assert.equal(withExactSchedule(event('21:00', 'Doors 20:00, concert 21:00')).time, '21:00');
  });

  test('two candidate starts and a third stored: nothing is guessed', () => {
    assert.equal(withExactSchedule(event('19:00', 'Shows at 17:00 and 21:00')).time, '19:00');
  });

  test('a missing start is filled when the text states exactly one', () => {
    assert.equal(withExactSchedule(event(undefined, 'Friday 20 November at 21:00')).time, '21:00');
  });
});

describe('a start time is checked only where the text is unambiguous', () => {
  test('"from 3 to 29 November" is a date range, not three in the morning', () => {
    assert.deepEqual(clockTimesIn('From 3 to 29 November 2026.'), { starts: [], ends: [], ranges: [] });
    const after = fixed('Riccardi 100');
    assert.equal(after.h, '11:00');
  });

  test('a stored start outside the one window the text states is moved into it', () => {
    const before = live('Attività in genovese per tutti i gusti');
    assert.equal(before.h, '18:30', 'the bug: "every Thursday, from 15:30 to 17:30" stored at 18:30');
    assert.equal(fixed('Attività in genovese per tutti i gusti').h, '15:30');
  });

  test('a start twelve hours off is the afternoon the text says', () => {
    const before = live('Genova Magnifica');
    assert.equal(before.h, '07:30', 'the bug: a 19:30 presentation stored at 07:30');
    assert.equal(fixed('Genova Magnifica').h, '19:30');
  });

  test('a vernissage hour is not taken for the start of a month-long exhibition', () => {
    assert.equal(fixed('Lipperi, Oltre il corpo').h, '11:30');
  });

  test('an exhibition whose guided tours are on Wednesdays and Thursdays stays a run', () => {
    const after = fixed('Botteghe e artigiani a Genova');
    assert.equal(after.k, undefined);
  });
});

describe('the weekday an article names is the weekday of the date it names', () => {
  test('Korn on Saturday 21 November 2026, in every language', () => {
    const before = live('Korn');
    assert.match(before.d?.en ?? '', /Sunday 21 November 2026/, 'the bug: the article names the wrong weekday');
    const after = fixed('Korn');
    assert.match(after.d?.en ?? '', /Saturday 21 November 2026/);
    assert.match(after.d?.it ?? '', /[Ss]abato 21 novembre 2026/);
    assert.match(after.d?.ru ?? '', /Суббота 21 ноября 2026/);
    assert.doesNotMatch(`${after.d?.en} ${after.d?.it} ${after.d?.ru}`, /Sunday|[Dd]omenica|Воскресенье/);
  });

  test('Festival diPassaggio: Thursday 26 to Sunday 29 November', () => {
    const after = fixed('Festival diPassaggio 2026');
    assert.match(after.d?.en ?? '', /- Thursday 26 November 2026\n- Friday 27 November 2026\n- Saturday 28 November 2026\n- Sunday 29 November 2026/);
    assert.match(after.d?.ru ?? '', /- Четверг 26 ноября 2026\n- Пятница 27 ноября 2026\n- Суббота 28 ноября 2026\n- Воскресенье 29 ноября 2026/);
  });

  test('case and grammar are kept: "в воскресенье" becomes "в субботу"', () => {
    const record: EventRecord = {
      ...recordOf(live('Korn')),
      descriptions: {
        en: 'On sunday, 21st November at 21:00.',
        it: 'Il concerto è domenica 21 novembre alle 21.',
        ru: 'Концерт пройдёт в воскресенье, 21 ноября.',
      },
    };
    const after = withExactSchedule(record).descriptions;
    assert.equal(after.en, 'On saturday, 21st November at 21:00.');
    assert.equal(after.it, 'Il concerto è sabato 21 novembre alle 21.');
    assert.equal(after.ru, 'Концерт пройдёт в субботу, 21 ноября.');
  });

  test('a date outside the event, such as a past edition, is not touched', () => {
    const record: EventRecord = {
      ...recordOf(live('Korn')),
      descriptions: { en: 'The last tour stopped here on Monday 21 November 2022.', it: '', ru: '' },
    };
    assert.equal(withExactSchedule(record).descriptions.en, record.descriptions.en);
  });
});

describe('a reading is applied only when everything agrees with it', () => {
  const base = recordOf(live('Scacchi in Biblio'));

  test('the two articles reading different habits leave the record alone', () => {
    const record: EventRecord = {
      ...base,
      startDate: '2026-10-03',
      endDate: '2026-11-28',
      descriptions: {
        en: 'A club.\n\n## [when] When\nEvery Saturday, 15:30-17:30',
        it: 'Un club.\n\n## [when] Quando\nIl sabato e la domenica, dalle 15:30 alle 17:30',
        ru: '',
      },
    };
    assert.equal(withExactSchedule(record).kind, undefined);
  });

  test('an opera on every night of its run is a container of those nights', () => {
    const record: EventRecord = {
      ...base,
      title: 'TURANDOT',
      startDate: '2027-03-19',
      endDate: '2027-03-21',
      descriptions: { en: 'Opera.', it: 'Opera.', ru: 'Опера.' },
      sessions: [{ date: '2027-03-19', time: '20:00' }, { date: '2027-03-20', time: '20:00' }, { date: '2027-03-21', time: '15:00' }],
    };
    assert.equal(withExactSchedule(record).kind, 'container');
  });

  test('guided tours inside an exhibition stay highlights of its run', () => {
    const record: EventRecord = {
      ...base,
      title: 'Navigando tra le pagine',
      startDate: '2026-05-16',
      endDate: '2027-02-28',
      descriptions: { en: 'An exhibition.', it: 'Una mostra.', ru: 'Выставка.' },
      sessions: [{ date: '2026-06-11' }, { date: '2026-06-17' }, { date: '2026-07-01' }],
    };
    assert.equal(withExactSchedule(record).kind, undefined);
  });

  test('a repaired record repairs to itself', () => {
    const once = withExactSchedule(recordOf(live('Startup Social Club')));
    assert.deepEqual(withExactSchedule(once), once);
  });
});

describe('"every 15 days" is a fortnight in English too', () => {
  test('Coro incantati: alternate Tuesdays from 13 October', () => {
    const coro: EventRecord = {
      ...recordOf(live('Scacchi in Biblio')),
      title: 'Coro incantati',
      startDate: '2026-10-13',
      endDate: '2027-04-27',
      time: '14:15',
      descriptions: {
        en: 'A choir.\n\n## [when] When\nEvery 15 days, on Tuesdays, from 14:15 to 15:45.',
        it: 'Un coro.\n\n## [when] Quando\nOgni 15 giorni, il martedì, dalle 14:15 alle 15:45.',
        ru: '',
      },
    };
    const dates = (withExactSchedule(coro).sessions ?? []).map((session) => session.date);
    assert.deepEqual(dates.slice(0, 3), ['2026-10-13', '2026-10-27', '2026-11-10']);
    assert.equal(dates.length, 15);
  });
});

describe('hours that are not the event\'s', () => {
  test('a price "at 5 euros" is not five in the morning', () => {
    assert.deepEqual(clockTimesIn('street food at 5 euros per portion, alle 3 persone'), { starts: [], ends: [], ranges: [] });
  });

  test('a ticket sale at 14:00 outside the "When" section does not move the concert', () => {
    const record: EventRecord = {
      ...recordOf(live('Korn')),
      descriptions: {
        en: 'A concert.\n\n## [tickets] Tickets\n- General sale: 24 December 2025, 14:00\n\n## [when] When\n17 September 2027',
        it: 'Un concerto.\n\n## [tickets] Biglietti\n- Vendita: 24 dicembre 2025, 14:00\n\n## [when] Quando\n17 settembre 2027',
        ru: '',
      },
    };
    const { time: _time, ...untimed } = record;
    assert.equal(withExactSchedule(untimed).time, undefined);
  });
});
