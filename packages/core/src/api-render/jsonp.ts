const CALLBACK = /^[A-Za-z0-9_$.[\]]{1,128}$/;

/** v2 restriction on `?callback=`: `[A-Za-z0-9_$.\[\]]{1,128}`. Anything else is answered with 400. */
export function isValidJsonpCallback(callback: string): boolean {
  return CALLBACK.test(callback);
}

/**
 * The legacy JSONP wrapper, byte for byte: `callback(` + the JSON body including its trailing
 * `\n` + `);` with nothing after the semicolon. Serve with `CONTENT_TYPE.javascript`.
 */
export function wrapJsonp(callback: string, jsonBody: string): string {
  return `${callback}(${jsonBody});`;
}
