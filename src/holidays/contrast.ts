/**
 * WCAG 2.x contrast for the theme colours. The model picks colours; whether
 * text in them can be read is arithmetic, not taste.
 * https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
 */

export type Rgb = readonly [number, number, number];

const SHORT = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const LONG = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

const channels = (match: RegExpExecArray | undefined, widen: (part: string) => string): Rgb | undefined =>
  match === undefined
    ? undefined
    : [
        parseInt(widen(match[1] ?? ''), 16),
        parseInt(widen(match[2] ?? ''), 16),
        parseInt(widen(match[3] ?? ''), 16),
      ];

/** '#rrggbb' or '#rgb' → channels; anything else → undefined. */
export const parseHex = (value: string): Rgb | undefined =>
  channels(LONG.exec(value.trim()) ?? undefined, (part) => part) ??
  channels(SHORT.exec(value.trim()) ?? undefined, (part) => part + part);

const hexByte = (value: number): string => value.toString(16).padStart(2, '0');

/** The canonical '#rrggbb' form of a parseable colour. */
export const normalHex = (value: string): string | undefined => {
  const rgb = parseHex(value);
  return rgb === undefined ? undefined : `#${rgb.map(hexByte).join('')}`;
};

const linear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]: Rgb): number => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

export const contrastRatio = (foreground: string, background: string): number | undefined => {
  const fg = parseHex(foreground);
  const bg = parseHex(background);
  if (fg === undefined || bg === undefined) return undefined;
  const [light, dark] = [luminance(fg), luminance(bg)].toSorted((a, b) => b - a);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
};

export const MIN_TEXT_CONTRAST = 4.5;
export const LIGHT_BACKGROUND = '#ffffff';
export const DARK_BACKGROUND = '#121212';

/** True when `colour` is readable as text on `background`. */
export const readableOn =
  (background: string) =>
  (colour: string): boolean =>
    (contrastRatio(colour, background) ?? 0) >= MIN_TEXT_CONTRAST;
