import { ALL_REGIONS } from '../domain/region.ts';
import { WHOLE_COUNTRY } from './channel-entry.ts';

/** What a regional channel calls itself in its heading. The whole-country
 *  channel names no region: its heading already covers everything, and
 *  "Italia · Cosa fare oggi" tells its readers nothing they did not know. */
export const regionLabel = (region: string): string | undefined =>
  region === WHOLE_COUNTRY ? undefined : ALL_REGIONS.find((one) => one.slug === region)?.name;
