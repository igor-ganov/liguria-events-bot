import { vapidJwt } from './vapid-jwt.ts';

/**
 * Wake one device.
 *
 * Deliberately without a payload. A payload would have to be encrypted to the
 * subscription's own keys — aes128gcm, ECDH, a salt per message — a page of
 * cryptography to carry a sentence the worker can just as well fetch when it
 * wakes, fresher than whatever we would have encrypted an hour earlier.
 *
 * 404 and 410 mean the subscription is dead: the browser threw it away, or the
 * app was uninstalled. The caller drops those rather than trying forever.
 */
export const sendPush = async (
  endpoint: string,
  privateKey: JsonWebKey,
  publicKey: string,
  subject: string,
  nowMs: number,
): Promise<number> => {
  const token = await vapidJwt(privateKey, new URL(endpoint).origin, subject, nowMs);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `vapid t=${token}, k=${publicKey}`,
      ttl: '3600',
      'content-length': '0',
    },
  });
  return response.status;
};
