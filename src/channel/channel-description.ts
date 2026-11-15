import { WHOLE_COUNTRY } from './channel-entry.ts';
import { regionLabel } from './region-label.ts';

/** The country-wide channel's card: the one that really does cover Italy. */
const NATIONAL =
  "Cosa fare in Italia, ogni giorno. Concerti, mostre, teatro, sagre e mercatini — raccolti automaticamente e pubblicati in un digest quotidiano.\n\nCerca per città e data su dovego.it";

/**
 * What a channel's profile card says, for the region it actually speaks for.
 *
 * The card is read before Join is pressed, and a channel whose posts are Genova
 * under a promise of all of Italy is a channel people leave. The region is set
 * off by a dash rather than folded into the sentence, for the same reason the
 * daily heading does it: Italian wants "in Liguria" but "nel Lazio" and "nelle
 * Marche", and copy that declines wrongly reads as machine-made.
 */
export const channelDescription = (region: string): string =>
  region === WHOLE_COUNTRY
    ? NATIONAL
    : `${regionLabel(region)} — cosa fare, ogni giorno. Concerti, mostre, teatro, sagre e mercatini, raccolti automaticamente e pubblicati in un digest quotidiano.\n\nCerca per città e data su dovego.it`;
