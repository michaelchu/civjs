/**
 * Client-only Nation Types
 * 
 * Lightweight nation types for client UI display only.
 * Server maintains full nation data and game logic.
 */

// Basic nation info for UI display
export interface NationDisplay {
  id: string;
  name: string;
  plural: string;
  adjective: string;
  flag: string;
  description: string; // Short description for UI
}

// Player nation info received from server
export interface PlayerNationDisplay {
  playerId: string;
  playerName: string;
  nationId: string;
  nationName: string;
  nationFlag: string;
  isHuman: boolean;
  score: number;
  isAlive: boolean;
}

// Minimal nation customization for pre-game
export interface NationSelection {
  nationId: string;
  leaderName?: string;
  customName?: string;
}