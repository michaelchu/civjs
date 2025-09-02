/**
 * Comprehensive Nation Type System for CivJS
 * 
 * Ported from freeciv nation system to provide complete compatibility
 * with all freeciv nation features including diplomatic relationships,
 * AI traits, cultural styles, and nation groups.
 * 
 * Based on freeciv reference: reference/freeciv/data/nation/*.ruleset
 */

export type CulturalStyle = 
  | 'European' 
  | 'Classical' 
  | 'Tropical' 
  | 'Asian' 
  | 'Babylonian' 
  | 'Celtic';

export type NationGroup = 
  // Historical periods
  | 'Ancient' 
  | 'Medieval' 
  | 'Early Modern' 
  | 'Modern'
  // Geographic regions  
  | 'African' 
  | 'American' 
  | 'Asian' 
  | 'European' 
  | 'Oceanian'
  // Special categories
  | 'Core' 
  | 'Barbarian' 
  | 'Imaginary';

export type LeaderSex = 'Male' | 'Female';

export type BarbarianType = 'Land' | 'Sea';

export type GovernmentType = 
  | 'Anarchy'
  | 'Despotism' 
  | 'Monarchy'
  | 'Communism'
  | 'Fundamentalism'
  | 'Republic'
  | 'Democracy';

export interface Leader {
  name: string;
  sex: LeaderSex;
}

export interface RulerTitle {
  government: GovernmentType;
  maleTitle: string;
  femaleTitle: string;
}

export interface CityName {
  name: string;
  terrainPreferences?: string[];   // e.g. ["ocean", "river", "!desert"]
}

export interface AITraits {
  expansionist?: number;  // 0-100, how much AI wants to settle new territory
  trader?: number;        // 0-100, how much AI wants to establish trade routes  
  aggressive?: number;    // 0-100, how easily AI declares war
  builder?: number;       // 0-100, how much AI wants to build buildings
}

export interface Nation {
  id: string;
  translationDomain: string;
  name: string;                    // Singular form: "Roman"
  plural: string;                  // Plural form: "Romans" 
  adjective: string;               // Adjective form: "Roman" (for display)
  groups: NationGroup[];           // ["Ancient", "European", "Core"]
  legend: string;                  // Historical description
  leaders: Leader[];               // Available leaders with gender
  rulerTitles: RulerTitle[];       // Government-specific ruler titles
  flag: string;                    // Primary flag graphic reference
  flagAlt?: string;                // Alternative flag reference
  style: CulturalStyle;            // Cultural building/UI style
  initTechs: string[];             // Starting technologies (usually empty)
  initBuildings: string[];         // Starting buildings (usually empty)
  initUnits: string[];             // Starting units (usually empty)
  cities: CityName[];              // City names with terrain preferences
  civilwarNations: string[];       // Related nations for civil wars
  conflictsWith: string[];         // Mutually exclusive nations
  isPlayable: boolean;             // Can human players select this nation
  barbarianType?: BarbarianType;   // For barbarian nations only
  traits?: AITraits;               // AI personality traits
}

export interface NationSet {
  name: string;
  ruleName: string;              // 'core' | 'all' etc.
  description: string;
  nations: string[];             // Nation IDs included in this set
}

export interface NationGroupDefinition {
  name: string;
  hidden: boolean;               // Hide from nation picker UI
  match: number;                 // AI preference for same group (0-2)
  nations: string[];             // Nation IDs in this group
}

export interface NationCustomization {
  customName?: string;           // Custom nation name
  customPlural?: string;         // Custom plural form
  selectedLeader?: string;       // Chosen leader name
  customLeader?: Leader;         // Custom leader definition
}

// Diplomatic relationship types (for Nations tab)
export type DiplomaticState = 
  | 'DS_NO_CONTACT'
  | 'DS_WAR'
  | 'DS_CEASEFIRE' 
  | 'DS_ARMISTICE'
  | 'DS_PEACE'
  | 'DS_ALLIANCE'
  | 'DS_TEAM';

export interface DiplomaticRelation {
  playerId: string;
  state: DiplomaticState;
  turnsLeft?: number;            // For timed agreements
}

export interface EmbassyStatus {
  playerId: string;
  hasEmbassy: boolean;
  established?: number;          // Turn established
}

export interface SharedVision {
  playerId: string;
  givingVision: boolean;         // We give vision to them
  receivingVision: boolean;      // They give vision to us
}

// Intelligence report data structure
export interface IntelligenceReport {
  playerId: string;
  ruler: string;
  government: string;
  capital?: string;
  gold: number;
  tax: number;                   // Percentage
  science: number;               // Percentage  
  luxury: number;                // Percentage
  researching: string;           // Current research + progress
  culture: number;
  diplomaticRelations: DiplomaticRelation[];
  knownTechnologies: TechnologyKnowledge[];
}

export interface TechnologyKnowledge {
  techId: string;
  name: string;
  whoKnows: 'both' | 'them' | 'us';  // Knowledge comparison
}

// Player status for Nations tab
export type PlayerStatus = 
  | 'Online'
  | 'Done'           // Turn completed
  | 'Moving'         // Currently taking turn
  | 'Idle'           // Idle for multiple turns
  | 'Dead';          // Eliminated

export interface PlayerNationInfo {
  playerId: string;
  playerName: string;
  nationId: string;
  nationName: string;            // Display name (may be customized)
  nationAdjective: string;       // "American", "Roman", etc.
  nationColor: string;           // Hex color for this nation
  isHuman: boolean;
  aiLevel?: string;              // "Easy AI", "Hard AI", etc.
  isAlive: boolean;
  status: PlayerStatus;
  score: number;
  team: number;
  turnsIdle?: number;            // Number of turns idle
  
  // Diplomatic information (relative to viewing player)
  diplomaticState?: DiplomaticState;
  embassy?: EmbassyStatus;
  sharedVision?: SharedVision;
  attitude?: string;             // AI attitude: "Hostile", "Neutral", etc.
}

// Nation-related game events
export interface NationEvent {
  type: 'nation_selected' | 'leader_changed' | 'nation_customized' | 'civil_war';
  playerId: string;
  nationId?: string;
  data?: Record<string, unknown>;
  timestamp: Date;
}