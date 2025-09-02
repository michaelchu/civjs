/**
 * Diplomatic Protocol Types
 * 
 * Minimal types for diplomatic state communication between client and server.
 */

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
  turnsLeft?: number;
}

export type PlayerStatus = 
  | 'Online'
  | 'Done'
  | 'Moving'
  | 'Idle'
  | 'Dead';

// Lightweight player info for client UI
export interface NetworkPlayerInfo {
  playerId: string;
  playerName: string;
  nationName: string;
  nationFlag: string;
  isHuman: boolean;
  isAlive: boolean; 
  status: PlayerStatus;
  score: number;
  team: number;
  diplomaticState?: DiplomaticState;
}