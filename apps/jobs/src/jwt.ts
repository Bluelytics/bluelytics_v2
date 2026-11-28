/**
 * JSON Web Tokens with WebCrypto (Workers and Node): RS256 for the Google service-account OAuth flow,
 * ES256 for APNs provider tokens.
 */

const encoder = new TextEncoder();

export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** DER bytes of a PEM `PRIVATE KEY` (PKCS #8: service-account JSON files and Apple's `.p8` keys). */
export function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const match = pem.match(/-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/);
  if (!match?.[1]) throw new TypeError('private key is not a PEM "PRIVATE KEY" (PKCS #8)');
  const binary = atob(match[1].replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function signRs256Jwt(header: Record<string, unknown>, claims: Record<string, unknown>, privateKeyPem: string): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(privateKeyPem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const input = `${base64Url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT', ...header })))}.${base64Url(encoder.encode(JSON.stringify(claims)))}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(input));
  return `${input}.${base64Url(new Uint8Array(signature))}`;
}

function signingInput(header: Record<string, unknown>, claims: Record<string, unknown>, alg: string): string {
  return `${base64Url(encoder.encode(JSON.stringify({ alg, typ: 'JWT', ...header })))}.${base64Url(encoder.encode(JSON.stringify(claims)))}`;
}

/** ES256 (ECDSA P-256). WebCrypto returns the raw r‖s signature JWS expects, so no DER conversion. */
export async function signEs256Jwt(header: Record<string, unknown>, claims: Record<string, unknown>, privateKeyPem: string): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(privateKeyPem), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const input = signingInput(header, claims, 'ES256');
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(input));
  return `${input}.${base64Url(new Uint8Array(signature))}`;
}
