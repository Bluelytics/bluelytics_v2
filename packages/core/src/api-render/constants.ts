import type { RenderedKey } from '../types.ts';

/** Exact `Content-Type` values of the legacy API (note the capital `UTF-8` and the bare `text/csv`). */
export const CONTENT_TYPE = {
  json: 'application/json; charset=UTF-8',
  javascript: 'application/javascript; charset=UTF-8',
  csv: 'text/csv',
  text: 'text/plain; charset=UTF-8',
} as const;

/** Fixed response bodies, byte for byte. Every JSON body ends in exactly one `\n`; `root` has none. */
export const BODY = {
  root: 'OK',
  null: 'null\n',
  csvHeader: 'day,type,value_buy,value_sell\n',
  notFound: '{"message":"Not Found"}\n',
  methodNotAllowed: '{"message":"Method Not Allowed"}\n',
  internalServerError: '{"message":"Internal Server Error"}\n',
  /** New in v2: rejected JSONP callback (status 400). The legacy API reflected any callback. */
  badRequest: '{"message":"Bad Request"}\n',
  badDay: '{"error":"Error: parsing day parameter: use YYYY-MM-DD"}\n',
  dayNotFound: '{"error":"Error: day not found"}\n',
} as const;

/** CORS header values of the legacy echo middleware. */
export const CORS = {
  allowOrigin: '*',
  allowMethods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  vary: 'Origin',
  preflightVary: ['Origin', 'Access-Control-Request-Method', 'Access-Control-Request-Headers'],
} as const;

export const RENDERED_CONTENT_TYPE: Record<RenderedKey, string> = {
  latest: CONTENT_TYPE.json,
  last_price: CONTENT_TYPE.json,
  alerts: CONTENT_TYPE.json,
  currency: CONTENT_TYPE.json,
  evolution_json: CONTENT_TYPE.json,
  evolution_csv: CONTENT_TYPE.csv,
};
