/**
 * @module server/game/constants/SpecialistDefinitions
 * Defines Specialist Definitions game constants.
 */
import civ2civ3Cities from '@shared/data/rulesets/civ2civ3/cities.json';

/**
 * Stable CivJS specialist ids and their Freeciv rule names.
 *
 * Only elvis, scientist, and taxman exist in the Civ2Civ3 ruleset. The extended
 * CivJS specialists remain addressable for saved-game compatibility, but have
 * no rule name and therefore produce no authoritative output.
 * @reference reference/freeciv/data/civ2civ3/cities.ruleset:47-91
 */
export enum SpecialistType {
  SCIENTIST = 0,
  TAX_COLLECTOR = 1,
  ENTERTAINER = 2,
  WORKER = 3,
  ENGINEER = 4,
  MERCHANT = 5,
}

export type SpecialistOutputType = 'science' | 'gold' | 'luxury' | 'food' | 'shield' | 'trade';

export interface SpecialistDefinition {
  id: SpecialistType;
  name: string;
  pluralName: string;
  shortName: string;
  outputType: SpecialistOutputType;
  ruleName?: 'scientist' | 'taxman' | 'elvis';
  /**
   * Non-authoritative estimate used only by the legacy citizen optimizer and
   * client serializer. Gameplay output is evaluated through Specialist_Output.
   */
  outputAmount: number;
}

const civ2civ3Specialists = civ2civ3Cities.specialists;

export const SPECIALIST_TYPES: Record<SpecialistType, SpecialistDefinition> = {
  [SpecialistType.SCIENTIST]: {
    id: SpecialistType.SCIENTIST,
    name: 'Scientist',
    pluralName: civ2civ3Specialists.scientist.name,
    shortName: civ2civ3Specialists.scientist.short_name,
    outputType: 'science',
    ruleName: 'scientist',
    outputAmount: 3,
  },
  [SpecialistType.TAX_COLLECTOR]: {
    id: SpecialistType.TAX_COLLECTOR,
    name: 'Tax Collector',
    pluralName: civ2civ3Specialists.taxman.name,
    shortName: civ2civ3Specialists.taxman.short_name,
    outputType: 'gold',
    ruleName: 'taxman',
    outputAmount: 3,
  },
  [SpecialistType.ENTERTAINER]: {
    id: SpecialistType.ENTERTAINER,
    name: 'Entertainer',
    pluralName: civ2civ3Specialists.elvis.name,
    shortName: civ2civ3Specialists.elvis.short_name,
    outputType: 'luxury',
    ruleName: 'elvis',
    outputAmount: 2,
  },
  [SpecialistType.WORKER]: {
    id: SpecialistType.WORKER,
    name: 'Worker',
    pluralName: 'Workers',
    shortName: 'Wkr',
    outputType: 'food',
    outputAmount: 0,
  },
  [SpecialistType.ENGINEER]: {
    id: SpecialistType.ENGINEER,
    name: 'Engineer',
    pluralName: 'Engineers',
    shortName: 'Eng',
    outputType: 'shield',
    outputAmount: 0,
  },
  [SpecialistType.MERCHANT]: {
    id: SpecialistType.MERCHANT,
    name: 'Merchant',
    pluralName: 'Merchants',
    shortName: 'Mer',
    outputType: 'trade',
    outputAmount: 0,
  },
};
