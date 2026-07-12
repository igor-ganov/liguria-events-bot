/**
 * Worker entry point — thin adapters over the pure pipeline (design §8, §9).
 * `fetch()` is the authenticated Telegram webhook; `scheduled()` dispatches
 * the Rome-local hour to collection, reminders and digest pushes.
 */
import { isOperator } from './config.ts';
import type { Env } from './config.ts';
import { isCategory, parseLocalized, toCompact } from './domain/event.ts';
import type { Category, CompactEvent, SourceLink } from './domain/event.ts';
import { makeBot, sendLong } from './delivery/bot-api.ts';
import type { Bot, Keyboard } from './delivery/bot-api.ts';
import {
  CATEGORY_EMOJI,
  categoryLabel,
  renderCard,
  renderGrouped,
  renderList,
} from './delivery/render.ts';
import { t } from './i18n.ts';
import type { TranslationKey } from './i18n.ts';
import { detectLanguage, makeAnswer, makePlan } from './llm/answer.ts';
import { runCollect } from './pipeline/collect-run.ts';
import type { RunSummary } from './pipeline/collect-run.ts';
import { romeDate, romeHour } from './pipeline/clock.ts';
import { dueReminders, readSaved, toggleSaved, writeSaved } from './pipeline/saved.ts';
import {
  digestDueWindow,
  readSettings,
  toggleCategory,
  uiLanguage,
  writeSettings,
} from './pipeline/settings.ts';
import type { Language, Settings } from './pipeline/settings.ts';
import {
  eventKey,
  readAllRecords,
  readEventRecord,
  readEventRecords,
  readIndex,
  readRunLog,
  writeEventRecord,
  writeIndex,
} from './pipeline/store.ts';
import { pickSurprise } from './pipeline/surprise.ts';
import { listUserIds, rememberUserChat } from './pipeline/users.ts';
import {
  categoryEvents,
  eventsInWindow,
  freeEvents,
  gemEvents,
  pruneIndex,
  todayWindow,
  tomorrowWindow,
  tonightEvents,
  upcomingWindow,
  weekendWindow,
} from './pipeline/windows.ts';
import { fetchForecast } from './weather/open-meteo.ts';
import { buildIcs, filterEvents, filterFromQuery, langFromQuery } from './calendar/ics.ts';
import { buildCollectDeps, chatOf } from './wire.ts';
import { CATEGORIES } from './domain/event.ts';
import { asArray, asBoolean, asNonEmptyString, asNumber, readProp } from './util/json.ts';

const QA_CORPUS_DAYS = 30;
const QA_CORPUS_CAP = 120;
// Crawl once a day (05:00 Europe/Rome). The hourly tick still fires digests
// and reminders at their own hours; only collection is daily. Enrichment is
// delta-only — known enriched events are never re-translated.
const COLLECT_HOURS: readonly number[] = [5];
const REMINDER_HOUR = 10;

const ok = (): Response => new Response('ok');

const langHintOf = (from: unknown): Language => {
  const code = asNonEmptyString(readProp(from, 'language_code')) ?? '';
  return code.startsWith('ru') ? 'ru' : code.startsWith('it') ? 'it' : 'en';
};

// ───────────────────────────────────────────────────────── event cards ──

const cardKeyboard = (eventId: string, lang: Language): Keyboard => [
  [
    { text: t('btn.save', lang), callbackData: `sv:${eventId}` },
    { text: t('btn.another', lang), callbackData: `sur:${eventId}` },
  ],
];

const sendSurprise = async (
  env: Env,
  bot: Bot,
  settings: Settings,
  lang: Language,
  excludeId?: string,
  editMessageId?: number,
): Promise<void> => {
  const index = await readIndex(env.EVENTS);
  const today = romeDate(Date.now());
  const pick = pickSurprise(
    index,
    today,
    settings.categories,
    () => Math.random(),
    excludeId,
  );
  if (pick === undefined) {
    await bot.sendMessage(t('surprise.none', lang));
    return;
  }
  const record = await readEventRecord(env.EVENTS, pick.id);
  if (record === undefined) {
    await bot.sendMessage(t('surprise.none', lang));
    return;
  }
  const card = renderCard(record, lang);
  const options = { keyboard: cardKeyboard(record.id, lang) };
  if (editMessageId === undefined) await bot.sendMessage(card, options);
  else await bot.editMessageText(editMessageId, card, options);
};

// ──────────────────────────────────────────────────────────── settings ──

const settingsSummary = (settings: Settings, lang: Language): string => {
  const languageValue = t(`lang.${settings.language}`, lang);
  const digestKey: TranslationKey =
    settings.digest === 'off' ? 'digest.off' : settings.digest === 'daily' ? 'digest.daily' : 'digest.weekly';
  const categoriesValue =
    settings.categories.length === 0
      ? t('settings.categories.any', lang)
      : settings.categories.map((category) => categoryLabel(category, lang)).join(', ');
  return [
    `<b>${t('settings.title', lang)}</b>`,
    '',
    t('settings.language', lang, { value: languageValue }),
    t('settings.digest', lang, { value: t(digestKey, lang) }),
    t('settings.hour', lang, { value: settings.digestHour }),
    t('settings.categories', lang, { value: categoriesValue }),
  ].join('\n');
};

const settingsMainKeyboard = (lang: Language): Keyboard => [
  [{ text: t('settings.pick_language', lang), callbackData: 'set:lang' }],
  [{ text: t('settings.pick_digest', lang), callbackData: 'set:dig' }],
  [{ text: t('settings.pick_hour', lang), callbackData: 'set:hour' }],
  [{ text: t('settings.pick_categories', lang), callbackData: 'set:cat' }],
];

const BACK = 'set:main';

const languageKeyboard = (lang: Language): Keyboard => [
  [
    { text: t('lang.auto', lang), callbackData: 'set:lang:auto' },
    { text: t('lang.ru', lang), callbackData: 'set:lang:ru' },
    { text: t('lang.it', lang), callbackData: 'set:lang:it' },
    { text: t('lang.en', lang), callbackData: 'set:lang:en' },
  ],
  [{ text: '←', callbackData: BACK }],
];

const digestKeyboard = (lang: Language): Keyboard => [
  [
    { text: t('digest.off', lang), callbackData: 'set:dig:off' },
    { text: t('digest.daily', lang), callbackData: 'set:dig:daily' },
    { text: t('digest.weekly', lang), callbackData: 'set:dig:weekly' },
  ],
  [{ text: '←', callbackData: BACK }],
];

const HOURS: readonly number[] = [7, 9, 11, 13, 15, 17, 19, 21];

const hourKeyboard = (): Keyboard => [
  HOURS.map((hour) => ({ text: `${hour}:00`, callbackData: `set:hour:${hour}` })),
  [{ text: '←', callbackData: BACK }],
];

const categoriesKeyboard = (settings: Settings, lang: Language): Keyboard => [
  ...CATEGORIES.map((category) => [
    {
      text:
        (settings.categories.includes(category) ? '✅ ' : '') +
        `${CATEGORY_EMOJI[category]} ${categoryLabel(category, lang)}`,
      callbackData: `set:cat:${category}`,
    },
  ]),
  [{ text: '←', callbackData: BACK }],
];

// ─────────────────────────────────────────────────────────── /status ──

const renderStatus = (entries: readonly unknown[], lang: Language): string => {
  if (entries.length === 0) return t('status.empty', lang);
  const lines = entries.slice(0, 5).map((entry) => {
    const at = asNumber(readProp(entry, 'at')) ?? 0;
    const durationMs = asNumber(readProp(entry, 'durationMs')) ?? 0;
    const sources = readProp(entry, 'sources');
    const sourceCount = Array.isArray(sources) ? sources.length : 0;
    const fresh = Array.isArray(sources)
      ? sources.reduce(
          (sum: number, source) => sum + (asNumber(readProp(source, 'fresh')) ?? 0),
          0,
        )
      : 0;
    return t('status.line', lang, {
      when: new Date(at * 1000).toISOString().slice(0, 16).replace('T', ' '),
      sources: sourceCount,
      fresh,
      seconds: Math.round(durationMs / 1000),
    });
  });
  return [t('status.header', lang), ...lines].join('\n');
};

const renderCollectSummary = (summary: RunSummary, lang: Language): string => {
  if (summary.kind === 'locked') return t('collect.locked', lang);
  const lines = summary.entry.sources.map((source) =>
    t('collect.source_line', lang, {
      marker: source.failed ? '❌' : '✅',
      source: source.source,
      fetched: source.fetched,
      fresh: source.fresh,
      merged: source.merged,
    }),
  );
  return [
    t('collect.summary', lang, {
      seconds: Math.round(summary.entry.durationMs / 1000),
      extracted: summary.entry.extractedFromPosts,
    }),
    ...lines,
  ].join('\n');
};

// ─────────────────────────────────────────────────────────── commands ──

const listCommand = async (
  env: Env,
  bot: Bot,
  lang: Language,
  headerKey: TranslationKey,
  select: (index: readonly CompactEvent[], today: string) => readonly CompactEvent[],
): Promise<void> => {
  const index = await readIndex(env.EVENTS);
  const today = romeDate(Date.now());
  await sendLong(bot, renderList(headerKey, select(index, today), lang));
};

const planCommand = async (
  env: Env,
  bot: Bot,
  settings: Settings,
  lang: Language,
): Promise<void> => {
  const statusId = await bot.sendMessage(t('plan.thinking', lang));
  try {
    const index = await readIndex(env.EVENTS);
    const today = romeDate(Date.now());
    const window = weekendWindow(today);
    const compacts = eventsInWindow(index, window);
    if (compacts.length === 0) {
      const text = t('plan.empty', lang);
      if (statusId === undefined) await bot.sendMessage(text);
      else await bot.editMessageText(statusId, text);
      return;
    }
    const events = await readEventRecords(
      env.EVENTS,
      compacts.slice(0, QA_CORPUS_CAP).map((event) => event.id),
    );
    const forecast = await fetchForecast(fetch, window.from, window.to);
    const weekendDays =
      window.from === window.to ? [window.from] : [window.from, window.to];
    const plan = await makePlan(chatOf(env))(
      events,
      forecast,
      settings.categories,
      lang,
      today,
      weekendDays,
    );
    if (statusId === undefined) await sendLong(bot, plan);
    else {
      await bot.editMessageText(statusId, plan);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const text = t('plan.failed', lang, { reason });
    if (statusId === undefined) await bot.sendMessage(text);
    else await bot.editMessageText(statusId, text);
  }
};

const savedCommand = async (
  env: Env,
  userId: number,
  bot: Bot,
  lang: Language,
): Promise<void> => {
  const entries = await readSaved(env.EVENTS, userId);
  const index = await readIndex(env.EVENTS);
  const byId = new Map(index.map((event) => [event.id, event]));
  const events = entries.flatMap((entry) => {
    const event = byId.get(entry.eventId);
    return event === undefined ? [] : [event];
  });
  if (events.length === 0) {
    await bot.sendMessage(t('saved.empty', lang));
    return;
  }
  await sendLong(bot, `<b>${t('header.saved', lang)}</b>\n\n${renderGrouped(events, lang)}`);
};

const handleCommand = async (
  env: Env,
  userId: number,
  bot: Bot,
  settings: Settings,
  lang: Language,
  text: string,
  origin: string,
): Promise<void> => {
  const command = text.trim().split(/[\s@]/, 1)[0] ?? '';
  switch (command) {
    case '/start':
    case '/help':
      await bot.sendMessage(t('help.text', lang));
      return;
    case '/today':
      await listCommand(env, bot, lang, 'header.today', (index, today) =>
        eventsInWindow(index, todayWindow(today)),
      );
      return;
    case '/tomorrow':
      await listCommand(env, bot, lang, 'header.tomorrow', (index, today) =>
        eventsInWindow(index, tomorrowWindow(today)),
      );
      return;
    case '/tonight':
      await listCommand(env, bot, lang, 'header.tonight', tonightEvents);
      return;
    case '/weekend':
      await listCommand(env, bot, lang, 'header.weekend', (index, today) =>
        eventsInWindow(index, weekendWindow(today)),
      );
      return;
    case '/free':
      await listCommand(env, bot, lang, 'header.free', (index, today) =>
        freeEvents(index, today),
      );
      return;
    case '/gems':
      await listCommand(env, bot, lang, 'header.gems', (index, today) =>
        gemEvents(index, today),
      );
      return;
    case '/categories': {
      const keyboard: Keyboard = CATEGORIES.map((category) => [
        {
          text: `${CATEGORY_EMOJI[category]} ${categoryLabel(category, lang)}`,
          callbackData: `cat:${category}`,
        },
      ]);
      await bot.sendMessage(t('categories.pick', lang), { keyboard });
      return;
    }
    case '/surprise':
      await sendSurprise(env, bot, settings, lang);
      return;
    case '/plan':
      await planCommand(env, bot, settings, lang);
      return;
    case '/saved':
      await savedCommand(env, userId, bot, lang);
      return;
    case '/calendar':
      await bot.sendMessage(
        t('calendar.text', lang, {
          url: `${origin}/calendar.ics`,
          example: `${origin}/calendar.ics?cat=music,art&free=1`,
        }),
      );
      return;
    case '/settings':
      await bot.sendMessage(settingsSummary(settings, lang), {
        keyboard: settingsMainKeyboard(lang),
      });
      return;
    case '/collect': {
      if (!isOperator(env, userId)) {
        await bot.sendMessage(t('collect.not_allowed', lang));
        return;
      }
      await bot.sendTyping();
      const summary = await runCollect(buildCollectDeps(env));
      await sendLong(bot, renderCollectSummary(summary, lang));
      return;
    }
    case '/status':
      await bot.sendMessage(renderStatus(await readRunLog(env.EVENTS), lang));
      return;
    default:
      await bot.sendMessage(t('help.text', lang));
  }
};

// ──────────────────────────────────────────────────────────────── Q&A ──

const handleQuestion = async (
  env: Env,
  bot: Bot,
  settings: Settings,
  question: string,
): Promise<void> => {
  // Auto → mirror the question's language (forced undefined); explicit → force.
  const forced = settings.language === 'auto' ? undefined : settings.language;
  // UI framing (typing, errors) uses a best-effort language.
  const uiLang = forced ?? detectLanguage(question);
  await bot.sendTyping();
  try {
    const index = await readIndex(env.EVENTS);
    const today = romeDate(Date.now());
    const compacts = eventsInWindow(index, upcomingWindow(today, QA_CORPUS_DAYS));
    const events = await readEventRecords(
      env.EVENTS,
      compacts.slice(0, QA_CORPUS_CAP).map((event) => event.id),
    );
    const answer = await makeAnswer(chatOf(env))(question, events, forced, today);
    await sendLong(bot, answer);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await bot.sendMessage(t('qa.failed', uiLang, { reason }));
  }
};

// ─────────────────────────────────────────────────────────── callbacks ──

const handleSettingsCallback = async (
  env: Env,
  userId: number,
  bot: Bot,
  callbackId: string,
  payload: string,
  messageId: number,
  hint: Language,
): Promise<void> => {
  const settings = await readSettings(env.EVENTS, userId);
  const lang = uiLanguage(settings, hint);

  const rerender = async (next: Settings, view: 'main' | 'lang' | 'dig' | 'hour' | 'cat'): Promise<void> => {
    const nextLang = uiLanguage(next, hint);
    if (view === 'main') {
      await bot.editMessageText(messageId, settingsSummary(next, nextLang), {
        keyboard: settingsMainKeyboard(nextLang),
      });
    } else if (view === 'lang') {
      await bot.editMessageText(messageId, t('settings.pick_language', nextLang), {
        keyboard: languageKeyboard(nextLang),
      });
    } else if (view === 'dig') {
      await bot.editMessageText(messageId, t('settings.pick_digest', nextLang), {
        keyboard: digestKeyboard(nextLang),
      });
    } else if (view === 'hour') {
      await bot.editMessageText(messageId, t('settings.pick_hour', nextLang), {
        keyboard: hourKeyboard(),
      });
    } else {
      await bot.editMessageText(messageId, t('settings.pick_categories', nextLang), {
        keyboard: categoriesKeyboard(next, nextLang),
      });
    }
  };

  if (payload === 'main' || payload === 'lang' || payload === 'dig' || payload === 'hour' || payload === 'cat') {
    await bot.answerCallback(callbackId, '');
    await rerender(settings, payload);
    return;
  }
  if (payload.startsWith('lang:')) {
    const choice = payload.slice(5);
    if (choice !== 'ru' && choice !== 'it' && choice !== 'en' && choice !== 'auto') {
      await bot.answerCallback(callbackId, t('cb.unknown', lang));
      return;
    }
    const next: Settings = { ...settings, language: choice };
    await writeSettings(env.EVENTS, userId, next);
    await bot.answerCallback(callbackId, t('settings.saved_toast', uiLanguage(next, hint)));
    await rerender(next, 'main');
    return;
  }
  if (payload.startsWith('dig:')) {
    const mode = payload.slice(4);
    if (mode !== 'off' && mode !== 'daily' && mode !== 'weekly') {
      await bot.answerCallback(callbackId, t('cb.unknown', lang));
      return;
    }
    const next: Settings = { ...settings, digest: mode };
    await writeSettings(env.EVENTS, userId, next);
    await bot.answerCallback(callbackId, t('settings.saved_toast', lang));
    await rerender(next, 'main');
    return;
  }
  if (payload.startsWith('hour:')) {
    const hour = Number(payload.slice(5));
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      await bot.answerCallback(callbackId, t('cb.unknown', lang));
      return;
    }
    const next: Settings = { ...settings, digestHour: hour };
    await writeSettings(env.EVENTS, userId, next);
    await bot.answerCallback(callbackId, t('settings.saved_toast', lang));
    await rerender(next, 'main');
    return;
  }
  if (payload.startsWith('cat:')) {
    const category = payload.slice(4);
    if (!isCategory(category)) {
      await bot.answerCallback(callbackId, t('cb.unknown', lang));
      return;
    }
    const next = toggleCategory(settings, category);
    await writeSettings(env.EVENTS, userId, next);
    await bot.answerCallback(callbackId, '');
    await rerender(next, 'cat');
    return;
  }
  await bot.answerCallback(callbackId, t('cb.unknown', lang));
};

const handleCallback = async (env: Env, callback: unknown): Promise<void> => {
  const callbackId = asNonEmptyString(readProp(callback, 'id'));
  const data = asNonEmptyString(readProp(callback, 'data'));
  const message = readProp(callback, 'message');
  const chatId = asNumber(readProp(readProp(message, 'chat'), 'id'));
  const messageId = asNumber(readProp(message, 'message_id'));
  const from = readProp(callback, 'from');
  const userId = asNumber(readProp(from, 'id'));
  if (callbackId === undefined || data === undefined || chatId === undefined || userId === undefined) {
    return;
  }
  const bot = makeBot(env.BOT_TOKEN, chatId);
  const settings = await readSettings(env.EVENTS, userId);
  const hint = langHintOf(from);
  const lang = uiLanguage(settings, hint);

  if (data.startsWith('cat:')) {
    const category = data.slice(4);
    if (!isCategory(category)) {
      await bot.answerCallback(callbackId, t('cb.unknown', lang));
      return;
    }
    await bot.answerCallback(callbackId, '');
    const index = await readIndex(env.EVENTS);
    const today = romeDate(Date.now());
    const events = categoryEvents(index, category, today);
    const header = t('header.category', lang, {
      emoji: CATEGORY_EMOJI[category],
      category: categoryLabel(category, lang),
    });
    await sendLong(
      bot,
      events.length === 0
        ? t('empty.window', lang)
        : `<b>${header}</b>\n\n${renderGrouped(events, lang)}`,
    );
    return;
  }

  if (data.startsWith('sv:')) {
    const eventId = data.slice(3);
    const entries = await readSaved(env.EVENTS, userId);
    const { entries: next, nowSaved } = toggleSaved(entries, eventId);
    await writeSaved(env.EVENTS, userId, next);
    await bot.answerCallback(
      callbackId,
      t(nowSaved ? 'saved.added' : 'saved.removed', lang),
    );
    return;
  }

  if (data === 'sur' || data.startsWith('sur:')) {
    await bot.answerCallback(callbackId, '');
    const excludeId = data === 'sur' ? undefined : data.slice(4);
    await sendSurprise(env, bot, settings, lang, excludeId, messageId);
    return;
  }

  if (data.startsWith('set:')) {
    if (messageId === undefined) return;
    await handleSettingsCallback(env, userId, bot, callbackId, data.slice(4), messageId, hint);
    return;
  }

  await bot.answerCallback(callbackId, t('cb.unknown', lang));
};

// ───────────────────────────────────────────────────────────── webhook ──

const handleUpdate = async (env: Env, update: unknown, origin = ''): Promise<void> => {
  const callback = readProp(update, 'callback_query');
  if (callback !== undefined) {
    await handleCallback(env, callback);
    return;
  }
  const message = readProp(update, 'message');
  if (message === undefined) return;
  const chatId = asNumber(readProp(readProp(message, 'chat'), 'id'));
  const text = asNonEmptyString(readProp(message, 'text'));
  if (chatId === undefined || text === undefined) return;
  await rememberUserChat(env.EVENTS, chatId);
  const bot = makeBot(env.BOT_TOKEN, chatId);
  const settings = await readSettings(env.EVENTS, chatId);
  const hint = langHintOf(readProp(message, 'from'));
  const lang = uiLanguage(settings, hint);
  if (text.startsWith('/')) {
    await handleCommand(env, chatId, bot, settings, lang, text, origin);
  } else {
    await handleQuestion(env, bot, settings, text);
  }
};

// ─────────────────────────────────────────────────── public calendar feed ──

/** Public iCal feed (public-calendar AC-1.1/1.2/1.6) — deliberately unauthenticated. */
const serveCalendar = async (env: Env, url: URL): Promise<Response> => {
  const index = await readIndex(env.EVENTS);
  const events = filterEvents(index, filterFromQuery(url.searchParams));
  return new Response(buildIcs(events, Date.now(), langFromQuery(url.searchParams)), {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};

/** Public JSON corpus for the static-site build (public-calendar AC-4.x). */
const serveEventsJson = async (env: Env, url: URL): Promise<Response> => {
  const index = await readIndex(env.EVENTS);
  const events = filterEvents(index, filterFromQuery(url.searchParams));
  return new Response(
    JSON.stringify({ generatedAt: new Date().toISOString(), events }),
    {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=3600',
        'access-control-allow-origin': '*',
      },
    },
  );
};

// ──────────────────────────────────────────────────────────────── cron ──

const pushDigest = async (
  env: Env,
  userId: number,
  index: readonly CompactEvent[],
  today: string,
  hour: number,
): Promise<void> => {
  const settings = await readSettings(env.EVENTS, userId);
  const window = digestDueWindow(settings, today, hour);
  if (window === undefined) return;
  const events = eventsInWindow(index, window).filter(
    (event) =>
      settings.categories.length === 0 ||
      event.c.some((category) => settings.categories.includes(category)),
  );
  if (events.length === 0) return; // silent skip (AC-5.3)
  const lang = uiLanguage(settings, 'en');
  const headerKey: TranslationKey =
    settings.digest === 'weekly' ? 'digest.header.weekly' : 'digest.header.daily';
  const bot = makeBot(env.BOT_TOKEN, userId);
  await sendLong(bot, `<b>${t(headerKey, lang)}</b>\n\n${renderGrouped(events, lang)}`);
};

const pushReminders = async (
  env: Env,
  userId: number,
  index: readonly CompactEvent[],
  today: string,
): Promise<void> => {
  const entries = await readSaved(env.EVENTS, userId);
  if (entries.length === 0) return;
  const { due, entries: next } = dueReminders(entries, index, today);
  if (due.length === 0) return;
  await writeSaved(env.EVENTS, userId, next);
  const settings = await readSettings(env.EVENTS, userId);
  const lang = uiLanguage(settings, 'en');
  const bot = makeBot(env.BOT_TOKEN, userId);
  await sendLong(
    bot,
    `<b>${t('remind.header', lang)}</b>\n\n${renderGrouped(due, lang)}`,
  );
};

const runScheduled = async (env: Env, nowMs: number): Promise<void> => {
  const hour = romeHour(nowMs);
  const today = romeDate(nowMs);

  if (COLLECT_HOURS.includes(hour)) {
    await runCollect(buildCollectDeps(env)).catch(() => undefined);
  }

  const index = await readIndex(env.EVENTS);
  const userIds = await listUserIds(env.EVENTS);
  for (const userId of userIds) {
    await pushDigest(env, userId, index, today, hour).catch(() => undefined);
    if (hour === REMINDER_HOUR) {
      await pushReminders(env, userId, index, today).catch(() => undefined);
    }
  }
};

// ─────────────────────────────────────────────────────────────── export ──

/** The slice of ExecutionContext the worker actually uses — keeps test
 *  doubles trivial; the real context always satisfies it. */
export type WaitUntilContext = Readonly<{ waitUntil: (promise: Promise<unknown>) => void }>;

const worker = {
  fetch: async (request: Request, env: Env, ctx: WaitUntilContext): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname === '/calendar.ics' && request.method === 'GET') {
      return serveCalendar(env, url);
    }
    if (url.pathname === '/events.json' && request.method === 'GET') {
      return serveEventsJson(env, url);
    }
    // Rebuild events:index from the stored records (recovery after a lost
    // index), without re-collecting or re-enriching. Gated by the tick secret.
    if (url.pathname === '/rebuild-index' && request.method === 'POST') {
      if (request.headers.get('x-tick-secret') !== env.WEBHOOK_SECRET) {
        return new Response('unauthorized', { status: 401 });
      }
      const records = await readAllRecords(env.EVENTS);
      const today = romeDate(Date.now());
      const index = pruneIndex(records.map(toCompact), today).toSorted((a, b) =>
        a.s < b.s ? -1 : a.s > b.s ? 1 : a.t.localeCompare(b.t),
      );
      await writeIndex(env.EVENTS, index);
      return new Response(JSON.stringify({ ok: true, records: records.length, index: index.length }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    // Bulk-apply externally-produced translations (title + description maps)
    // onto stored records without the LLM pipeline. Gated by the tick secret.
    if (url.pathname === '/apply-translations' && request.method === 'POST') {
      if (request.headers.get('x-tick-secret') !== env.WEBHOOK_SECRET) {
        return new Response('unauthorized', { status: 401 });
      }
      const body: unknown = await request.json().catch(() => undefined);
      const items = asArray(readProp(body, 'items')) ?? [];
      const nowMs = Date.now();
      let applied = 0;
      for (const item of items) {
        const id = asNonEmptyString(readProp(item, 'id'));
        const titles = parseLocalized(readProp(item, 'tl'));
        const descriptions = parseLocalized(readProp(item, 'd'));
        const categories = (asArray(readProp(item, 'c')) ?? []).filter(isCategory).slice(0, 3);
        const unusual = asBoolean(readProp(item, 'x'));
        const address = asNonEmptyString(readProp(item, 'a'));
        const endDate = asNonEmptyString(readProp(item, 'e'));
        const lat = asNumber(readProp(item, 'lat'));
        const lng = asNumber(readProp(item, 'lng'));
        if (id === undefined) continue;
        const record = await readEventRecord(env.EVENTS, id);
        if (record === undefined) continue;
        await writeEventRecord(
          env.EVENTS,
          {
            ...record,
            enriched: true,
            ...(categories.length === 0 ? {} : { categories }),
            ...(titles === undefined ? {} : { titles }),
            ...(descriptions === undefined ? {} : { descriptions }),
            ...(address === undefined ? {} : { address }),
            ...(endDate === undefined ? {} : { endDate }),
            ...(lat === undefined ? {} : { lat }),
            ...(lng === undefined ? {} : { lng }),
            ...(unusual === undefined ? {} : { unusual }),
          },
          nowMs,
        );
        applied += 1;
      }
      const rebuilt = pruneIndex(
        (await readAllRecords(env.EVENTS)).map(toCompact),
        romeDate(nowMs),
      ).toSorted((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : a.t.localeCompare(b.t)));
      await writeIndex(env.EVENTS, rebuilt);
      return new Response(JSON.stringify({ ok: true, applied, index: rebuilt.length }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    // Manual duplicate merge: keep one record, fold the others' links in, drop
    // them, optionally clean the title / set the date span. Gated by the secret.
    if (url.pathname === '/merge-events' && request.method === 'POST') {
      if (request.headers.get('x-tick-secret') !== env.WEBHOOK_SECRET) {
        return new Response('unauthorized', { status: 401 });
      }
      const body: unknown = await request.json().catch(() => undefined);
      const groups = asArray(readProp(body, 'groups')) ?? [];
      const nowMs = Date.now();
      let merged = 0;
      let deleted = 0;
      for (const group of groups) {
        const keepId = asNonEmptyString(readProp(group, 'keep'));
        const dropIds = (asArray(readProp(group, 'drop')) ?? [])
          .map((value) => asNonEmptyString(value))
          .filter((value): value is string => value !== undefined);
        const title = asNonEmptyString(readProp(group, 'title'));
        const startDate = asNonEmptyString(readProp(group, 'startDate'));
        const endDate = asNonEmptyString(readProp(group, 'endDate'));
        if (keepId === undefined) continue;
        const keep = await readEventRecord(env.EVENTS, keepId);
        if (keep === undefined) continue;
        const links: SourceLink[] = [...(keep.altLinks ?? [])];
        for (const dropId of dropIds) {
          const drop = await readEventRecord(env.EVENTS, dropId);
          if (drop === undefined) continue;
          links.push({ source: drop.source, url: drop.url });
          for (const link of drop.altLinks ?? []) links.push(link);
          await env.EVENTS.delete(eventKey(dropId));
          deleted += 1;
        }
        const seenUrl = new Set<string>([keep.url]);
        const altLinks = links.filter(
          (link) => link.url !== '' && !seenUrl.has(link.url) && (seenUrl.add(link.url), true),
        );
        const cleanTitle = title ?? keep.title;
        await writeEventRecord(
          env.EVENTS,
          {
            ...keep,
            title: cleanTitle,
            ...(title === undefined ? {} : { titles: { en: cleanTitle, it: cleanTitle, ru: cleanTitle } }),
            ...(startDate === undefined ? {} : { startDate }),
            ...(endDate === undefined ? {} : { endDate }),
            ...(altLinks.length === 0 ? {} : { altLinks }),
          },
          nowMs,
        );
        merged += 1;
      }
      const rebuilt = pruneIndex(
        (await readAllRecords(env.EVENTS)).map(toCompact),
        romeDate(nowMs),
      ).toSorted((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : a.t.localeCompare(b.t)));
      await writeIndex(env.EVENTS, rebuilt);
      return new Response(JSON.stringify({ ok: true, merged, deleted, index: rebuilt.length }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    // Operator diagnostics: raw Workers AI probe, gated by the tick secret.
    if (url.pathname === '/debug-llm' && request.method === 'POST') {
      if (request.headers.get('x-tick-secret') !== env.WEBHOOK_SECRET) {
        return new Response('unauthorized', { status: 401 });
      }
      try {
        const body: unknown = await request.json().catch(() => undefined);
        const system =
          asNonEmptyString(readProp(body, 'system')) ?? 'You are a terse assistant.';
        const user =
          asNonEmptyString(readProp(body, 'user')) ?? 'Reply with the single word: pong';
        const reply = await chatOf(env)(system, user);
        return new Response(JSON.stringify({ ok: true, reply }), {
          headers: { 'content-type': 'application/json' },
        });
      } catch (error) {
        const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        return new Response(JSON.stringify({ ok: false, reason }), {
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    // External hourly pulse (GitHub Actions cron) — the account's CF cron
    // slots are exhausted, so the schedule arrives over HTTP instead. Same
    // secret as the webhook, different header.
    if (url.pathname === '/tick' && request.method === 'POST') {
      if (request.headers.get('x-tick-secret') !== env.WEBHOOK_SECRET) {
        return new Response('unauthorized', { status: 401 });
      }
      // `?force=collect` runs a crawl now instead of waiting for the collect
      // hour — used after changing a collector to verify it immediately.
      if (url.searchParams.get('force') === 'collect') {
        ctx.waitUntil(runCollect(buildCollectDeps(env)).then(() => undefined).catch(() => undefined));
        return ok();
      }
      ctx.waitUntil(runScheduled(env, Date.now()).catch(() => undefined));
      return ok();
    }
    if (url.pathname !== '/webhook' || request.method !== 'POST') {
      return new Response('not found', { status: 404 });
    }
    if (request.headers.get('x-telegram-bot-api-secret-token') !== env.WEBHOOK_SECRET) {
      return new Response('unauthorized', { status: 401 }); // AC-8.1
    }
    const update: unknown = await request.json().catch(() => undefined);
    if (update !== undefined) {
      ctx.waitUntil(handleUpdate(env, update, url.origin).catch(() => undefined));
    }
    return ok();
  },
  scheduled: async (
    _event: unknown,
    env: Env,
    ctx: WaitUntilContext,
  ): Promise<void> => {
    ctx.waitUntil(runScheduled(env, Date.now()).catch(() => undefined));
  },
};

export default worker;
export { handleUpdate, runScheduled };
