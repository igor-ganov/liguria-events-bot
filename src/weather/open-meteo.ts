/**
 * Open-Meteo forecast for Genoa (design §5, AC-6.3). Free, no API key.
 * Any failure degrades to `undefined` — the plan is then built without
 * weather notes.
 */
import { asArray, asNumber, asString, readAt, readProp } from '../util/json.ts';
import type { FetchFn } from '../collectors/types.ts';

export type DayForecast = Readonly<{
  date: string;
  tMaxC: number;
  precipitationChance: number;
}>;

const GENOA_LAT = 44.4056;
const GENOA_LON = 8.9463;

const forecastUrl = (from: string, to: string): string =>
  `https://api.open-meteo.com/v1/forecast?latitude=${GENOA_LAT}&longitude=${GENOA_LON}` +
  `&daily=temperature_2m_max,precipitation_probability_max&timezone=Europe%2FRome` +
  `&start_date=${from}&end_date=${to}`;

export const fetchForecast = async (
  fetchFn: FetchFn,
  from: string,
  to: string,
): Promise<readonly DayForecast[] | undefined> => {
  try {
    const response = await fetchFn(forecastUrl(from, to));
    if (!response.ok) return undefined;
    const payload: unknown = await response.json();
    const daily = readProp(payload, 'daily');
    const dates = asArray(readProp(daily, 'time')) ?? [];
    const tMax = readProp(daily, 'temperature_2m_max');
    const precipitation = readProp(daily, 'precipitation_probability_max');
    const days = dates.flatMap((value, i): readonly DayForecast[] => {
      const date = asString(value);
      const t = asNumber(readAt(tMax, i));
      const p = asNumber(readAt(precipitation, i));
      return date === undefined || t === undefined || p === undefined
        ? []
        : [{ date, tMaxC: Math.round(t), precipitationChance: Math.round(p) }];
    });
    return days.length === 0 ? undefined : days;
  } catch {
    return undefined;
  }
};
