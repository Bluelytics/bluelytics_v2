declare namespace Cloudflare {
  // Types `ctx.exports` (the loopback binding to the cached `Site` entrypoint).
  interface GlobalProps {
    mainModule: typeof import('./worker.ts');
  }
}

/** Optional build-time settings (docs/MIGRATION.md Appendix B); unset = feature off. */
interface ImportMetaEnv {
  /** Google Analytics 4 measurement id, e.g. `G-XXXXXXX`. */
  readonly PUBLIC_GA4_ID?: string;
  /** Cloudflare Web Analytics site token; unset = rely on the edge-injected beacon. */
  readonly PUBLIC_CF_BEACON_TOKEN?: string;
  /** Store listings: the badges are hidden unless set. */
  readonly PUBLIC_ANDROID_URL?: string;
  readonly PUBLIC_IOS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
