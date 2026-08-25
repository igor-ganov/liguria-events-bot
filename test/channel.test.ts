// A Telegram channel is the only place this project can push rather than wait.
// The bot has five subscribers; a channel is what turns a crawl into an
// audience. These are the parts that decide what goes out and what it says.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { pickPost } from '../src/channel/pick-post.ts';
import { renderPost } from '../src/channel/render-post.ts';
import { rememberPosted } from '../src/channel/remember-posted.ts';
import { postDaily } from '../src/channel/post-daily.ts';
import { channelPhotoUrl } from '../src/channel/photo-url.ts';
import { leadOf } from '../src/channel/lead-of.ts';
import { readProp } from '../src/util/json.ts';
import type { Env } from '../src/config.ts';
import type { KvLike } from '../src/pipeline/store.ts';
import type { FetchFn } from '../src/util/http.ts';
import { toCompact } from '../src/domain/event.ts';
import type { CompactEvent, EventRecord } from '../src/domain/event.ts';

const base: EventRecord = {
  id: 'aaaabbbbcccc',
  title: 'Concerto di Ferragosto',
  startDate: '2026-09-01',
  categories: ['music'],
  descriptions: { en: 'A concert by the sea.', it: 'Un concerto sul mare.', ru: 'Концерт у моря.' },
  url: 'https://example.org/concerto',
  source: 'mentelocale',
  enriched: true,
  addedAt: 1,
};

const compact = (over: Partial<EventRecord> = {}): CompactEvent => toCompact({ ...base, ...over });
const withImage = (over: Partial<EventRecord> = {}): CompactEvent =>
  compact({ image: 'https://s1.ticketm.net/1.jpg', ...over });

describe('pickPost', () => {
  const today = '2026-08-25';

  test('takes the soonest upcoming event that has a picture', () => {
    const picked = pickPost(
      [
        withImage({ id: 'later', startDate: '2026-09-10' }),
        withImage({ id: 'sooner', startDate: '2026-08-27' }),
      ],
      today,
      [],
    );
    assert.equal(picked?.id, 'sooner');
  });

  test('skips what has gone out already — a channel that repeats itself is muted', () => {
    const picked = pickPost(
      [withImage({ id: 'sooner', startDate: '2026-08-27' }), withImage({ id: 'next', startDate: '2026-08-28' })],
      today,
      ['sooner'],
    );
    assert.equal(picked?.id, 'next');
  });

  test('skips an event with no picture: a photoless channel post is ignored', () => {
    const picked = pickPost([compact({ id: 'bare', startDate: '2026-08-26' }), withImage({ id: 'shown' })], today, []);
    assert.equal(picked?.id, 'shown');
  });

  test('will not post something that has already happened', () => {
    assert.equal(pickPost([withImage({ id: 'past', startDate: '2026-08-01' })], today, []), undefined);
  });

  test('will not post something months away — the channel is about what is on', () => {
    assert.equal(pickPost([withImage({ id: 'far', startDate: '2027-01-01' })], today, []), undefined);
  });

  test('nothing to say is an answer, not a placeholder post', () => {
    assert.equal(pickPost([], today, []), undefined);
  });

  test('skips an event enrichment never described — a bare listing is a poor post', () => {
    const bare = withImage({ id: 'bare', descriptions: { en: '', it: '', ru: '' } });
    assert.equal(pickPost([bare], today, []), undefined);
  });
});

describe('renderPost', () => {
  test('leads with the title, says when and where, and links to our page', () => {
    const post = renderPost(withImage({ venue: 'Teatro Carlo Felice', city: 'genova' }), 'it');
    assert.ok(post.caption.includes('Concerto di Ferragosto'));
    assert.ok(post.caption.includes('Teatro Carlo Felice'));
    assert.equal(post.photo, 'https://s1.ticketm.net/1.jpg');
    assert.equal(post.url, 'https://dovego.it/it/event/aaaabbbbcccc/');
  });

  test('escapes markup in a scraped title rather than sending broken HTML', () => {
    const post = renderPost(withImage({ title: 'Rock & <Roll>' }), 'it');
    assert.ok(post.caption.includes('Rock &amp; &lt;Roll&gt;'));
  });

  test('stays inside the caption limit Telegram enforces on a photo', () => {
    const long = 'x '.repeat(900);
    const post = renderPost(withImage({ descriptions: { en: long, it: long, ru: long } }), 'it');
    assert.ok(post.caption.length <= 1024, `caption was ${post.caption.length}`);
  });

  test('the link counts against that limit — it is part of the caption', () => {
    // It was appended after the body had been clipped to fit, and Telegram
    // refused the whole post: "message caption is too long".
    const long = 'parola '.repeat(400);
    const post = renderPost(
      withImage({
        title: 'Un titolo abbastanza lungo per contare qualcosa nel budget',
        venue: 'Teatro Comunale di Un Posto Con Un Nome Lungo',
        descriptions: { en: long, it: long, ru: long },
      }),
      'it',
    );
    assert.ok(post.caption.includes(post.url), 'the link has to be in the caption');
    assert.ok(post.caption.length <= 1024, `caption was ${post.caption.length}`);
  });

  test('a description that leaves no room still yields a postable caption', () => {
    const post = renderPost(
      withImage({ title: 'T'.repeat(900), descriptions: { en: 'x', it: 'x', ru: 'x' } }),
      'it',
    );
    assert.ok(post.caption.includes(post.url));
  });
});

describe('rememberPosted', () => {
  test('keeps the newest ids and forgets the oldest, so the key cannot grow forever', () => {
    const kept = rememberPosted(['a', 'b', 'c'], 'd', 3);
    assert.deepEqual(kept, ['b', 'c', 'd']);
  });

  test('does not record the same id twice', () => {
    assert.deepEqual(rememberPosted(['a', 'b'], 'b', 5), ['a', 'b']);
  });
});

describe('postDaily', () => {
  const index = [withImage({ id: 'aaaabbbbcccc', startDate: '2026-08-27' })];
  const today = '2026-08-25';

  // Typed as the real bindings rather than cast into them, so a signature
  // change breaks the double instead of being papered over.
  const kv = (seed: Readonly<Record<string, string>>) => {
    const store = new Map(Object.entries(seed));
    const binding: KvLike = {
      get: async (key) => store.get(key) ?? null,
      put: async (key, value) => {
        store.set(key, value);
      },
      delete: async (key) => {
        store.delete(key);
      },
      list: async () => ({ keys: [], list_complete: true }),
    };
    return { store, binding };
  };

  const env = (channel: string, binding: KvLike): Env => ({
    EVENTS: binding,
    AI: { run: async () => ({}) },
    BOT_TOKEN: 't',
    WEBHOOK_SECRET: '',
    OWNER_CHAT_ID: '',
    CHANNEL_CHAT_ID: channel,
  });

  test('says nothing at all when no channel is configured', async () => {
    const { binding } = kv({});
    assert.deepEqual(await postDaily(env('', binding), index, today, 10), { kind: 'not-due' });
  });

  test('posts at the hour it was told, and not at another one', async () => {
    const { binding } = kv({});
    assert.deepEqual(await postDaily(env('@dovego', binding), index, today, 9), { kind: 'not-due' });
  });

  test('sends a photo, links to the site, and remembers what it sent', async () => {
    const { binding, store } = kv({});
    const sent: Readonly<{ url: string; body: unknown }>[] = [];
    const fetchFn: FetchFn = async (input, init) => {
      sent.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), { status: 200 });
    };
    const result = await postDaily(env('@dovego', binding), index, today, 10, fetchFn);
    assert.deepEqual(result, { kind: 'posted', id: 'aaaabbbbcccc', messageId: 7 });
    assert.ok(sent[0]?.url.endsWith('/sendPhoto'));
    const body = sent[0]?.body;
    assert.equal(readProp(body, 'chat_id'), '@dovego');
    assert.ok(String(readProp(body, 'caption')).includes('https://dovego.it/it/event/aaaabbbbcccc/'));
    assert.equal(store.get('channel:posted'), '["aaaabbbbcccc"]');
  });

  test('the picture is served by us, not fetched by Telegram from the source', async () => {
    // Telegram fetches the URL itself and a source CDN is free to refuse it —
    // which is exactly how the first real post failed.
    const { binding } = kv({ 'indexnow-unused': '' });
    const sent: unknown[] = [];
    const fetchFn: FetchFn = async (_input, init) => {
      sent.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), { status: 200 });
    };
    await postDaily(env('@dovego', binding), index, today, 10, fetchFn);
    const photo = String(readProp(sent[0], 'photo'));
    assert.ok(photo.startsWith('https://dovego.it/cdn-cgi/image/'), photo);
    assert.ok(photo.includes('width=1200,height=630'));
  });

  test('a refused send is reported and NOT struck off the list', async () => {
    // The first live post reported success while the channel stayed empty: the
    // send had failed and the event was recorded as said, so it never came back.
    const { binding, store } = kv({});
    const refusing: FetchFn = async () =>
      new Response(JSON.stringify({ ok: false, description: 'Bad Request: wrong file identifier' }), {
        status: 400,
      });
    const result = await postDaily(env('@dovego', binding), index, today, 10, refusing);
    assert.equal(readProp(result, 'kind'), 'failed');
    assert.ok(String(readProp(result, 'error')).includes('wrong file identifier'));
    assert.equal(store.get('channel:posted'), undefined);
  });

  test('does not repeat itself the next day', async () => {
    const { binding } = kv({ 'channel:posted': '["aaaabbbbcccc"]' });
    assert.deepEqual(await postDaily(env('@dovego', binding), index, today, 10), { kind: 'nothing-to-say' });
  });
});

describe('channelPhotoUrl', () => {
  test('routes a source image through our own crop', () => {
    const url = channelPhotoUrl('https://s1.ticketm.net/dam/a/1b2/3.jpg');
    assert.ok(url.startsWith('https://dovego.it/cdn-cgi/image/width=1200,height=630,fit=cover'));
    assert.ok(url.includes('/img/'));
    // Path-safe: no slash or plus can survive into a URL path segment.
    assert.match(url.split('/img/')[1] ?? '', /^[A-Za-z0-9_-]+$/);
  });

  test('an upload already on our origin needs no proxy hop', () => {
    assert.equal(
      channelPhotoUrl('/uploads/ab/cd.jpg'),
      'https://dovego.it/cdn-cgi/image/width=1200,height=630,fit=cover,quality=82,format=jpeg/uploads/ab/cd.jpg',
    );
  });
});

describe('leadOf', () => {
  const article = [
    'La mostra presenta vent’anni di alta moda.',
    '',
    '## [programme] Programma',
    '- Collezioni dal 2005 al 2025',
    '',
    '## [getting-there] Dove si trova',
    'Armani/Silos, Milano.',
  ].join('\n');

  test('keeps the lead and drops the article', () => {
    // The first channel post carried "## [programme] Programma" into a public
    // feed: Telegram renders no Markdown at all.
    assert.equal(leadOf(article), 'La mostra presenta vent’anni di alta moda.');
  });

  test('a description that is only a lead survives whole', () => {
    assert.equal(leadOf('Un concerto sul mare.'), 'Un concerto sul mare.');
  });

  test('a lead of several sentences keeps them all, on one line', () => {
    assert.equal(leadOf('Uno.\nDue.\n\n## [when] Quando\nOggi.'), 'Uno. Due.');
  });

  test('a description that opens straight into a section has no lead to take', () => {
    // Degenerate, but it must not put a raw heading in the post.
    assert.equal(leadOf('## [when] Quando\nOggi.'), '');
  });

  test('nothing in, nothing out', () => {
    assert.equal(leadOf(''), '');
  });
});
