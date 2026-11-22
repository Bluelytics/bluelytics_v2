import type { webcrypto } from 'node:crypto';

/** A throwaway RSA key in service-account JSON form, generated per test run (never a real credential). */
export async function testServiceAccount(projectId = 'bluelytics-mobile'): Promise<{ json: string; publicKey: webcrypto.CryptoKey }> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----\n`;
  const json = JSON.stringify({
    type: 'service_account',
    project_id: projectId,
    private_key_id: 'test-key-id',
    private_key: pem,
    client_email: `firebase-adminsdk-test@${projectId}.iam.gserviceaccount.com`,
    token_uri: 'https://oauth2.googleapis.com/token',
  });
  return { json, publicKey: pair.publicKey };
}
