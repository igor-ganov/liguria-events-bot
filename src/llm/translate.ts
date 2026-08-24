import { extractJson } from './client.ts';
import { parseTranslation } from './parse-translation.ts';
import type { ChatFn } from './client.ts';
import type { Translated } from './parse-translation.ts';

const LANGUAGES: Readonly<Record<'it' | 'ru', string>> = { it: 'Italian', ru: 'Russian' };

/**
 * Translation, kept deliberately small.
 *
 * The old enrichment asked one call to read a source article and write three
 * structured Markdown articles from it. On long sources that completion ran
 * past both providers' deadlines, and the event was lost for the run. Reading
 * the source is the expensive part and now happens once, in English; this
 * turns that result into the other two languages, from a short input, with
 * nothing left to decide.
 */
const systemFor = (language: string): string =>
  [
    `You translate a short event listing into ${language}.`,
    'Return the SAME article, in that language. Keep its structure exactly:',
    'the lead paragraph, the "## [tag] Label" section headings — the [tag] in',
    'brackets stays identical, only the Label after it is translated — the "- "',
    'bullet lists, and the real newlines between them.',
    'Keep proper nouns (people, venues, works, cities) in their own form; do not',
    'invent, add or drop any fact. Translate nothing that is already a name.',
    'Respond with STRICT valid JSON only, no code fences:',
    '{ "title": "<translated title>", "description": "<translated article>" }',
  ].join('\n');

/** What `makeTranslate` hands back: pick a language, then give it the source. */
export type Translate = (language: 'it' | 'ru') => (source: Translated) => Promise<Translated | undefined>;

export const makeTranslate: (chat: ChatFn) => Translate =
  (chat: ChatFn) =>
  (language: 'it' | 'ru') =>
  async (source: Translated): Promise<Translated | undefined> => {
    try {
      const reply = await chat(systemFor(LANGUAGES[language]), JSON.stringify(source));
      return parseTranslation(extractJson(reply));
    } catch {
      // A failed translation leaves the event unenriched, which is how it gets
      // retried. Never a partial record.
      return undefined;
    }
  };
