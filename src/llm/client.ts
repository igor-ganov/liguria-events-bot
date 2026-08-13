/**
 * LLM client (design §5): Workers AI primary, Gemini REST fallback (AC-2.5).
 * One `ChatFn` surface for every consumer; JSON extraction is tolerant of
 * code fences and prose around the payload.
 */
import { asNonEmptyString, parseJson, readAt, readProp } from '../util/json.ts';
import type { FetchFn } from '../util/http.ts';

export interface AiBinding {
  run(model: string, input: AiChatInput): Promise<unknown>;
}

export type AiChatInput = Readonly<{
  messages: readonly Readonly<{ role: string; content: string }>[];
  max_tokens?: number;
}>;

export type LlmDeps = Readonly<{
  ai?: AiBinding;
  geminiApiKey?: string;
  fetchFn?: FetchFn;
}>;

export type ChatFn = (system: string, user: string) => Promise<string>;

const WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const GEMINI_MODEL = 'gemini-2.5-flash';
// Workers AI's binding has no timeout of its own and CAN hang — an unbounded run
// is what let a slow bot answer evict the worker before it could reply. Bound it,
// but generously: enrichment (awaited, off the request path) legitimately takes
// tens of seconds. The bot's own 24s answer deadline (index.ts) is what keeps a
// slow question inside the waitUntil grace; this only stops an infinite hang.
const WORKERS_AI_TIMEOUT_MS = 45_000;
const GEMINI_TIMEOUT_MS = 24_000;
const GEMINI_ATTEMPTS = 2;
const MAX_TOKENS = 4096;

const timeout = (ms: number, label: string): Promise<never> =>
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout`)), ms));

/** Workers AI replies either legacy `{response}` or OpenAI-style
 *  `{choices:[{message:{content}}]}` depending on the model route. */
export const workersAiText = (result: unknown): string | undefined =>
  asNonEmptyString(readProp(result, 'response')) ??
  asNonEmptyString(
    readProp(readProp(readAt(readProp(result, 'choices'), 0), 'message'), 'content'),
  );

const runWorkersAi = async (
  ai: AiBinding,
  system: string,
  user: string,
): Promise<string | undefined> => {
  try {
    // Workers AI's binding has no signal, so race it against a wall clock — an
    // unbounded run here is what evicts the worker before it can fall back.
    const result = await Promise.race([
      ai.run(WORKERS_AI_MODEL, {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: MAX_TOKENS,
      }),
      timeout(WORKERS_AI_TIMEOUT_MS, 'workers-ai'),
    ]);
    return workersAiText(result);
  } catch {
    return undefined;
  }
};

const geminiUrl = (apiKey: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

const geminiTextOf = (payload: unknown): string | undefined => {
  const candidate = readAt(readProp(payload, 'candidates'), 0);
  const parts = readProp(readProp(candidate, 'content'), 'parts');
  if (!Array.isArray(parts)) return undefined;
  const text = parts
    .map((part) => asNonEmptyString(readProp(part, 'text')) ?? '')
    .join('');
  return text === '' ? undefined : text;
};

const runGemini = async (
  fetchFn: FetchFn,
  apiKey: string,
  system: string,
  user: string,
): Promise<string | undefined> => {
  for (let attempt = 0; attempt < GEMINI_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchFn(geminiUrl(apiKey), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
        }),
      });
      if (!response.ok) continue;
      const text = geminiTextOf(await response.json());
      if (text !== undefined) return text;
    } catch {
      // retry
    }
  }
  return undefined;
};

export const makeChat = (deps: LlmDeps): ChatFn => {
  const fetchFn = deps.fetchFn ?? fetch;
  return async (system, user) => {
    const primary =
      deps.ai === undefined ? undefined : await runWorkersAi(deps.ai, system, user);
    if (primary !== undefined) return primary;
    const fallback =
      deps.geminiApiKey === undefined
        ? undefined
        : await runGemini(fetchFn, deps.geminiApiKey, system, user);
    if (fallback !== undefined) return fallback;
    throw new Error('all LLM providers failed');
  };
};

/** Tolerant JSON extraction: strips code fences, then falls back to the
 *  outermost brace span. */
export const extractJson = (text: string): unknown => {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  const direct = parseJson(trimmed);
  if (direct !== undefined) return direct;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  return start >= 0 && end > start ? parseJson(trimmed.slice(start, end + 1)) : undefined;
};
