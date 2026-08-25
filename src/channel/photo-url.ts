const SITE = 'https://dovego.it';
const TRANSFORM = '/cdn-cgi/image/width=1200,height=630,fit=cover,quality=82,format=jpeg';

const base64url = (value: string): string =>
  btoa(Array.from(new TextEncoder().encode(value), (byte) => String.fromCharCode(byte)).join(''))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');

/**
 * The picture to hand Telegram.
 *
 * Telegram fetches the URL itself, and a source CDN is free to refuse it —
 * which is what happened on the first post: the send failed and the channel
 * stayed silent. The site already serves every cover cropped to 1200x630 from
 * our own origin, so point at that: a host we control, an aspect ratio that
 * fits a post, and an edge cache in front of it.
 *
 * Mirrors `socialImageUrl` in the site repo. Both sides are pinned by the
 * `og-images` health check, which reads the built URL back off a live page.
 */
export const channelPhotoUrl = (img: string): string =>
  img.startsWith('/')
    ? `${SITE}${TRANSFORM}${img}`
    : `${SITE}${TRANSFORM}/img/${base64url(img)}`;
