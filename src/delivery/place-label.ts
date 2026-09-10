import { ALL_REGIONS } from '../domain/region.ts';
import { cityNameOf } from '../domain/city.ts';
import { t } from '../i18n.ts';
import type { Language } from '../pipeline/settings.ts';

/**
 * The chosen place, as a reader would name it.
 *
 * Place names stay in Italian in every language: a person in Genova looks for
 * "Genova", and translating it to "Генуя" in the same list that links to
 * /genova/ helps nobody find anything.
 */
export const placeLabel = (place: string, lang: Language): string => {
  if (place === '') return t('settings.place.all', lang);
  const slug = place.slice(place.indexOf(':') + 1);
  if (place.startsWith('city:')) return cityNameOf(slug) ?? slug;
  return ALL_REGIONS.find((region) => region.slug === slug)?.name ?? slug;
};
