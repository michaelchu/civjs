/**
 * @module server/shared/data/rulesets/defaultRuleset
 * The sole gameplay ruleset shipped by CivJS.
 *
 * Freeciv's other rulesets remain read-only reference material only. CivJS
 * intentionally targets parity with its Civ2Civ3 ruleset and does not offer
 * non-C2C3 games at runtime.
 */
export const DEFAULT_RULESET = 'civ2civ3' as const;

export const SUPPORTED_RULESETS = [DEFAULT_RULESET] as const;

export type SupportedRuleset = (typeof SUPPORTED_RULESETS)[number];

export function isSupportedRuleset(rulesetName: string): rulesetName is SupportedRuleset {
  return rulesetName === DEFAULT_RULESET;
}

export function requireSupportedRuleset(rulesetName?: string): SupportedRuleset {
  const resolvedRuleset = rulesetName ?? DEFAULT_RULESET;
  if (!isSupportedRuleset(resolvedRuleset)) {
    throw new Error(
      `Unsupported ruleset '${resolvedRuleset}'. CivJS supports only '${DEFAULT_RULESET}'.`
    );
  }
  return resolvedRuleset;
}
