// Holidays: an AI job picks the holidays near today and the events that belong
// to them; the code decides what is allowed to reach the site. Every guard is
// a pure function, tested here without a model.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { contrastRatio, parseHex } from '../src/holidays/contrast.ts';
import { deniedReason } from '../src/holidays/deny-list.ts';
import { DEFAULT_PALETTES, parseHolidays } from '../src/holidays/parse-holidays.ts';
import { candidatesFor, classifyInput, parseMembers } from '../src/holidays/candidates.ts';
import { currentHolidays, holidaysDue } from '../src/holidays/store.ts';
import { runHolidays } from '../src/holidays/run-holidays.ts';
import { MOTIFS } from '../src/holidays/holiday.ts';
import { classifySystem } from '../src/holidays/prompts.ts';
import type { Holiday } from '../src/holidays/holiday.ts';
import type { CompactEvent } from '../src/domain/event.ts';
import type { ChatFn } from '../src/llm/client.ts';
import { makeKvStub } from './kv-stub.ts';

const WHITE = '#ffffff';
const DARK = '#121212';
const TODAY = '2026-10-31';

const halloween = {
  id: 'halloween',
  name: { en: 'Halloween', it: 'Halloween', ru: 'Хэллоуин' },
  themeFrom: '2026-10-25',
  themeTo: '2026-11-01',
  theme: { accent: '#b34700', accentDark: '#ff9a3c', motif: 'pumpkin' },
};

describe('contrast', () => {
  test('parses #rrggbb and #rgb, rejects anything else', () => {
    assert.deepEqual(parseHex('#FF8800'), [255, 136, 0]);
    assert.deepEqual(parseHex('#f80'), [255, 136, 0]);
    assert.equal(parseHex('orange'), undefined);
    assert.equal(parseHex('#ff88zz'), undefined);
    assert.equal(parseHex('ff8800'), undefined);
  });

  test('black on white is 21:1, a colour on itself is 1:1', () => {
    assert.equal(Math.round(contrastRatio('#000000', WHITE) ?? 0), 21);
    assert.equal(contrastRatio('#777777', '#777777'), 1);
    assert.equal(contrastRatio('nope', WHITE), undefined);
  });

  test('every default palette meets 4.5:1 on its background', () => {
    for (const motif of MOTIFS) {
      const palette = DEFAULT_PALETTES[motif];
      assert.ok((contrastRatio(palette.accent, WHITE) ?? 0) >= 4.5, `${motif} accent`);
      assert.ok((contrastRatio(palette.accentDark, DARK) ?? 0) >= 4.5, `${motif} accentDark`);
    }
  });
});

describe('deny list', () => {
  test('religious observances are refused in every language', () => {
    assert.ok(deniedReason(['ognissanti']) !== undefined);
    assert.ok(deniedReason(['All Saints’ Day']) !== undefined);
    assert.ok(deniedReason(['Commemorazione dei defunti']) !== undefined);
    assert.ok(deniedReason(['День всех святых']) !== undefined);
    assert.ok(deniedReason(['Pasqua']) !== undefined);
    assert.ok(deniedReason(['Festa dell’Immacolata']) !== undefined);
    assert.ok(deniedReason(['Festa del santo patrono']) !== undefined);
    assert.ok(deniedReason(['Ramadan']) !== undefined);
  });

  test('military and war commemorations are refused', () => {
    assert.ok(deniedReason(['Giornata dell’Unità Nazionale e delle Forze Armate']) !== undefined);
    assert.ok(deniedReason(['4-novembre-2026']) !== undefined);
    assert.ok(deniedReason(['Armistice Day']) !== undefined);
    assert.ok(deniedReason(['Festa della Liberazione']) !== undefined);
    assert.ok(deniedReason(['День Победы']) !== undefined);
  });

  test('commerce-only days are not holidays', () => {
    assert.ok(deniedReason(['Black Friday']) !== undefined);
  });

  test('secular holidays pass, and a word inside another word does not trip it', () => {
    assert.equal(deniedReason(['Halloween', 'Хэллоуин']), undefined);
    assert.equal(deniedReason(['Capodanno', 'New Year’s Eve']), undefined);
    assert.equal(deniedReason(['Carnevale']), undefined);
    assert.equal(deniedReason(['Festa della Donna']), undefined);
    assert.equal(deniedReason(['San Valentino', 'Valentine’s Day']), undefined);
    assert.equal(deniedReason(['Silent night', 'Talented']), undefined);
  });
});

describe('parseHolidays', () => {
  test('a valid Halloween goes through with a stable id', () => {
    const { accepted, rejected } = parseHolidays({ holidays: [halloween] }, TODAY);
    assert.equal(rejected.length, 0);
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0]?.id, 'halloween-2026');
    assert.deepEqual(accepted[0]?.theme, { accent: '#b34700', accentDark: '#ff9a3c', motif: 'pumpkin' });
    assert.equal(accepted[0]?.themeFrom, '2026-10-25');
    assert.equal(accepted[0]?.themeTo, '2026-11-01');
  });

  test('an id that already carries the year is not given it twice', () => {
    const { accepted } = parseHolidays({ holidays: [{ ...halloween, id: 'Halloween 2026' }] }, TODAY);
    assert.equal(accepted[0]?.id, 'halloween-2026');
  });

  test('a religious holiday is rejected with its reason', () => {
    const allSaints = {
      ...halloween,
      id: 'ognissanti',
      name: { en: 'All Saints Day', it: 'Ognissanti', ru: 'День всех святых' },
      themeFrom: '2026-11-01',
      themeTo: '2026-11-01',
    };
    const { accepted, rejected } = parseHolidays({ holidays: [halloween, allSaints] }, TODAY);
    assert.deepEqual(accepted.map((one) => one.id), ['halloween-2026']);
    assert.equal(rejected.length, 1);
    assert.match(rejected[0]?.reason ?? '', /denied/);
  });

  test('an unknown motif becomes none', () => {
    const { accepted } = parseHolidays(
      { holidays: [{ ...halloween, theme: { ...halloween.theme, motif: 'skull' } }] },
      TODAY,
    );
    assert.equal(accepted[0]?.theme.motif, 'none');
  });

  test('colours that are unreadable fall back to the motif palette', () => {
    const { accepted } = parseHolidays(
      { holidays: [{ ...halloween, theme: { accent: '#ffa500', accentDark: '#331100', motif: 'pumpkin' } }] },
      TODAY,
    );
    assert.deepEqual(accepted[0]?.theme, { ...DEFAULT_PALETTES.pumpkin, motif: 'pumpkin' });
  });

  test('colours are lower-cased and #rgb expanded', () => {
    const { accepted } = parseHolidays(
      { holidays: [{ ...halloween, theme: { accent: '#B34700', accentDark: '#FB4', motif: 'pumpkin' } }] },
      TODAY,
    );
    assert.equal(accepted[0]?.theme.accent, '#b34700');
    assert.equal(accepted[0]?.theme.accentDark, '#ffbb44');
  });

  test('a window longer than 14 days, reversed, malformed or not near today is rejected', () => {
    const cases = [
      { ...halloween, themeFrom: '2026-10-01', themeTo: '2026-11-01' },
      { ...halloween, themeFrom: '2026-11-01', themeTo: '2026-10-25' },
      { ...halloween, themeFrom: '31/10/2026', themeTo: '2026-11-01' },
      { ...halloween, themeFrom: '2026-10-01', themeTo: '2026-10-10' },
      { ...halloween, themeFrom: '2026-12-20', themeTo: '2026-12-31' },
    ];
    const { accepted, rejected } = parseHolidays({ holidays: cases }, TODAY);
    assert.equal(accepted.length, 0);
    assert.equal(rejected.length, cases.length);
  });

  test('missing translations borrow the English name; no English name is a rejection', () => {
    const { accepted, rejected } = parseHolidays(
      {
        holidays: [
          { ...halloween, name: { en: 'Halloween' } },
          { ...halloween, id: 'x', name: { it: 'Qualcosa' } },
        ],
      },
      TODAY,
    );
    assert.deepEqual(accepted[0]?.name, { en: 'Halloween', it: 'Halloween', ru: 'Halloween' });
    assert.equal(rejected.length, 1);
  });

  test('the same holiday twice is kept once; garbage is an empty list', () => {
    assert.equal(parseHolidays({ holidays: [halloween, halloween] }, TODAY).accepted.length, 1);
    assert.deepEqual(parseHolidays('nonsense', TODAY), { accepted: [], rejected: [] });
    assert.deepEqual(parseHolidays({ holidays: 'x' }, TODAY), { accepted: [], rejected: [] });
  });

  test('unsafe content is refused', () => {
    const { rejected } = parseHolidays(
      { holidays: [{ ...halloween, id: 'gore-fest', name: { en: 'Gore night', it: 'Gore', ru: 'Gore' } }] },
      TODAY,
    );
    assert.equal(rejected.length, 1);
  });
});

const event = (id: string, s: string, e?: string): CompactEvent => ({
  id,
  t: `Event ${id}`,
  s,
  ...(e === undefined ? {} : { e }),
  c: [],
  u: 'https://example.com',
  d: { en: `Description of ${id} `.repeat(30), it: '', ru: '' },
});

const theHoliday: Holiday = {
  id: 'halloween-2026',
  name: { en: 'Halloween', it: 'Halloween', ru: 'Хэллоуин' },
  themeFrom: '2026-10-25',
  themeTo: '2026-11-01',
  theme: { accent: '#b34700', accentDark: '#ff9a3c', motif: 'pumpkin' },
  events: [],
};

describe('candidates', () => {
  test('only upcoming events whose dates touch the window', () => {
    const index = [
      event('past', '2026-10-26'),
      event('today', '2026-10-31'),
      event('tomorrow', '2026-11-01'),
      event('after', '2026-11-02'),
      event('running', '2026-10-01', '2026-12-01'),
      event('ended', '2026-10-01', '2026-10-30'),
    ];
    assert.deepEqual(
      candidatesFor(theHoliday, index, TODAY).map((one) => one.id),
      ['today', 'tomorrow', 'running'],
    );
  });

  test('the classifier sees id, title and at most 400 characters of English', () => {
    const [line] = classifyInput([event('a', TODAY)]);
    assert.equal(line?.id, 'a');
    assert.equal(line?.title, 'Event a');
    assert.ok((line?.text.length ?? 0) <= 400);
  });

  test('a member counts only with words from its own text that tie it to the holiday', () => {
    const party = { ...event('a', TODAY), t: 'Festa di Halloween al Porto Antico' };
    const talk = { ...event('b', TODAY), t: 'Incontro con un giornalista' };
    const batch = [party, talk];
    assert.deepEqual(
      parseMembers(
        {
          members: [
            { id: 'a', evidence: 'Festa di Halloween' },
            // Named, but the words are not in its text: the model made the tie up.
            { id: 'b', evidence: 'Halloween night' },
            { id: 'zzz', evidence: 'Halloween' },
          ],
        },
        batch,
      ),
      ['a'],
    );
  });

  test('an answer without evidence names no member', () => {
    const batch = [event('a', TODAY), event('b', TODAY)];
    assert.deepEqual(parseMembers({ ids: ['a', 'b'] }, batch), []);
    assert.deepEqual(parseMembers({ members: [{ id: 'a', evidence: '' }] }, batch), []);
    assert.deepEqual(parseMembers('nonsense', batch), []);
  });

  test('the prompt asks for the evidence it is checked against', () => {
    assert.match(classifySystem(theHoliday), /"evidence"/);
    assert.match(classifySystem(theHoliday), /exact words/i);
  });
});

describe('store', () => {
  test('a holiday whose window has passed is not served', () => {
    const payload = { generatedAt: '2026-10-31T08:00:00.000Z', holidays: [theHoliday] };
    assert.equal(currentHolidays(payload, '2026-11-01').holidays.length, 1);
    assert.equal(currentHolidays(payload, '2026-11-02').holidays.length, 0);
  });

  test('due once per Rome day', () => {
    assert.equal(holidaysDue(undefined, TODAY), true);
    assert.equal(holidaysDue({ generatedAt: '2026-10-30T10:00:00.000Z', holidays: [] }, TODAY), true);
    assert.equal(holidaysDue({ generatedAt: '2026-10-31T10:00:00.000Z', holidays: [] }, TODAY), false);
  });
});

describe('runHolidays', () => {
  test('asks for holidays, then classifies events in batches, and stores the result', async () => {
    const kv = makeKvStub();
    const index = Array.from({ length: 45 }, (_, i) => event(`e${i}`, TODAY));
    const prompts: string[] = [];
    const chat: ChatFn = async (system, user) => {
      prompts.push(system);
      if (system.includes('holiday calendar')) return JSON.stringify({ holidays: [halloween] });
      const ids: readonly string[] = JSON.parse(user).events.map((one: { id: string }) => one.id);
      return JSON.stringify({ members: ids.filter((id) => id.endsWith('1')).map((id) => ({ id, evidence: `Event ${id}` })) });
    };
    const result = await runHolidays({ chat, kv, index, today: TODAY, nowIso: '2026-10-31T09:00:00.000Z' });
    assert.equal(prompts.length, 4); // one for the calendar, three batches of 20 + 20 + 5
    assert.deepEqual(result.payload.holidays[0]?.events, ['e1', 'e11', 'e21', 'e31', 'e41']);
    const stored = JSON.parse(kv.data.get('holidays') ?? '{}');
    assert.equal(stored.holidays[0].id, 'halloween-2026');
  });

  test('a failed classification batch costs its events, not the holiday', async () => {
    const kv = makeKvStub();
    const chat: ChatFn = async (system) => {
      if (system.includes('holiday calendar')) return JSON.stringify({ holidays: [halloween] });
      throw new Error('down');
    };
    const result = await runHolidays({ chat, kv, index: [event('a', TODAY)], today: TODAY, nowIso: 'x' });
    assert.equal(result.payload.holidays.length, 1);
    assert.deepEqual(result.payload.holidays[0]?.events, []);
    assert.equal(result.failedBatches, 1);
  });

  test('a failed calendar call keeps the previous payload', async () => {
    const kv = makeKvStub();
    await kv.put('holidays', JSON.stringify({ generatedAt: 'old', holidays: [theHoliday] }));
    const chat: ChatFn = async () => {
      throw new Error('down');
    };
    await assert.rejects(runHolidays({ chat, kv, index: [], today: TODAY, nowIso: 'x' }));
    assert.equal(JSON.parse(kv.data.get('holidays') ?? '{}').generatedAt, 'old');
  });
});
