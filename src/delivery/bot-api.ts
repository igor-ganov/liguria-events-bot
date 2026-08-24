/**
 * Thin Telegram Bot API wrappers (reference idiom): raw fetch, no framework.
 * Errors are swallowed to `undefined` — delivery must never crash a pipeline.
 */
import { asNumber, readProp } from '../util/json.ts';
import type { FetchFn } from '../util/http.ts';
import { splitMessage } from './render.ts';

export type InlineButton = Readonly<{ text: string; callbackData: string }>;
export type Keyboard = readonly (readonly InlineButton[])[];

export type SendOptions = Readonly<{ keyboard?: Keyboard }>;

export type Bot = Readonly<{
  sendMessage: (text: string, options?: SendOptions) => Promise<number | undefined>;
  /** A channel post is a photo with a caption: the picture is what stops the
   *  scroll, and a text-only post in a feed of photos is skipped. */
  sendPhoto: (photo: string, caption: string, options?: SendOptions) => Promise<number | undefined>;
  editMessageText: (messageId: number, text: string, options?: SendOptions) => Promise<void>;
  answerCallback: (callbackId: string, text: string) => Promise<void>;
  sendTyping: () => Promise<void>;
}>;

const replyMarkup = (keyboard: Keyboard | undefined): Record<string, unknown> =>
  keyboard === undefined
    ? {}
    : {
        reply_markup: {
          inline_keyboard: keyboard.map((row) =>
            row.map((button) => ({ text: button.text, callback_data: button.callbackData })),
          ),
        },
      };

export const makeBot = (
  token: string,
  // A channel is addressed by @username as often as by numeric id.
  chatId: number | string,
  fetchFn: FetchFn = fetch,
): Bot => {
  const call = async (method: string, payload: Record<string, unknown>): Promise<unknown> => {
    try {
      const response = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return await response.json();
    } catch {
      return undefined;
    }
  };

  return {
    sendMessage: async (text, options) => {
      const result = await call('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...replyMarkup(options?.keyboard),
      });
      return asNumber(readProp(readProp(result, 'result'), 'message_id'));
    },
    sendPhoto: async (photo, caption, options) => {
      const result = await call('sendPhoto', {
        chat_id: chatId,
        photo,
        caption,
        parse_mode: 'HTML',
        ...replyMarkup(options?.keyboard),
      });
      return asNumber(readProp(readProp(result, 'result'), 'message_id'));
    },
    editMessageText: async (messageId, text, options) => {
      await call('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...replyMarkup(options?.keyboard),
      });
    },
    answerCallback: async (callbackId, text) => {
      await call('answerCallbackQuery', {
        callback_query_id: callbackId,
        ...(text === '' ? {} : { text }),
      });
    },
    sendTyping: async () => {
      await call('sendChatAction', { chat_id: chatId, action: 'typing' });
    },
  };
};

/** Send a long text as several messages split on entry boundaries (AC-3.7). */
export const sendLong = async (bot: Bot, text: string): Promise<void> => {
  for (const part of splitMessage(text)) {
    await bot.sendMessage(part);
  }
};
