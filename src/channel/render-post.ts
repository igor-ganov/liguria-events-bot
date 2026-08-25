import { CATEGORY_EMOJI, escapeHtml, formatDateSpan } from '../delivery/render.ts';
import { titleOf } from '../domain/event.ts';
import type { CompactEvent } from '../domain/event.ts';
import type { Lang } from '../domain/event.ts';

/** Telegram truncates a photo caption at 1024 characters — a post cut mid-word
 *  by the platform looks like a broken bot. */
const CAPTION_LIMIT = 1024;
const SITE = 'https://dovego.it';

const clip = (text: string, limit: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  const head = flat.slice(0, limit);
  const cut = head.lastIndexOf(' ');
  return flat.length <= limit ? flat : `${cut > 0 ? head.slice(0, cut) : head}…`;
};

/** The site path for a locale: English lives at the root, the others under a
 *  prefix, exactly as the site builds them. */
export const eventUrl = (id: string, lang: Lang): string =>
  lang === 'en' ? `${SITE}/event/${id}/` : `${SITE}/${lang}/event/${id}/`;

export type ChannelPost = Readonly<{ photo: string; caption: string; url: string }>;

/** One event as a channel post: the picture does the work, the caption says
 *  what and when, and the link goes to our page rather than the source — the
 *  point of posting is to be read on the site. */
export const renderPost = (event: CompactEvent, lang: Lang): ChannelPost => {
  const emoji = CATEGORY_EMOJI[event.c[0] ?? 'other'];
  const where = [event.v, event.ct].filter((part) => part !== undefined).at(0) ?? '';
  const head = `${emoji} <b>${escapeHtml(titleOf(event, lang))}</b>`;
  const when = `📅 ${escapeHtml(formatDateSpan(event))}${where === '' ? '' : ` · 📍 ${escapeHtml(where)}`}`;
  const body = escapeHtml(event.d?.[lang] ?? '');
  const url = eventUrl(event.id, lang);
  // The link is part of the caption, so it has to be part of the budget. It
  // was appended after the body had been clipped to fit, and Telegram refused
  // the whole post: "message caption is too long".
  const fixed = [head, when, url].join('\n\n').length + 2;
  const caption = [head, when, clip(body, Math.max(CAPTION_LIMIT - fixed, 0)), url]
    .filter((part) => part !== '')
    .join('\n\n');
  return { photo: event.img ?? '', caption, url };
};
