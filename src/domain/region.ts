/**
 * The region dimension — what the site is sliced by.
 *
 * The city (the capital of an event's province) stays on the record: it is the
 * anchor the geocoder searches around, and a region is far too wide to tell a
 * good answer from a wrong one. But a region is what a visitor browses: every
 * one of the twenty is populated, whereas most of the 107 province capitals
 * carry a handful of events at best.
 */
import { citySlug, cityOfProvince } from './city.ts';

export type Region = Readonly<{ slug: string; name: string }>;

/** Province codes by region — the whole of Italy, 107 provinces. */
const PROVINCES: Readonly<Record<string, readonly string[]>> = {
  Abruzzo: ['AQ', 'CH', 'PE', 'TE'],
  Basilicata: ['MT', 'PZ'],
  Calabria: ['CS', 'CZ', 'KR', 'RC', 'VV'],
  Campania: ['AV', 'BN', 'CE', 'NA', 'SA'],
  'Emilia-Romagna': ['BO', 'FC', 'FE', 'MO', 'PC', 'PR', 'RA', 'RE', 'RN'],
  'Friuli-Venezia Giulia': ['GO', 'PN', 'TS', 'UD'],
  Lazio: ['FR', 'LT', 'RI', 'RM', 'VT'],
  Liguria: ['GE', 'IM', 'SP', 'SV'],
  Lombardia: ['BG', 'BS', 'CO', 'CR', 'LC', 'LO', 'MB', 'MI', 'MN', 'PV', 'SO', 'VA'],
  Marche: ['AN', 'AP', 'FM', 'MC', 'PU'],
  Molise: ['CB', 'IS'],
  Piemonte: ['AL', 'AT', 'BI', 'CN', 'NO', 'TO', 'VB', 'VC'],
  Puglia: ['BA', 'BR', 'BT', 'FG', 'LE', 'TA'],
  Sardegna: ['CA', 'NU', 'OR', 'SS', 'SU'],
  Sicilia: ['AG', 'CL', 'CT', 'EN', 'ME', 'PA', 'RG', 'SR', 'TP'],
  Toscana: ['AR', 'FI', 'GR', 'LI', 'LU', 'MS', 'PI', 'PO', 'PT', 'SI'],
  'Trentino-Alto Adige': ['BZ', 'TN'],
  Umbria: ['PG', 'TR'],
  "Valle d'Aosta": ['AO'],
  Veneto: ['BL', 'PD', 'RO', 'TV', 'VE', 'VI', 'VR'],
};

export const ALL_REGIONS: readonly Region[] = Object.keys(PROVINCES)
  .map((name) => ({ slug: citySlug(name), name }))
  .toSorted((a, b) => a.name.localeCompare(b.name));

const BY_PROVINCE: ReadonlyMap<string, Region> = new Map(
  Object.entries(PROVINCES).flatMap(([name, codes]) =>
    codes.map((code) => [code, { slug: citySlug(name), name }] as const),
  ),
);

export const regionOfProvince = (code: string): Region | undefined =>
  BY_PROVINCE.get(code.trim().toUpperCase());

/** Built from the same table, so a capital and its province cannot disagree. */
const BY_CITY: ReadonlyMap<string, Region> = new Map(
  [...BY_PROVINCE.entries()].flatMap(([code, region]) => {
    const capital = cityOfProvince(code);
    return capital === undefined ? [] : [[capital.slug, region] as const];
  }),
);

/** The region a city (province capital) belongs to. */
export const regionOfCity = (city: string): Region | undefined =>
  BY_CITY.get(city.trim().toLowerCase());
