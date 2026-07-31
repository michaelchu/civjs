import { randomInt, type RandomSource } from '@game/random/FreecivRandom';

export interface PartisanCaptureContext {
  reason: 'conquest' | 'transfer';
  oldPlayerId: string;
  originalOwnerId?: string;
  loserNation?: string;
  loserCivilization?: string;
  inspireEffect: number;
}

/** Shared decision for the default city-conquest partisan script. */
export function shouldCreatePartisans(context: PartisanCaptureContext): boolean {
  if (context.reason !== 'conquest') return false;
  if (!context.originalOwnerId || context.originalOwnerId !== context.oldPlayerId) return false;
  if (context.loserNation === 'barbarian') return false;
  if (context.loserCivilization?.startsWith('barbarian')) return false;
  return context.inspireEffect > 0;
}

/** Match Freeciv's size-based partisan roll and eight-unit cap. */
export function calculatePartisanCount(citySize: number, random: RandomSource): number {
  return Math.min(8, randomInt(random, 2 + Math.floor((citySize + 1) / 2)) + 1);
}
