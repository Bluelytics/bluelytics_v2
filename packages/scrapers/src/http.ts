import { FetchError } from './errors.ts';
import type { FetchLike, ResponseFormat } from './types.ts';

/** Honest identification (ARCHITECTURE §8). */
export const USER_AGENT = 'bluelytics-bot/2.0 (+https://bluelytics.com.ar)';

const ACCEPT: Record<ResponseFormat, string> = {
  json: 'application/json',
  html: 'text/html,application/xhtml+xml',
};

const globalFetch: FetchLike = (url, init) => fetch(url, init);

/** One GET with the bot User-Agent; the timeout covers the body too. Anything but HTTP 200 throws `FetchError`. */
export async function getText(
  url: string,
  format: ResponseFormat,
  timeoutMs: number,
  fetchImpl: FetchLike = globalFetch,
): Promise<string> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: ACCEPT[format] },
      redirect: 'follow',
      signal,
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new FetchError('http', `HTTP ${response.status} from ${shortUrl(url)}`);
    }
    return await response.text();
  } catch (error) {
    if (error instanceof FetchError) throw error;
    if (signal.aborted) throw new FetchError('timeout', `no complete response from ${shortUrl(url)} within ${timeoutMs} ms`);
    throw new FetchError('network', `GET ${shortUrl(url)} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function shortUrl(url: string): string {
  return url.split('?', 1)[0] ?? url;
}
