export interface CombatPresentationCombatant {
  id: string;
  role: 'attacker' | 'defender';
  playerId: string;
  unitTypeId: string;
  x: number;
  y: number;
  hpBefore: number;
  hpAfter: number;
  movesLeft?: number;
  veteranLevel?: number;
  fortified?: boolean;
  activity?: unknown;
  destroyed: boolean;
}

export interface CombatPresentationEvent {
  eventId: string;
  x: number;
  y: number;
  style?: 'swords' | 'explosion';
  playerIds: string[];
  attackerDamage?: number;
  defenderDamage?: number;
  attackerDestroyed?: boolean;
  defenderDestroyed?: boolean;
  combatants?: CombatPresentationCombatant[];
}

export interface NuclearPresentationTile {
  x: number;
  y: number;
}

export interface NuclearPresentationEvent {
  eventId: string;
  x: number;
  y: number;
  playerId: string;
  affectedTiles: NuclearPresentationTile[];
}
