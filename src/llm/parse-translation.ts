import { hasCjk } from '../domain/event.ts';
import { asNonEmptyString, readProp } from '../util/json.ts';

/** A translated pair. The title is optional: the pipeline falls back to the
 *  original when a model declines to translate a proper noun. */
export type Translated = Readonly<{ title?: string; description: string }>;

export const parseTranslation = (value: unknown): Translated | undefined => {
  const description = asNonEmptyString(readProp(value, 'description'))?.trim();
  const title = asNonEmptyString(readProp(value, 'title'))?.trim();
  if (description === undefined || description === '') return undefined;
  // The same guard the enrichment parser applies: a model that slips into
  // Chinese for one word must not reach the corpus.
  if (hasCjk({ en: description, it: title ?? '', ru: '' })) return undefined;
  return title === undefined ? { description } : { title, description };
};
