/**
 * Centres of the cities events are filed under. A constant, so it belongs in
 * the code: resolving it over the network cost a request per event and, worse,
 * hammered one KV key from hundreds of parallel callers until KV answered 429
 * and took the whole crawl down with it.
 *
 * Two jobs: the anchor a geocoded address is searched around, and the sanity
 * check that refuses an answer landing in the wrong half of the country
 * ("Città Vecchia, Genova" resolves to the old town of TRIESTE).
 *
 * Generated once from Nominatim; [lat, lng].
 */
export const CITY_CENTRES: Readonly<Record<string, readonly [number, number]>> = {
  'agrigento': [37.3123, 13.5747],
  'alessandria': [44.8350, 8.7450],
  'ancona': [43.4801, 13.2187],
  'aosta': [45.7373, 7.3204],
  'arezzo': [43.5171, 11.7639],
  'ascoli-piceno': [42.8834, 13.5396],
  'asti': [44.8260, 8.2027],
  'avellino': [40.9965, 15.1406],
  'bari': [41.1258, 16.8620],
  'barletta': [41.3215, 16.2869],
  'belluno': [46.2805, 12.0789],
  'benevento': [41.2476, 14.7057],
  'bergamo': [45.7567, 9.7542],
  'biella': [45.5670, 8.0869],
  'bologna': [44.4938, 11.3426],
  'bolzano': [46.6559, 11.2302],
  'brescia': [45.7796, 10.4259],
  'brindisi': [40.6359, 17.6885],
  'cagliari': [39.2172, 9.1133],
  'caltanissetta': [37.4903, 14.0633],
  'campobasso': [41.7173, 14.8262],
  'carbonia': [39.1653, 8.5278],
  'caserta': [41.2035, 14.1169],
  'catania': [37.5024, 15.0874],
  'catanzaro': [38.8300, 16.4316],
  'chieti': [42.1027, 14.4159],
  'como': [45.9395, 9.1494],
  'cosenza': [39.5967, 16.3331],
  'cremona': [45.2209, 10.0370],
  'crotone': [39.1874, 16.8783],
  'cuneo': [44.4581, 7.5581],
  'enna': [37.5668, 14.2807],
  'fermo': [43.0922, 13.6388],
  'ferrara': [44.7668, 11.8279],
  'firenze': [43.7698, 11.2556],
  'foggia': [41.5028, 15.4529],
  'forli': [44.2227, 12.0413],
  'frosinone': [41.6285, 13.5758],
  'genova': [44.4073, 8.9339],
  'gorizia': [45.9441, 13.6252],
  'grosseto': [42.7751, 11.2878],
  'imperia': [43.9584, 7.8667],
  'isernia': [41.6495, 14.2081],
  'l-aquila': [42.1369, 13.6103],
  'la-spezia': [44.2384, 9.6912],
  'latina': [41.4595, 13.0126],
  'lecce': [40.1522, 18.2261],
  'lecco': [45.9005, 9.4120],
  'livorno': [42.7902, 10.3402],
  'lodi': [45.2613, 9.4917],
  'lucca': [44.0178, 10.4544],
  'macerata': [43.1530, 13.1509],
  'mantova': [45.1693, 10.6708],
  'massa': [44.0359, 10.1396],
  'matera': [40.4476, 16.4736],
  'messina': [38.1938, 15.5542],
  'milano': [45.4642, 9.1896],
  'modena': [44.5385, 10.9360],
  'monza': [45.6395, 9.2788],
  'napoli': [40.8359, 14.2488],
  'novara': [45.5842, 8.5460],
  'nuoro': [40.2641, 9.1272],
  'oristano': [40.0266, 8.6796],
  'padova': [45.3914, 11.8058],
  'palermo': [38.1112, 13.3524],
  'parma': [44.6952, 10.0980],
  'pavia': [45.0369, 9.1378],
  'perugia': [43.1070, 12.4030],
  'pesaro': [43.9098, 12.9131],
  'pescara': [42.3103, 13.9576],
  'piacenza': [44.8476, 9.6665],
  'pisa': [43.4715, 10.6798],
  'pistoia': [43.9741, 10.8687],
  'pordenone': [45.9563, 12.6597],
  'potenza': [40.5173, 15.8216],
  'prato': [43.9357, 11.0941],
  'ragusa': [36.9257, 14.7308],
  'ravenna': [44.3641, 12.0590],
  'reggio-calabria': [38.1035, 15.6398],
  'reggio-emilia': [44.6087, 10.5941],
  'rieti': [42.4147, 12.8859],
  'rimini': [43.9465, 12.6307],
  'roma': [41.8933, 12.4829],
  'rovigo': [44.9776, 12.2801],
  'salerno': [40.4194, 15.3106],
  'sassari': [40.7235, 8.5613],
  'savona': [44.2334, 8.2526],
  'siena': [43.1672, 11.4676],
  'siracusa': [37.0316, 15.2124],
  'sondrio': [46.3234, 10.2584],
  'taranto': [40.5488, 17.0806],
  'teramo': [42.6581, 13.6979],
  'terni': [42.6539, 12.4397],
  'torino': [45.0678, 7.6825],
  'trapani': [37.9004, 12.7116],
  'trento': [46.1030, 11.1297],
  'treviso': [45.8067, 12.2063],
  'trieste': [45.6496, 13.7773],
  'udine': [46.0635, 13.2358],
  'varese': [45.8399, 8.7542],
  'venezia': [45.4046, 12.3105],
  'verbania': [45.9344, 8.5580],
  'vercelli': [45.5554, 8.3463],
  'verona': [45.4425, 10.9857],
  'vibo-valentia': [38.6267, 16.0987],
  'vicenza': [45.6349, 11.4064],
  'viterbo': [42.4930, 11.9488],
};

export const centreOfCity = (city: string): readonly [number, number] | undefined =>
  CITY_CENTRES[city];

/** The city a point belongs to, by nearest province capital. Sources that hand
 *  us coordinates but no province (Ticketmaster names the comune — "Assago" —
 *  and nothing else) still need filing under a city, and the nearest capital is
 *  its province in all but a handful of border cases; the region it rolls up to
 *  is right regardless. */
export const nearestCity = (lat: number, lng: number): string | undefined => {
  const scored = Object.entries(CITY_CENTRES).map(([slug, [cLat, cLng]]) => {
    // Longitude degrees shrink with latitude; at 43°N a degree of longitude is
    // about 0.73 of a degree of latitude. Enough for "which is closest".
    const dLat = lat - cLat;
    const dLng = (lng - cLng) * 0.73;
    return { slug, d2: dLat * dLat + dLng * dLng };
  });
  return scored.toSorted((a, b) => a.d2 - b.d2)[0]?.slug;
};
