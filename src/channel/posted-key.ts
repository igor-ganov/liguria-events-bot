/** The channel's memory of what it has already said.
 *
 *  One key per channel, because the memory is per audience: the whole-country
 *  channel and a regional one cover the same evening on purpose, and with a
 *  single key the first post struck the events off and the second went out
 *  empty. */
export const postedKey = (region: string): string => `channel:posted:${region}`;

/** Where the whole country's history lived when there was only one channel.
 *  Read once, so the day of the rollout does not repeat a week of posts. */
export const LEGACY_POSTED_KEY = 'channel:posted';
