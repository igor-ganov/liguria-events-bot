/**
 * A campaign name: the month, then what it is.
 *
 * The month comes first so a report sorts chronologically — the convention the
 * panel's campaign rows are read with — and it rolls over on its own, so
 * nobody has to remember to rename anything in January.
 */
export const monthTag = (today: string, name: string): string => `${today.slice(0, 7)}-${name}`;
