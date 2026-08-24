const SITE = 'https://dovego.it';

/** Every locale an event page is built in. English lives at the root. */
export const eventUrls = (id: string): readonly string[] => [
  `${SITE}/event/${id}/`,
  `${SITE}/it/event/${id}/`,
  `${SITE}/ru/event/${id}/`,
];
