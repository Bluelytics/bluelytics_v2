import { describe, expect, it } from 'vitest';
import { parseResults } from '../src/backfill/target.ts';

describe('parseResults', () => {
  it('parses plain --json output', () => {
    expect(parseResults('[{"success":true}]', 'x')).toEqual([{ success: true }]);
  });
  it('skips the upload progress wrangler prints before the JSON with --remote --file', () => {
    const out = '├ Checking if file needs uploading\n│\n├ Uploading file\n│\n[\n  {\n    "success": true\n  }\n]\n';
    expect(parseResults(out, 'x')).toEqual([{ success: true }]);
  });
  it('still fails loudly on output without JSON', () => {
    expect(() => parseResults('✘ [ERROR] boom', 'x')).toThrow(/did not print JSON/);
  });
});
