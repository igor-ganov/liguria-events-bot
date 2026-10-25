import type { EventRecord, StatedRun } from './event.ts';

/**
 * The record on the dates its source page states, when the listing said
 * otherwise.
 *
 * A listing's dates are not always the event's: visitgenoa listed the Festival
 * della Scienza from 14 October to 24 February while its page said 22 October
 * to 1 November, and a concert postponed by a year was listed for the whole
 * year in between. The page's own words win — but only inside what the listing
 * allowed (a model's reading never stretches an event past its source), or to
 * give a last day to a listing that named only the first.
 *
 * A container is left alone: its days are its programme. So is a programme a
 * source lists date by date.
 */
export const narrowedToRun = (event: EventRecord, run: StatedRun | undefined): EventRecord => {
  if (run === undefined || event.kind === 'container' || event.listedProgramme === true) return event;
  const end = run.end ?? run.start;
  const inside =
    end >= run.start &&
    run.start >= event.startDate &&
    (event.endDate === undefined ? run.start === event.startDate : end <= event.endDate);
  const same = run.start === event.startDate && end === (event.endDate ?? event.startDate);
  if (!inside || same) return event;
  const { endDate: _listed, ...rest } = event;
  return {
    ...rest,
    startDate: run.start,
    ...(end === run.start ? {} : { endDate: end }),
    statedRun: run,
  };
};
