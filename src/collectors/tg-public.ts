/**
 * Public Telegram channel collector (design §4.2) — the reference project's
 * `t.me/s/<channel>` web-preview pattern. Posts are free text; the enrichment
 * step extracts structured events from them via the LLM.
 */
import type { CollectOutcome, Collector, FetchFn, RawPost } from './types.ts';

const PREVIEW_BASE = 'https://t.me/s/';
const USER_AGENT = 'Mozilla/5.0 (compatible; event-collecter/0.0)';
/**
 * Event promoters announce months ahead, then go quiet — so what matters is
 * the event's date (the LLM extractor drops past events; the pipeline prunes
 * them), not the post's age. Keep a wide window only to skip truly ancient
 * posts; re-extracting the same posts each run is idempotent via dedupe.
 */
const MAX_POST_AGE_SECONDS = 180 * 24 * 60 * 60;

type Draft = { messageId: number; date: number; text: string };

const parseDataPost = (value: string | null): number | undefined => {
  if (value === null) return undefined;
  const messageId = Number(value.slice(value.lastIndexOf('/') + 1));
  return Number.isInteger(messageId) && messageId > 0 ? messageId : undefined;
};

export const parsePreviewHtml = async (
  channel: string,
  html: string,
): Promise<readonly RawPost[]> => {
  const drafts: Draft[] = [];
  const current = (): Draft | undefined => drafts.at(-1);
  const rewriter = new HTMLRewriter()
    .on('div.tgme_widget_message[data-post]', {
      element: (element) => {
        const messageId = parseDataPost(element.getAttribute('data-post'));
        if (messageId !== undefined) drafts.push({ messageId, date: 0, text: '' });
      },
    })
    .on('.tgme_widget_message_text', {
      text: (chunk) => {
        const draft = current();
        if (draft !== undefined) draft.text += chunk.text;
      },
    })
    .on('.tgme_widget_message_date time[datetime]', {
      element: (element) => {
        const draft = current();
        const datetime = element.getAttribute('datetime');
        if (draft === undefined || datetime === null) return;
        const ms = Date.parse(datetime);
        if (!Number.isNaN(ms)) draft.date = Math.floor(ms / 1000);
      },
    });
  await rewriter.transform(new Response(html)).arrayBuffer();
  return drafts
    .filter((draft) => draft.text.trim() !== '')
    .map((draft) => ({
      channel,
      messageId: draft.messageId,
      date: draft.date,
      text: draft.text.trim(),
    }));
};

const collectChannel = async (
  fetchFn: FetchFn,
  channel: string,
  nowSeconds: number,
): Promise<CollectOutcome> => {
  const source = `tg:${channel}`;
  try {
    const response = await fetchFn(`${PREVIEW_BASE}${encodeURIComponent(channel)}`, {
      headers: { 'user-agent': USER_AGENT },
    });
    if (!response.ok) return { source, events: [], posts: [], failed: true };
    const posts = await parsePreviewHtml(channel, await response.text());
    const fresh = posts.filter((post) => nowSeconds - post.date <= MAX_POST_AGE_SECONDS);
    return { source, events: [], posts: fresh, failed: false };
  } catch {
    return { source, events: [], posts: [], failed: true };
  }
};

export const makeTgCollector =
  (fetchFn: FetchFn, channel: string, now: () => number): Collector =>
  () =>
    collectChannel(fetchFn, channel, Math.floor(now() / 1000));
