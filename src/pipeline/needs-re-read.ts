import type { EventRecord } from '../domain/event.ts';
import { ENRICH_VERSION } from '../llm/enrich.ts';
import { spanContradictsText } from './span-contradicts-text.ts';

/** Below this version a reading is out of date for every record: the shape
 *  of the article itself changed. */
const EVERY_RECORD_BELOW = 12;

/**
 * Whether a record's reading is stale enough to read its source again.
 *
 * Version 13 asks for two things only some records can be wrong about: the
 * run the page states, and whether a festival that runs every day was taken
 * for a container of its highlights. Reading all 1,500 records again for it
 * would take the 24-a-run budget weeks; the ones that can be wrong are found
 * instead — every container whose programme was read from text, and every
 * record whose span its own article contradicts.
 */
export const needsReRead = (event: EventRecord): boolean => {
  const version = event.enrichVersion ?? 0;
  if (version >= ENRICH_VERSION) return false;
  if (version < EVERY_RECORD_BELOW) return true;
  if (event.listedProgramme === true) return false;
  return event.kind === 'container' || spanContradictsText(event);
};
