/**
 * What the site never dresses up for, whatever the model says: religious
 * observances, military and war commemorations, politically divisive dates,
 * commerce-only days, and anything unsafe for a general audience.
 *
 * Latin-script terms match whole words (so "lent" never trips on "silent");
 * Cyrillic ones are stems, since Russian inflects the noun (Victory Day
 * puts "victory" in the genitive). They are data, not prose: the contract
 * carries a Russian name, and a refused holiday must be caught in it too.
 * Both sides are compared accent-free and lower-case.
 */

const RELIGIOUS = [
  'all saints', 'ognissanti', 'tutti i santi', 'all souls', 'defunti', 'dei morti',
  'day of the dead', 'dia de los muertos', 'easter', 'pasqua', 'pasquetta', 'immacolata',
  'immaculate', 'assumption', 'assunzione', 'patron', 'patrono', 'patronale', 'ramadan',
  'eid', 'hanukkah', 'yom kippur', 'rosh hashanah', 'diwali', 'pentecost', 'pentecoste',
  'epiphany', 'epifania', 'corpus domini', 'ash wednesday', 'ceneri', 'good friday',
  'venerdi santo', 'lent', 'quaresima', 'santo stefano', 'saint stephen', 'st stephen',
  'advent', 'avvento', 'jubilee', 'giubileo',
] as const;

const MILITARY = [
  'forze armate', 'armed forces', 'unita nazionale', 'national unity', '4 novembre',
  'armistice', 'armistizio', 'victory day', 'vittoria', 'liberazione', 'liberation',
  'remembrance', 'veterans', 'republic day', 'repubblica', 'memorial day', 'caduti',
  'military', 'militare', 'war', 'guerra', 'resistenza',
] as const;

const POLITICAL = ['election', 'elezioni', 'referendum'] as const;

const COMMERCE = ['black friday', 'cyber monday', 'singles day'] as const;

const UNSAFE = ['gore', 'porn', 'porno', 'sex', 'sexy', 'nazi', 'hate', 'kill', 'massacre', 'strage'] as const;

const CYRILLIC_STEMS = [
  'всех свят', 'поминовен', 'пасх', 'непорочн', 'успени', 'рамадан', 'покровител',
  'вооруженн', 'побед', 'перемир', 'освобожден', 'республик', 'черная пятниц',
] as const;

const GROUPS: readonly Readonly<{ reason: string; terms: readonly string[] }>[] = [
  { reason: 'religious', terms: RELIGIOUS },
  { reason: 'military', terms: MILITARY },
  { reason: 'political', terms: POLITICAL },
  { reason: 'commerce-only', terms: COMMERCE },
  { reason: 'unsafe', terms: UNSAFE },
];

/** Accent-free, lower-case, punctuation folded to single spaces, padded. */
const normalize = (text: string): string =>
  ` ${text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;

const wholeWord =
  (haystack: string) =>
  (term: string): boolean =>
    haystack.includes(normalize(term));

const stem =
  (haystack: string) =>
  (term: string): boolean =>
    haystack.includes(normalize(term).trim());

/** Why these names (any language, ids included) are refused, or undefined. */
export const deniedReason = (texts: readonly string[]): string | undefined => {
  const haystack = normalize(texts.join(' | '));
  const group = GROUPS.find(({ terms }) => terms.some(wholeWord(haystack)));
  if (group !== undefined) return group.reason;
  return CYRILLIC_STEMS.some(stem(haystack)) ? 'russian-term' : undefined;
};
