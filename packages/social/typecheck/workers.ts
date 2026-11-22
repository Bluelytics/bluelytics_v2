// Compile-time check (tsconfig.src.json, workers-types): the real Browser Run binding satisfies the
// structural interface the renderer accepts, and the request we send is a valid screenshot request.
import type { BrowserRunBinding, ScreenshotQuickAction } from '../src/render/browser-run.ts';

export const bindingFits = (binding: BrowserRun): BrowserRunBinding => binding;
export const requestFits = (request: ScreenshotQuickAction): BrowserRunScreenshotOptions => request;
