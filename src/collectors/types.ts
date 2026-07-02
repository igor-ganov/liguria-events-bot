/** Collector contract (design §4). A failed source never throws — it reports
 *  `failed: true` and the run continues (AC-1.3). */
import type { RawEvent } from '../domain/event.ts';

export type RawPost = Readonly<{
  channel: string;
  messageId: number;
  /** Unix seconds. */
  date: number;
  text: string;
}>;

export type CollectOutcome = Readonly<{
  source: string;
  events: readonly RawEvent[];
  posts: readonly RawPost[];
  failed: boolean;
}>;

export type Collector = () => Promise<CollectOutcome>;

export type { FetchFn } from '../util/http.ts';
