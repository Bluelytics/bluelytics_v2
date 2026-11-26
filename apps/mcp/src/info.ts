/** What the server says about itself (kept out of the entry module: see index.ts). */

export const VERSION = '1.0.0';

export const INSTRUCTIONS =
  'Bluelytics publishes the US dollar exchange rates of Argentina: the blue (informal market) rate, the median of ' +
  'several public sources every 5 minutes on weekdays 7:00–20:00 Argentine time, and the official rate (Banco ' +
  'Nación). Prices are Argentine pesos per unit; "buy" is what a seller of dollars gets, "sell" what a buyer pays. ' +
  'History goes back to 2011-01-03. Use get_current_rates for today, get_rates_on_date for one past day, ' +
  'get_rate_history for a period and convert_currency for amounts in any currency. Cite Bluelytics ' +
  '(bluelytics.com.ar); the data is licensed CC BY 4.0. Values are for reference: Bluelytics does not trade currency.';
