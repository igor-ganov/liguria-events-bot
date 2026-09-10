// Waking a device without carrying anything: the notification's words are
// fetched by the worker when it wakes, so nothing here has to be encrypted.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { vapidJwt } from '../src/push/vapid-jwt.ts';
import { pushableSubscription, subscriptionKey } from '../src/push/subscription.ts';

const keyPair = async (): Promise<Readonly<{ privateKey: JsonWebKey; publicKey: CryptoKey }>> => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  return { privateKey: jwk, publicKey: pair.publicKey };
};

describe('vapidJwt', () => {
  test('says who is asking, for which push service, and until when', async () => {
    const { privateKey, publicKey } = await keyPair();
    const nowMs = Date.parse('2026-09-10T12:00:00Z');
    const token = await vapidJwt(privateKey, 'https://fcm.googleapis.com', 'mailto:hi@dovego.it', nowMs);
    const [head, body, signature] = token.split('.');
    const decode = (part: string): unknown =>
      JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
    assert.deepEqual(decode(head ?? ''), { typ: 'JWT', alg: 'ES256' });
    const claims = decode(body ?? '') as Record<string, unknown>;
    assert.equal(claims['aud'], 'https://fcm.googleapis.com');
    assert.equal(claims['sub'], 'mailto:hi@dovego.it');
    assert.equal(claims['exp'], Math.floor(nowMs / 1000) + 12 * 60 * 60);

    // And it verifies against the public half — a push service that cannot
    // check the signature refuses the message.
    const bytes = Uint8Array.from(atob((signature ?? '').replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      bytes,
      new TextEncoder().encode(`${head}.${body}`),
    );
    assert.equal(ok, true);
  });
});

describe('subscriptions', () => {
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc123';

  test('a subscription is filed under its own endpoint', async () => {
    // The app has no account behind it: the endpoint IS the identity, and the
    // same device re-subscribing must land on the same key rather than
    // collecting a second copy of every notification.
    assert.equal(await subscriptionKey(endpoint), await subscriptionKey(endpoint));
    assert.notEqual(await subscriptionKey(endpoint), await subscriptionKey(`${endpoint}2`));
    assert.match(await subscriptionKey(endpoint), /^push:[0-9a-f]{16}$/);
  });

  test('what a device may ask to be woken about', () => {
    assert.deepEqual(
      pushableSubscription({ endpoint, place: 'region:liguria', lang: 'ru', hour: 9 }),
      { endpoint, place: 'region:liguria', lang: 'ru', hour: 9 },
    );
  });

  test('nonsense is refused rather than stored', () => {
    // Anyone can POST here; a stored endpoint that is not a URL would be a
    // send that fails every morning forever.
    [
      { endpoint: 'not-a-url', place: '', lang: 'ru', hour: 9 },
      { endpoint, place: 'region:mordor', lang: 'ru', hour: 9 },
      { endpoint, place: '', lang: 'klingon', hour: 9 },
      { endpoint, place: '', lang: 'ru', hour: 99 },
      { endpoint: 'http://insecure.example/x', place: '', lang: 'ru', hour: 9 },
    ].forEach((bad) => assert.equal(pushableSubscription(bad), undefined, JSON.stringify(bad)));
  });
});

describe('what the notification says', () => {
  const events = [
    { id: 'a', t: 'Sagra del Fuoco', s: '2026-09-12', c: ['food'] as const, u: 'https://x/a', ct: 'genova', rg: 'liguria' },
    { id: 'b', t: 'Concerto in Cortile', s: '2026-09-12', c: ['music'] as const, u: 'https://x/b', ct: 'genova', rg: 'liguria' },
    { id: 'c', t: 'Mercato dei Fiori', s: '2026-09-12', c: ['market'] as const, u: 'https://x/c', ct: 'genova', rg: 'liguria' },
    { id: 'd', t: 'Yoga al Parco', s: '2026-09-12', c: ['sport'] as const, u: 'https://x/d', ct: 'genova', rg: 'liguria' },
  ];

  test('how many, and the first few by name', async () => {
    const { digestNotice } = await import('../src/push/digest-notice.ts');
    const notice = digestNotice(events, 'city:genova', 'ru', 'https://dovego.it');
    assert.match(notice?.title ?? '', /4/);
    assert.match(notice?.title ?? '', /Genova/);
    assert.match(notice?.body ?? '', /Sagra del Fuoco/);
    // Three names and a count is a notification; four is a wall of text.
    assert.equal(notice?.body.includes('Yoga al Parco'), false);
    assert.equal(notice?.url, 'https://dovego.it/ru/liguria/genova/');
  });

  test('nothing on means nothing sent', async () => {
    // A daily notification that says "nothing today" every Tuesday is how an
    // app gets its notifications turned off.
    const { digestNotice } = await import('../src/push/digest-notice.ts');
    assert.equal(digestNotice([], 'city:genova', 'ru', 'https://dovego.it'), undefined);
  });

  test('a reader who chose the whole country is sent to the country', async () => {
    const { digestNotice } = await import('../src/push/digest-notice.ts');
    assert.equal(digestNotice(events, '', 'en', 'https://dovego.it')?.url, 'https://dovego.it/');
  });
});

describe('the morning send', () => {
  test('only the devices whose hour it is, and a dead one is dropped', async () => {
    // A subscription the push service has thrown away answers 410 forever;
    // retried every morning it is a failure that never stops failing.
    const { makeKvStub } = await import('./kv-stub.ts');
    const { writeSubscription, readSubscriptions } = await import('../src/push/push-store.ts');
    const kv = makeKvStub();
    await writeSubscription(kv, { endpoint: 'https://push.example/a', place: 'city:genova', lang: 'ru', hour: 9 });
    await writeSubscription(kv, { endpoint: 'https://push.example/b', place: '', lang: 'en', hour: 21 });
    const all = await readSubscriptions(kv);
    assert.equal(all.length, 2);
    assert.deepEqual(all.filter((sub) => sub.hour === 9).map((sub) => sub.endpoint), ['https://push.example/a']);
  });

  test('one device is one row, however often it asks', async () => {
    const { makeKvStub } = await import('./kv-stub.ts');
    const { writeSubscription, readSubscriptions } = await import('../src/push/push-store.ts');
    const kv = makeKvStub();
    const sub = { endpoint: 'https://push.example/a', place: 'city:genova', lang: 'ru', hour: 9 };
    await writeSubscription(kv, sub);
    await writeSubscription(kv, { ...sub, hour: 8 });
    const all = await readSubscriptions(kv);
    assert.equal(all.length, 1);
    assert.equal(all[0]?.hour, 8);
  });
});
