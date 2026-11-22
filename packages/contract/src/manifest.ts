/** Names of the captures in `golden/` (file stem of `<name>.body` / `<name>.headers`). */
export const GOLDEN_NAMES = [
  'root',
  'v2_latest',
  'origin',
  'v2_latest_jsonp',
  'v2_alerts',
  'v1_last_price',
  'v1_last_price_jsonp',
  'evolution_full',
  'evolution_days5',
  'evolution_days_bad',
  'evolution_days_big',
  'evolution_days0',
  'evolution_daysneg',
  'evolution_csv_full',
  'evolution_csv_days3',
  'historical_weekday',
  'historical_sat',
  'historical_sun',
  'historical_missing',
  'historical_bad',
  'historical_old',
  'historical_future',
  'currency',
  'notfound',
  'latest_slash',
  'options',
  'post',
] as const;

export type GoldenName = (typeof GOLDEN_NAMES)[number];

/** One entry of `golden-manifest.json`. */
export interface GoldenCapture {
  name: GoldenName;
  method: 'GET' | 'OPTIONS' | 'POST';
  path: string;
  /** Raw query string without `?`, or `null`. */
  query: string | null;
  requestHeaders: Record<string, string>;
  /** `documented`: the request is given by legacy-backend-spec A.9; `representative`: a stand-in with the same documented behaviour. */
  request: 'documented' | 'representative';
  status: number;
  /** `null` when the response had no `Content-Type` (OPTIONS). */
  contentType: string | null;
  /**
   * `static`: byte-comparable for a database seeded from the goldens; `time-varying`: changes with
   * every scrape, so compare live systems structurally; `empty`: no body.
   */
  body: 'static' | 'time-varying' | 'empty';
  bytes: number;
  sha256: string;
  capturedAt: string;
  /** Cloudflare `cf-cache-status` at capture time. */
  edgeCache: string | null;
  notes: string;
}
