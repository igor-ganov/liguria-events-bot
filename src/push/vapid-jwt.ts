/**
 * The signed claim that says who is sending a push.
 *
 * A push service will not accept a message from an unknown sender: the request
 * carries a JWT signed with the private half of our VAPID key, and the public
 * half is what the browser subscribed with. ES256, which WebCrypto does, so
 * there is no library in the worker.
 */
const b64u = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const encode = (value: unknown): string => b64u(new TextEncoder().encode(JSON.stringify(value)));

/** Twelve hours: long enough that one token serves a whole send, short enough
 *  that a leaked one is worthless by tomorrow. */
const LIFETIME_SECONDS = 12 * 60 * 60;

export const vapidJwt = async (
  privateKey: JsonWebKey,
  audience: string,
  subject: string,
  nowMs: number,
): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'jwk',
    privateKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const head = encode({ typ: 'JWT', alg: 'ES256' });
  const body = encode({ aud: audience, exp: Math.floor(nowMs / 1000) + LIFETIME_SECONDS, sub: subject });
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${b64u(new Uint8Array(signature))}`;
};
