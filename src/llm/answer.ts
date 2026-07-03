/**
 * Grounded Q&A and the weekend planner (design §5, US-4/US-6). The corpus is
 * serialized whole into the prompt — at this scale full-context grounding
 * beats retrieval (design §1, rejected alternatives).
 */
import type { Category, EventRecord } from '../domain/event.ts';
import type { ChatFn } from './client.ts';
import type { Language } from '../pipeline/settings.ts';
import type { DayForecast } from '../weather/open-meteo.ts';

export const detectLanguage = (text: string): Language =>
  /[Ѐ-ӿ]/.test(text) ? 'ru' : 'en';

const LANG_NAME: Readonly<Record<Language, string>> = {
  ru: 'Russian',
  it: 'Italian',
  en: 'English',
};

const LANG_DIRECTIVE: Readonly<Record<Language, string>> = {
  ru: 'Отвечай по-русски.',
  it: 'Rispondi in italiano.',
  en: 'Respond in English.',
};

const eventLine = (event: EventRecord): string =>
  [
    event.title,
    event.startDate + (event.endDate === undefined ? '' : `..${event.endDate}`),
    event.time ?? '',
    event.venue ?? '',
    event.categories.join('/'),
    event.priceInfo ?? (event.free === true ? 'free' : ''),
    event.url,
    event.descriptions.en,
  ]
    .filter((part) => part !== '')
    .join(' | ');

export const serializeCorpus = (
  events: readonly EventRecord[],
  maxChars = 30_000,
): string => {
  const sorted = events.toSorted((a, b) => a.startDate.localeCompare(b.startDate));
  const lines: string[] = [];
  let total = 0;
  for (const event of sorted) {
    const line = eventLine(event);
    if (total + line.length + 1 > maxChars) break;
    lines.push(line);
    total += line.length + 1;
  }
  return lines.join('\n');
};

/** `forced === undefined` → answer in the question's language (AC-4.1);
 *  otherwise always answer in that language (explicit /settings choice). */
export const answerSystem = (forced: Language | undefined, today: string): string =>
  [
    'You are a local events concierge for Genoa, Italy. Today is ' + today + '.',
    'Answer the user question using ONLY the events listed below.',
    'Never invent events, dates, venues or prices. If the list has nothing',
    'relevant, say so honestly and suggest the closest alternatives from the',
    'list, if any.',
    'When you mention an event, include its link in parentheses.',
    'Be concise and friendly; plain text, no markdown headers.',
    forced === undefined
      ? 'Answer in the SAME language as the user question (Russian, Italian or English).'
      : `Always answer in ${LANG_NAME[forced]}.`,
  ].join('\n');

export const makeAnswer =
  (chat: ChatFn) =>
  (
    question: string,
    events: readonly EventRecord[],
    forced: Language | undefined,
    today: string,
  ): Promise<string> =>
    chat(
      answerSystem(forced, today),
      `EVENTS:\n${serializeCorpus(events)}\n\nQUESTION:\n${question}`,
    );

export const planSystem = (lang: Language, today: string): string =>
  [
    'You are a local friend planning a weekend in Genoa, Italy.',
    'Today is ' + today + '.',
    'Build an itinerary for the weekend days given below, with morning /',
    'afternoon / evening slots, using ONLY the events listed. Not every slot',
    'needs an event — suggest at most one per slot and keep travel realistic.',
    'If a weather forecast is provided, prefer indoor events (art, theatre,',
    'workshop, culture) on rainy slots and outdoor ones on clear slots, and',
    'say why. Include each mentioned event\'s link in parentheses.',
    'Plain text, no markdown headers.',
    LANG_DIRECTIVE[lang],
  ].join('\n');

const forecastBlock = (forecast: readonly DayForecast[] | undefined): string =>
  forecast === undefined || forecast.length === 0
    ? ''
    : `\n\nWEATHER FORECAST:\n${forecast
        .map(
          (day) =>
            `${day.date}: max ${day.tMaxC}°C, precipitation chance ${day.precipitationChance}%`,
        )
        .join('\n')}`;

export const makePlan =
  (chat: ChatFn) =>
  (
    events: readonly EventRecord[],
    forecast: readonly DayForecast[] | undefined,
    preferred: readonly Category[],
    lang: Language,
    today: string,
    weekendDays: readonly string[],
  ): Promise<string> =>
    chat(
      planSystem(lang, today),
      [
        `WEEKEND DAYS: ${weekendDays.join(', ')}`,
        preferred.length === 0
          ? ''
          : `USER PREFERS CATEGORIES: ${preferred.join(', ')}`,
        `EVENTS:\n${serializeCorpus(events)}`,
      ]
        .filter((part) => part !== '')
        .join('\n\n') + forecastBlock(forecast),
    );
