/** RS256 JSON Web Tokens with WebCrypto (Workers and Node), for the Google service-account OAuth flow. */

const encoder = new TextEncoder();

export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** DER bytes of a PEM `PRIVATE KEY` (PKCS #8, the format of service-account JSON files). */
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
