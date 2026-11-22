/** Response helpers for the non-HTML endpoints. */

export function xmlResponse(body: string, cacheControl: string): Response {
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': cacheControl } });
}
