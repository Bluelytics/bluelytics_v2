import type { ZoneRules } from './zone-rules.ts';

/**
 * Rules that already exist in the zone and must survive when Pulumi adopts their phase
 * (`manageRulesets=true` replaces the whole rule list of every managed phase). Copy each rule to keep
 * here, in the zone's evaluation order, with its existing `ref`, before importing (README
 * "Adopting existing zone rules"). They are placed before the program's own rules.
 */
export const PRESERVED_RULES: ZoneRules = {
  rulesets: { redirect: [], cache: [], transform: [], responseHeaders: [] },
  cloudConnector: [],
};
