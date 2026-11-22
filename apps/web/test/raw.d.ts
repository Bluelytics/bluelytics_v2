// Vite `?raw` imports reached through src/lib/gateway.ts (the app tsconfig gets this from astro/client).
declare module '*?raw' {
  const content: string;
  export default content;
}
