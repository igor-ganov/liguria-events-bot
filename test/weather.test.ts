// T15 — Open-Meteo forecast shaping and graceful failure (AC-6.3).
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { fetchForecast } from '../src/weather/open-meteo.ts';

describe('fetchForecast', () => {
  test('parses the daily arrays', async () => {
    const payload = JSON.stringify({
      daily: {
        time: ['2026-07-04', '2026-07-05'],
        temperature_2m_max: [27.8, 30.1],
        precipitation_probability_max: [10, 65],
      },
    });
    const fetchFn = async (): Promise<Response> => new Response(payload);
    const forecast = await fetchForecast(fetchFn, '2026-07-04', '2026-07-05');
    assert.deepEqual(forecast, [
      { date: '2026-07-04', tMaxC: 28, precipitationChance: 10 },
      { date: '2026-07-05', tMaxC: 30, precipitationChance: 65 },
    ]);
  });

  test('HTTP error or malformed body → undefined', async () => {
    const failing = async (): Promise<Response> => new Response('x', { status: 500 });
    assert.equal(await fetchForecast(failing, '2026-07-04', '2026-07-05'), undefined);
    const garbage = async (): Promise<Response> => new Response('{"daily":{}}');
    assert.equal(await fetchForecast(garbage, '2026-07-04', '2026-07-05'), undefined);
  });
});
