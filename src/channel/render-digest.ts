import { escapeHtml } from '../delivery/render.ts';
import { cityNameOf, citySlug } from '../domain/city.ts';
import { digestHeading } from './digest-heading.ts';
import { eventUrl } from './event-url.ts';
import { titleOf } from '../domain/event.ts';
import type { CompactEvent, Lang } from '../domain/event.ts';

const SITE = 'https://dovego.it';

// Localisation data, as in `i18n.ts`: content the channel publishes, not code.
const MORE: Readonly<Record<Lang, string>> = {
  en: 'Everything on today',
  it: 'Tutti gli eventi di oggi',
  ru: 'Все события дня',
};

// The crawler fills the venue with the city's own name often enough to matter,
// and "Milano · Milano" under a heading that already says Milano is noise.
const venueOf = (event: CompactEvent): string | undefined => {
  const venue = event.v ?? '';
  return venue === '' || citySlug(venue) === (event.ct ?? '') ? undefined : venue;
};

const detail = (event: CompactEvent): string =>
  [event.h, venueOf(event)].filter((part) => part !== undefined && part !== '').join(' · ');

const line = (lang: Lang) => (event: CompactEvent): string => {
  const title = `<a href="${eventUrl(event.id, lang)}">${escapeHtml(titleOf(event, lang))}</a>`;
  const rest = detail(event);
  return `• ${title}${rest === '' ? '' : ` — ${escapeHtml(rest)}`}`;
};

const section = (lang: Lang) => (city: string, events: readonly CompactEvent[]): string =>
  [`<b>${escapeHtml(cityNameOf(city) ?? city)}</b>`, ...events.map(line(lang))].join('\n');

/**
 * The day's post: a few things worth doing, grouped by city, each one a link
 * back to its page.
 *
 * A single event per day was one event per day — a channel about whichever
 * listing happened to be soonest. A digest is a reason to open the channel:
 * the reader scans for their own city and finds several answers at once.
 */
export const renderDigest = (
  events: readonly CompactEvent[],
  lang: Lang,
  today: string,
): string => {
  const cities = [...new Set(events.map((event) => event.ct ?? ''))];
  const grouped = cities.map((city) =>
    section(lang)(city, events.filter((event) => (event.ct ?? '') === city)),
  );
  const home = lang === 'en' ? `${SITE}/` : `${SITE}/${lang}/`;
  return [
    `📅 <b>${escapeHtml(digestHeading(today, lang))}</b>`,
    ...grouped,
    `<a href="${home}">${escapeHtml(MORE[lang])}</a>`,
  ].join('\n\n');
};
