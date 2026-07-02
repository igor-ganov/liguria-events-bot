/**
 * Pure rendering (design §7): compact events → Telegram HTML. Splitting
 * respects entry boundaries (AC-3.7).
 */
import { CATEGORIES } from '../domain/event.ts';
import type { Category, CompactEvent, EventRecord } from '../domain/event.ts';
import { t } from '../i18n.ts';
import type { TranslationKey } from '../i18n.ts';
import type { Language } from '../pipeline/settings.ts';

export const TELEGRAM_MESSAGE_LIMIT = 4096;

export const CATEGORY_EMOJI: Readonly<Record<Category, string>> = {
  music: '🎵',
  theatre: '🎭',
  art: '🖼',
  food: '🍝',
  sport: '🏃',
  family: '👨‍👩‍👧',
  market: '🛍',
  nightlife: '🌙',
  culture: '🏛',
  workshop: '🛠',
  other: '✨',
};

const categoryKey = (category: Category): TranslationKey => `cat.${category}`;

export const categoryLabel = (category: Category, lang: Language): string =>
  t(categoryKey(category), lang);

export const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const MONTH_DAY = /^\d{4}-(\d{2})-(\d{2})$/;

const shortDate = (isoDate: string): string => {
  const match = MONTH_DAY.exec(isoDate);
  return match === null ? isoDate : `${match[2]}.${match[1]}`;
};

export const formatDateSpan = (event: CompactEvent): string => {
  const span =
    event.e === undefined ? shortDate(event.s) : `${shortDate(event.s)}–${shortDate(event.e)}`;
  return event.h === undefined ? span : `${span}, ${event.h}`;
};

export const renderEventLine = (event: CompactEvent): string => {
  const parts = [
    formatDateSpan(event),
    ...(event.v === undefined ? [] : [escapeHtml(event.v)]),
    ...(event.f === true ? ['free'] : []),
  ];
  return `• <a href="${event.u}">${escapeHtml(event.t)}</a> — ${parts.join(', ')}`;
};

/** Category-grouped digest body (AC-3.1); category order = taxonomy order. */
export const renderGrouped = (events: readonly CompactEvent[], lang: Language): string =>
  CATEGORIES.flatMap((category) => {
    const matching = events.filter((event) => event.c === category);
    return matching.length === 0
      ? []
      : [
          `${CATEGORY_EMOJI[category]} <b>${escapeHtml(categoryLabel(category, lang))}</b>\n` +
            matching.map(renderEventLine).join('\n'),
        ];
  }).join('\n\n');

export const renderList = (
  headerKey: TranslationKey,
  events: readonly CompactEvent[],
  lang: Language,
): string =>
  events.length === 0
    ? t('empty.window', lang)
    : `<b>${t(headerKey, lang)}</b>\n\n${renderGrouped(events, lang)}`;

/** Rich single-event card (AC-6.1). */
export const renderCard = (event: EventRecord, lang: Language): string => {
  const emoji = CATEGORY_EMOJI[event.category];
  const when =
    (event.endDate === undefined
      ? shortDate(event.startDate)
      : `${shortDate(event.startDate)}–${shortDate(event.endDate)}`) +
    (event.time === undefined ? '' : `, ${event.time}`);
  const where = [event.venue, event.address].filter(
    (part): part is string => part !== undefined,
  );
  const lines = [
    `<b>${escapeHtml(event.title)}</b>`,
    `${emoji} ${escapeHtml(categoryLabel(event.category, lang))} · ${when}`,
    ...(where.length === 0 ? [] : [`📍 ${escapeHtml(where.join(', '))}`]),
    ...(event.priceInfo === undefined
      ? event.free === true
        ? ['💶 free']
        : []
      : [`💶 ${escapeHtml(event.priceInfo)}`]),
    '',
    escapeHtml(event.description),
    '',
    `<a href="${event.url}">→ ${escapeHtml(event.source)}</a>`,
  ];
  return lines.join('\n');
};

/** Split on line boundaries under the Telegram limit (AC-3.7). */
export const splitMessage = (
  text: string,
  limit = TELEGRAM_MESSAGE_LIMIT,
): readonly string[] => {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    const chunks =
      line.length > limit
        ? Array.from({ length: Math.ceil(line.length / limit) }, (_, i) =>
            line.slice(i * limit, (i + 1) * limit),
          )
        : [line];
    for (const piece of chunks) {
      if (current === '') {
        current = piece;
      } else if (current.length + 1 + piece.length <= limit) {
        current = `${current}\n${piece}`;
      } else {
        parts.push(current);
        current = piece;
      }
    }
  }
  if (current !== '') parts.push(current);
  return parts;
};
