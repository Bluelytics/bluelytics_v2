interface WebPlatform {
  crypto: { subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } };
  TextEncoder: new () => { encode(input: string): Uint8Array };
}

// Structural view of the two WebCrypto/Encoding globals, so this file needs neither DOM, Node nor
// Workers typings and type-checks identically under all of them.
const platform = globalThis as unknown as WebPlatform;

const ETAG_HEX_DIGITS = 16;

/** Lower-case hex SHA-256 of the UTF-8 bytes of `text`. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await platform.crypto.subtle.digest('SHA-256', new platform.TextEncoder().encode(text));
  let hex = '';
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** Strong ETag of a response body: the first 16 hex digits of its SHA-256, in double quotes. */
export async function etag(body: string): Promise<string> {
  return `"${(await sha256Hex(body)).slice(0, ETAG_HEX_DIGITS)}"`;
}
