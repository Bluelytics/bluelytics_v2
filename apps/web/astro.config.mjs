// Verified setup: docs/research/astro-seo.md §1, §3.3, §10.2.
import cloudflare from '@astrojs/cloudflare';
import { cacheCloudflare } from '@astrojs/cloudflare/cache';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://bluelytics.com.ar',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file', inlineStylesheets: 'always' },
  // No raster images are transformed; `passthrough` avoids provisioning a Cloudflare Images binding.
  adapter: cloudflare({ imageService: 'passthrough' }),
  session: false,
  i18n: { locales: ['es', 'en'], defaultLocale: 'es', routing: { prefixDefaultLocale: false } },
  cache: { provider: cacheCloudflare() },
  devToolbar: { enabled: false },
});
