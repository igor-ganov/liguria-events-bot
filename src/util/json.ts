/** Safe navigation over `unknown` JSON — the only sanctioned alternative to
 *  casting. Every external payload (Telegram updates, LLM output, KV values)
 *  is read through these guards. */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const readProp = (value: unknown, key: string): unknown =>
  isRecord(value) ? value[key] : undefined;

export const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

export const asNonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

export const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

export const asArray = (value: unknown): readonly unknown[] | undefined =>
  Array.isArray(value) ? value : undefined;

export const readAt = (value: unknown, index: number): unknown =>
  Array.isArray(value) ? (asArray(value) ?? [])[index] : undefined;

export const parseJson = (text: string): unknown => {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return undefined;
  }
};
