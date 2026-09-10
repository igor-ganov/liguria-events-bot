import { placeLabel } from '../delivery/place-label.ts';
import { regionOfCity } from '../domain/region.ts';
import { t } from '../i18n.ts';
import { titleOf } from '../domain/event.ts';
import type { CompactEvent } from '../domain/event.ts';
import type { Language } from '../pipeline/settings.ts';

/** Three names and a count is a notification; four is a wall of text on a
 *  lock screen. */
const NAMED = 3;

export type Notice = Readonly<{ title: string; body: string; url: string }>;

/** Where the notification takes the reader: a city page lives under its
 *  region, and a reader who chose the whole country goes to the front door. */
const pathOf = (place: string): string =>
  [place]
    .filter((chosen) => chosen.startsWith('city:'))
    .map((chosen) => chosen.slice(5))
    .map((city) => `${regionOfCity(city)?.slug ?? ''}/${city}`)
    .at(0) ?? place.replace(/^region:/, '');

/**
 * The one sentence a device shows when it is woken.
 *
 * Nothing on means nothing sent: a daily notification that says "nothing
 * today" every Tuesday is how an app gets its notifications turned off.
 */
export const digestNotice = (
  events: readonly CompactEvent[],
  place: string,
  lang: Language,
  origin: string,
): Notice | undefined =>
  [events]
    .filter((found) => found.length > 0)
    .map((found) => ({
      title: t('push.title', lang, { count: found.length, where: placeLabel(place, lang) }),
      body: found.slice(0, NAMED).map((event) => titleOf(event, lang)).join(' · '),
      url: [`${origin}${lang === 'en' ? '' : `/${lang}`}/${pathOf(place)}`.replace(/\/+$/, '/')]
        .map((url) => (url.endsWith('/') ? url : `${url}/`))
        .at(0) ?? origin,
    }))
    .at(0);
