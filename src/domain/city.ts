/**
 * The city dimension. An event belongs to the city whose *scene* it is part of,
 * not to the comune it literally sits in: the Sagra dei Ravioli in Sori is a
 * Genoa-area event, and someone browsing Genoa wants to see it. Italian
 * addresses already encode exactly that grouping — the two-letter province code
 * — so the province capital is the city an event is filed under.
 */
export type City = Readonly<{ slug: string; name: string }>;

/** Province code → its capital. Only the codes we can actually file events
 *  under; an unknown code leaves the event city-less rather than guessing. */
const CAPITALS: Readonly<Record<string, string>> = {
  AG: 'Agrigento', AL: 'Alessandria', AN: 'Ancona', AO: 'Aosta', AP: 'Ascoli Piceno',
  AQ: "L'Aquila", AR: 'Arezzo', AT: 'Asti', AV: 'Avellino', BA: 'Bari', BG: 'Bergamo',
  BI: 'Biella', BL: 'Belluno', BN: 'Benevento', BO: 'Bologna', BR: 'Brindisi', BS: 'Brescia',
  BT: 'Barletta', BZ: 'Bolzano', CA: 'Cagliari', CB: 'Campobasso', CE: 'Caserta',
  CH: 'Chieti', CL: 'Caltanissetta', CN: 'Cuneo', CO: 'Como', CR: 'Cremona', CS: 'Cosenza',
  CT: 'Catania', CZ: 'Catanzaro', EN: 'Enna', FC: 'Forlì', FE: 'Ferrara', FG: 'Foggia',
  FI: 'Firenze', FM: 'Fermo', FR: 'Frosinone', GE: 'Genova', GO: 'Gorizia', GR: 'Grosseto',
  IM: 'Imperia', IS: 'Isernia', KR: 'Crotone', LC: 'Lecco', LE: 'Lecce', LI: 'Livorno',
  LO: 'Lodi', LT: 'Latina', LU: 'Lucca', MB: 'Monza', MC: 'Macerata', ME: 'Messina',
  MI: 'Milano', MN: 'Mantova', MO: 'Modena', MS: 'Massa', MT: 'Matera', NA: 'Napoli',
  NO: 'Novara', NU: 'Nuoro', OR: 'Oristano', PA: 'Palermo', PC: 'Piacenza', PD: 'Padova',
  PE: 'Pescara', PG: 'Perugia', PI: 'Pisa', PN: 'Pordenone', PO: 'Prato', PR: 'Parma',
  PT: 'Pistoia', PU: 'Pesaro', PV: 'Pavia', PZ: 'Potenza', RA: 'Ravenna',
  RC: 'Reggio Calabria', RE: 'Reggio Emilia', RG: 'Ragusa', RI: 'Rieti', RM: 'Roma',
  RN: 'Rimini', RO: 'Rovigo', SA: 'Salerno', SI: 'Siena', SO: 'Sondrio', SP: 'La Spezia',
  SR: 'Siracusa', SS: 'Sassari', SU: 'Carbonia', SV: 'Savona', TA: 'Taranto',
  TE: 'Teramo', TN: 'Trento', TO: 'Torino', TP: 'Trapani', TR: 'Terni', TS: 'Trieste',
  TV: 'Treviso', UD: 'Udine', VA: 'Varese', VB: 'Verbania', VC: 'Vercelli', VE: 'Venezia',
  VI: 'Vicenza', VR: 'Verona', VT: 'Viterbo', VV: 'Vibo Valentia',
};

/** URL-safe, accent-free slug: "Reggio Calabria" → "reggio-calabria". */
export const citySlug = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** The city an event in this province is filed under. */
export const cityOfProvince = (code: string): City | undefined => {
  const name = CAPITALS[code.trim().toUpperCase()];
  return name === undefined ? undefined : { slug: citySlug(name), name };
};

/** Every city the platform can file events under, alphabetical. */
export const ALL_CITIES: readonly City[] = Object.values(CAPITALS)
  .map((name) => ({ slug: citySlug(name), name }))
  .toSorted((a, b) => a.name.localeCompare(b.name));

/** The city a visitor lands on when the URL names none. */
export const DEFAULT_CITY = 'genova';
