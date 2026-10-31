/**
 * What the model is told. The policy is stated here AND enforced in code
 * (deny-list.ts, parse-holidays.ts): the prompt keeps the answer close, the
 * code makes sure of it.
 */
import { MOTIFS } from './holiday.ts';
import type { Holiday } from './holiday.ts';

export const CALENDAR_SYSTEM = [
  'You keep the holiday calendar of an events website for Italy.',
  'Given today’s date and a horizon date, list the holidays celebrated in Italy whose',
  'festive period touches the days between them, so the site can wear a theme for each.',
  'ALLOWED: secular, cultural, seasonal or folk celebrations people look for events on —',
  'e.g. Halloween, New Year’s Eve (Capodanno), Valentine’s Day (San Valentino),',
  'Carnival (Carnevale) as a folk festival, International Women’s Day (Festa della Donna),',
  'Festa della Musica, Mother’s/Father’s Day, Christmas (Natale) as the festive season of',
  'markets, lights and concerts, and Labour Day (Primo Maggio) with its concerts and outings.',
  'Christmas and the First of May are ALLOWED although one has a religious origin and the',
  'other a political one: everybody celebrates them here.',
  'FORBIDDEN — never list: any day whose primary meaning is a religious observance',
  '(All Saints/Ognissanti, All Souls/Defunti, Easter, Immacolata, Assumption, Epiphany,',
  'patron-saint feasts, Ramadan, Hanukkah…); any military or war commemoration (4 Novembre,',
  'Forze Armate, armistice or victory days, Liberation Day, Republic Day); anything politically',
  'divisive; commerce-only days (Black Friday, Cyber Monday). Nothing hateful, sexual or violent.',
  'For each holiday give:',
  '- "id": a short lowercase English slug without the year, e.g. "halloween";',
  '- "name": { "en", "it", "ru" } — its usual name in English, Italian and Russian;',
  '- "themeFrom", "themeTo": "YYYY-MM-DD", the days the site should look festive, at most',
  '  14 days apart, ending on the holiday itself or its last day;',
  '- "theme": { "accent": "#rrggbb" readable as text on white (contrast ≥ 4.5:1),',
  '  "accentDark": "#rrggbb" readable as text on #121212 (contrast ≥ 4.5:1),',
  `  "motif": one of ${MOTIFS.map((motif) => `"${motif}"`).join(', ')} }.`,
  'If no allowed holiday is near, return an empty list.',
  'Respond with STRICT valid JSON only, no code fences: { "holidays": [ ... ] }',
].join('\n');

export const calendarInput = (today: string, until: string): string => JSON.stringify({ today, until });

export const classifySystem = (holiday: Holiday): string =>
  [
    `You decide which events on an Italian events website belong to ${holiday.name.en}`,
    `(${holiday.name.it}), themed on the site from ${holiday.themeFrom} to ${holiday.themeTo}.`,
    'An event belongs ONLY when it is about the holiday or made for it: a party, show, tour,',
    'workshop, market or activity themed on it or organised for it. Happening on the same',
    'dates is NOT enough — an ordinary concert, exhibition or match on that day does not belong.',
    'Never file under it a political, news, memorial or civic event, whatever its date.',
    'You receive { "events": [ { "id", "title", "text" } ] }.',
    'For each event that belongs, quote as "evidence" the exact words from THAT event\'s own',
    'title or text that tie it to the holiday (e.g. "festa di Halloween", "ghost tour",',
    '"pumpkin carving") — copied character for character, a few words long. An event whose',
    'title and text say nothing about the holiday does not belong: no quote, no membership.',
    'Respond with STRICT valid JSON only, no code fences:',
    '{ "members": [ { "id": "<input id>", "evidence": "<exact words>" } ] }',
    'Use only ids from the input. An empty list is a fine answer.',
  ].join('\n');
