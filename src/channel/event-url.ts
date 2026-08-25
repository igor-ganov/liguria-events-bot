import type { Lang } from '../domain/event.ts';

const SITE = 'https://dovego.it';

/** The site path for a locale: English lives at the root, the others under a
 *  prefix, exactly as the site builds them. */
export const eventUrl = (id: string, lang: Lang): string =>
  lang === 'en' ? `${SITE}/event/${id}/` : `${SITE}/${lang}/event/${id}/`;
