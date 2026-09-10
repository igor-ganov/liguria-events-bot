import { ALL_REGIONS } from '../domain/region.ts';
import { cityNameOf } from '../domain/city.ts';
import { placeIndex } from '../domain/places.ts';
import { t } from '../i18n.ts';
import type { Keyboard } from './bot-api.ts';
import type { Language } from '../pipeline/settings.ts';

const PER_ROW = 2;

const inRows = <T,>(items: readonly T[]): readonly (readonly T[])[] =>
  Array.from({ length: Math.ceil(items.length / PER_ROW) }, (_, row) =>
    items.slice(row * PER_ROW, row * PER_ROW + PER_ROW),
  );

/** Every region, plus the whole country. Two levels rather than one list:
 *  there are a hundred province capitals, and a keyboard of a hundred buttons
 *  is a list nobody reads. */
export const regionKeyboard = (lang: Language, back: string): Keyboard => [
  [{ text: t('settings.place.all', lang), callbackData: 'set:place:all' }],
  ...inRows(
    ALL_REGIONS.map((region) => ({
      text: region.name,
      callbackData: `set:place:r:${region.slug}`,
    })),
  ),
  [{ text: '←', callbackData: back }],
];

/** The cities of one region, plus the region itself — a reader near Savona
 *  wants Liguria, not a choice between four towns they do not live in. */
export const cityKeyboard = (region: string, lang: Language): Keyboard => [
  [{ text: t('settings.place.region_all', lang), callbackData: `set:place:rg:${region}` }],
  ...inRows(
    (placeIndex()[region] ?? []).map((slug) => ({
      text: cityNameOf(slug) ?? slug,
      callbackData: `set:place:c:${slug}`,
    })),
  ),
  [{ text: '←', callbackData: 'set:place' }],
];
