// `<script src="https://bluelytics.com.ar/embed.js" async data-lang="en" data-theme="dark"></script>`
// inserts the /widget iframe where the script tag is. The origin comes from the script URL, so it
// also works on preview hosts.
import type { APIRoute } from 'astro';

export const prerender = true;

const script = `(function () {
  var s = document.currentScript;
  if (!s) return;
  var url = new URL('/widget', s.src);
  if (s.dataset.lang === 'en') url.searchParams.set('lang', 'en');
  if (s.dataset.theme === 'dark' || s.dataset.theme === 'light') url.searchParams.set('theme', s.dataset.theme);
  var f = document.createElement('iframe');
  f.src = url.href;
  f.title = s.dataset.lang === 'en' ? 'Blue dollar rate by Bluelytics' : 'Cotización del dólar blue por Bluelytics';
  f.loading = 'lazy';
  f.style.cssText = 'border:0;width:100%;max-width:420px;height:172px;color-scheme:normal';
  s.parentNode.insertBefore(f, s);
})();
`;

export const GET: APIRoute = () => new Response(script, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
