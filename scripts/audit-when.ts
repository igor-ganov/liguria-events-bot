/**
 * Audit: where an event's stored when-data (s, e, h, p, k) disagrees with its
 * own text. Reads a /events.json snapshot, prints counts by kind with samples,
 * and the same counts after the deterministic repair (withExactSchedule) is
 * applied to every entry — the projection of what the next run stores.
 *
 *   bun scripts/audit-when.ts <events.json> [today]
 *
 * The index carries the articles, not the sources' raw text, so this reads
 * what a visitor reads: the "When" section first, then the whole article.
 */
import { parseIndex, toCompact } from '../src/domain/event.ts';
import type { CompactEvent, EventRecord } from '../src/domain/event.ts';
import { statedRecurrence, withExactSchedule } from '../src/schedule/exact-schedule.ts';
import { clockTimesIn } from '../src/schedule/clock-times.ts';
import { recurrenceIn } from '../src/schedule/recurrence.ts';
import type { Recurrence } from '../src/schedule/recurrence.ts';
import { spanAgrees } from '../src/schedule/occurrences.ts';
import { WEEKDAY_WORD, daysBetween, fold, weekdayNamed, weekdayOf } from '../src/schedule/weekdays.ts';
import { parseJson, readProp } from '../src/util/json.ts';

type Finding = Readonly<{ kind: string; event: CompactEvent; note: string }>;

const MONTHS = [
  ['gen', 'jan'], ['feb', 'feb'], ['mar', 'mar'], ['apr', 'apr'], ['mag', 'may'], ['giu', 'jun'],
  ['lug', 'jul'], ['ago', 'aug'], ['set', 'sep'], ['ott', 'oct'], ['nov', 'nov'], ['dic', 'dec'],
] as const;
const MONTH_WORD =
  '(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|january|february|march|april|may|june|july|august|september|october|november|december)';
const DATED = new RegExp(`(?:(${WEEKDAY_WORD})\\s+)?(\\d{1,2})(?:°|º|st|nd|rd|th)?\\s+${MONTH_WORD}(?:\\s+(\\d{4}))?`, 'g');

const recordOf = (event: CompactEvent): EventRecord => ({
  id: event.id,
  title: event.t,
  startDate: event.s,
  ...(event.e === undefined ? {} : { endDate: event.e }),
  ...(event.h === undefined ? {} : { time: event.h }),
  ...(event.p === undefined ? {} : { sessions: event.p }),
  ...(event.k === true ? { kind: 'container' as const } : {}),
  categories: event.c,
  descriptions: event.d ?? { en: '', it: '', ru: '' },
  url: event.u,
  source: '',
  enriched: true,
  addedAt: event.cr ?? 0,
});

const WHEN = /## \[when\][^\n]*\n([\s\S]*?)(?=\n## |$)/;
const whenText = (event: CompactEvent): string =>
  [event.d?.en, event.d?.it].map((article) => WHEN.exec(article ?? '')?.[1] ?? '').join('\n');

const monthOf = (word: string): number => MONTHS.findIndex(([it, en]) => word.startsWith(it) || word.startsWith(en)) + 1;

/** The year that puts a day-and-month inside (or nearest to) the span. */
const yearFor = (event: CompactEvent, month: number, day: number): string => {
  const end = event.e ?? event.s;
  const candidates = [Number(event.s.slice(0, 4)), Number(end.slice(0, 4))].map((year) =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  );
  return candidates.find((iso) => iso >= event.s && iso <= end) ?? candidates[0] ?? '';
};

type Dated = Readonly<{ iso: string; weekday?: number; text: string }>;

const datesIn = (event: CompactEvent): readonly Dated[] =>
  [...fold(whenText(event)).matchAll(DATED)].flatMap((match) => {
    const [month, day] = [monthOf(match[3] ?? ''), Number(match[2])];
    if (month === 0 || day < 1 || day > 31) return [];
    const iso = match[4] === undefined
      ? yearFor(event, month, day)
      : `${match[4]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const weekday = weekdayNamed(match[1] ?? '');
    return Number.isNaN(Date.parse(iso)) ? [] : [{ iso, text: match[0], ...(weekday === undefined ? {} : { weekday }) }];
  });

const firstRecurrence = (event: CompactEvent): Recurrence | undefined =>
  statedRecurrence(recordOf(event));

const weekdaysOfSessions = (event: CompactEvent): readonly number[] =>
  [...new Set((event.p ?? []).map((session) => weekdayOf(session.date)))].toSorted();

const describe = (recurrence: Recurrence): string =>
  recurrence.kind === 'weekly'
    ? `weekly days=${recurrence.days.join(',')} every=${recurrence.every}`
    : `monthly ${recurrence.rules.map((rule) => `${rule.nth}:${rule.day}`).join(',')}`;

const weekdayFindings = (event: CompactEvent): readonly Finding[] => {
  const recurrence = firstRecurrence(event);
  if (recurrence === undefined) return [];
  const end = event.e ?? event.s;
  const long = daysBetween(event.s, end) >= 7;
  const opening = recurrence.kind === 'weekly' && recurrence.days.length > 3;
  // Open every day of the week is what a run already says.
  const everyDay = recurrence.kind === 'weekly' && recurrence.days.length === 7;
  const ruleDays = recurrence.kind === 'weekly' ? recurrence.days : recurrence.rules.map((rule) => rule.day);
  const offDay = event.k === true && weekdaysOfSessions(event).some((day) => !ruleDays.includes(day));
  const note = `${describe(recurrence)} s=${event.s} e=${end} k=${event.k ?? '-'} p=${event.p?.length ?? 0}`;
  return [
    ...(long && !opening && event.k !== true
      ? [{ kind: spanAgrees(recurrence, event.s, end) ? 'weekday:recurring-stored-as-run' : 'weekday:recurring-span-disagrees', event, note }]
      : []),
    ...(long && opening && !everyDay && event.k !== true ? [{ kind: 'weekday:opening-days-not-expanded', event, note }] : []),
    ...(offDay ? [{ kind: 'weekday:sessions-off-the-stated-weekdays', event, note }] : []),
  ];
};

const dateFindings = (event: CompactEvent): readonly Finding[] => {
  const dates = datesIn(event);
  const end = event.e ?? event.s;
  const outside = dates.filter((date) => date.iso < event.s || date.iso > end);
  const wrongWeekday = dates.filter((date) => date.weekday !== undefined && date.weekday !== weekdayOf(date.iso));
  const single = event.e === undefined && dates.length > 0 && !dates.some((date) => date.iso === event.s);
  return [
    ...(outside.length > 0 ? [{ kind: 'date:named-outside-stored-span', event, note: `s=${event.s} e=${end} text=${outside.map((d) => d.text).join(' | ')}` }] : []),
    ...(wrongWeekday.length > 0 ? [{ kind: 'date:weekday-and-date-disagree-in-text', event, note: wrongWeekday.map((d) => `${d.text}→${d.iso}`).join(' | ') }] : []),
    ...(single ? [{ kind: 'date:single-day-not-the-named-day', event, note: `s=${event.s} text=${dates.map((d) => d.text).join(' | ')}` }] : []),
  ];
};

const timeFindings = (event: CompactEvent): readonly Finding[] => {
  const times = clockTimesIn(whenText(event));
  const note = `h=${event.h ?? '-'} starts=${times.starts.join(',')} ends=${times.ends.join(',')}`;
  const h = event.h;
  if (times.starts.length + times.ends.length === 0) return [];
  if (h === undefined) return times.starts.length === 1 ? [{ kind: 'time:missing-but-stated', event, note }] : [];
  if (times.starts.includes(h)) return [];
  if (times.ends.includes(h)) return [{ kind: 'time:end-stored-as-start', event, note }];
  return [{ kind: times.starts.length === 1 ? 'time:differs-from-the-one-stated' : 'time:differs-several-stated', event, note }];
};

const structureFindings = (event: CompactEvent, today: string): readonly Finding[] => {
  const recurrence = firstRecurrence(event);
  const ruleDays = recurrence?.kind === 'weekly' ? recurrence.days : recurrence?.rules.map((rule) => rule.day) ?? [];
  // A container is on its sessions, which the weekday checks above cover.
  const listedToday = event.k !== true && event.s <= today && today <= (event.e ?? event.s);
  return [
    ...(event.p !== undefined && event.k !== true ? [{ kind: 'structure:programme-without-container-flag', event, note: `p=${event.p.length} s=${event.s} e=${event.e ?? '-'}` }] : []),
    ...(listedToday && ruleDays.length > 0 && !ruleDays.includes(weekdayOf(today))
      ? [{ kind: 'structure:listed-today-but-text-says-other-weekdays', event, note: `today=${today} days=${ruleDays.join(',')}` }]
      : []),
  ];
};

const audit = (events: readonly CompactEvent[], today: string): readonly Finding[] =>
  events.flatMap((event) => [
    ...weekdayFindings(event),
    ...dateFindings(event),
    ...timeFindings(event),
    ...structureFindings(event, today),
  ]);

const report = (label: string, findings: readonly Finding[], samples: number): string => {
  const kinds = [...new Set(findings.map((finding) => finding.kind))].toSorted();
  const events = new Set(findings.map((finding) => finding.event.id)).size;
  return [
    `## ${label}: ${findings.length} findings on ${events} events`,
    ...kinds.flatMap((kind) => {
      const of = findings.filter((finding) => finding.kind === kind);
      return [
        `### ${kind}: ${of.length}`,
        ...of.slice(0, samples).map((finding) => `- ${finding.event.t.slice(0, 70)} [${finding.event.id}] ${finding.note}`),
      ];
    }),
  ].join('\n');
};

const [file = 'events.json', today = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
const parsed = parseJson(await Bun.file(file).text());
const events = parseIndex(JSON.stringify(readProp(parsed, 'events') ?? parsed)) ?? [];
const before = audit(events, today);
const repaired = events.map((event) => toCompact(withExactSchedule(recordOf(event))));
const after = audit(repaired, today);
const changed = repaired.filter((event, i) => JSON.stringify(event) !== JSON.stringify(toCompact(recordOf(events[i] ?? event))));
const samples = Number(process.env.SAMPLES ?? 8);
process.stdout.write(
  [
    `# When-data audit — ${file}, ${events.length} events, today ${today}`,
    report('Before', before, samples),
    `Repair changes ${changed.length} events.`,
    report('Projected after', after, samples),
    '',
  ].join('\n\n'),
);
