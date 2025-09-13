/**
 * Unit constants - now dynamically loaded from rulesets
 * @deprecated Use RulesetUnitsService directly for new code
 * This file provides backward compatibility by re-exporting from the dynamic service
 */

// Re-export everything from the new ruleset-based service
export {
  type UnitType,
  UNIT_TYPES,
  getUnitType,
} from '../services/RulesetUnitsService';
