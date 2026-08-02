/**
 * @module server/game/services/UnitPresentationService
 * Presentation-only unit placement data copied from the Amplio2 reference
 * tileset's insert_utype_into_offset_arrays(). These values never participate
 * in game rules or authoritative coordinates.
 */

export interface UnitOverlayOffsets {
  unitX: number;
  unitY: number;
  shieldX: number;
  shieldY: number;
  veteranX: number;
  veteranY: number;
  stackX: number;
  stackY: number;
  stackRingX: number;
  stackRingY: number;
  stackRingKey: 'unit.stk_shld_l' | 'unit.stk_shld_r';
  shieldRight: boolean;
  shieldYAligned: boolean;
}

interface ReferenceUnitAdjustment {
  dx?: number;
  dy?: number;
  sx?: number;
  sy?: number;
  vx?: number;
  vy?: number;
}

// Values from reference/freeciv-web/javascript/2dcanvas/tileset_config_amplio2.js.
const UNIT_OFFSET_X = 25;
const UNIT_OFFSET_Y = 18;
const UNIT_OFFSET_ADJ_X = -9;
const UNIT_OFFSET_ADJ_Y = -7;
const UNIT_FLAG_OFFSET_X = 25;
const UNIT_FLAG_OFFSET_Y = 16;
const UNIT_ACTIVITY_OFFSET_X = 55;
const UNIT_ACTIVITY_OFFSET_Y = 25;

// Deltas from reference/freeciv-web/javascript/2dcanvas/tilespec.js.
const REFERENCE_ADJUSTMENTS: Record<string, ReferenceUnitAdjustment> = {
  'aegis cruiser': { dx: -2, dy: -7, vx: -11, vy: 8 },
  'alpine troops': { dx: -3, dy: -1, vx: -4, vy: -4 },
  archer: { dx: 1, vx: -8, vy: -8 },
  armor: { dx: -3, dy: -6, vx: 17, vy: -14 },
  'armor ii': { vx: 11, vy: 4 },
  artillery: { dx: -12, vx: 8, vy: -8 },
  awacs: { dx: -17, dy: 3, sx: 8 },
  battleship: { dx: -5, dy: -7, vx: 4, vy: -11 },
  cannon: { vx: 1, vy: -4 },
  caravan: { dy: -3 },
  caravel: { dx: -3, dy: -3, vx: 3, vy: -3 },
  'cargo plane': { dy: -1, sx: 8 },
  carrier: { dx: -3, dy: -4, vx: -12, vy: 12 },
  'cargo ship': { dx: -1, dy: -2 },
  catapult: { dx: 2, dy: -2, vx: -14, vy: 15 },
  cavalry: { dx: 4, dy: -3, vx: 5, vy: -16 },
  chariot: { dx: -2, dy: -3, sx: 8, vx: -11, vy: 4 },
  cruiser: { vx: -13, vy: 15 },
  'cruise missile': { dx: -8, dy: -7, vx: -23, vy: 15 },
  crusaders: { vx: -3, vy: -12 },
  destroyer: { dx: -3, dy: -3, vx: -13, vy: 12 },
  diplomat: { dx: 1, dy: -2 },
  'dive bomber': { dx: -11, dy: -1, sx: 8, vx: -3, vy: -4 },
  dragoons: { dx: -3, dy: -4, vx: -48, vy: -16 },
  engineers: { dx: -3, dy: -4 },
  elephants: { dx: -6, dy: -7, vx: 8, vy: -9 },
  'escort fighter': { dx: -8, dy: -4, sx: 8, vx: 2, vy: 2 },
  explorer: { dx: -3, dy: -5 },
  falconeers: { dx: 2, dy: 2, vx: 3, vy: -5 },
  fighter: { dx: -11, dy: -6, sx: 8, vx: -14, vy: 10 },
  founders: { dx: -6, dy: -1 },
  frigate: { vx: 3, vy: 2 },
  galley: { vx: -12, vy: 14 },
  'ground strike fighter': { dx: 2, dy: -1, sx: 8, vx: -4, vy: 15 },
  'ground troops': { dy: 2, vx: -3, vy: -7 },
  'heavy bomber': { dx: 2, dy: 2, sx: 8, vx: -13, vy: 12 },
  bomber: { dx: 2, dy: 2, sx: 8, vx: -13, vy: 12 },
  helicopter: { sx: 8, vx: 5, vy: -5 },
  horsemen: { dx: -3, dy: -3, vx: -47, vy: -16 },
  howitzer: { dx: -9, dy: 1, vx: -43, vy: -9 },
  ironclad: { dx: -4, dy: -5, vx: 5, vy: 2 },
  'jet bomber': { dx: -24, dy: 7, sx: 8, vx: 11, vy: 1 },
  'jet fighter': { dx: 2, dy: 3, vx: 9, vy: 16 },
  knights: { dx: 3, dy: -3, vx: 9, vy: 4 },
  legion: { vx: 1, vy: -8 },
  'light armor': { dx: -1, dy: -7, vx: 11, vy: -11 },
  marines: { dx: 2, dy: 2, vx: -11, vy: -13 },
  'mechanized infantry': { vx: -23, vy: 13 },
  'mech. inf.': { vx: -23, vy: 13 },
  'medium bomber': { dx: 5, dy: 2, sx: 8, vx: 7, vy: 18 },
  'missile destroyer': { dx: -3, dy: -3, vx: -12, vy: 11 },
  'missile submarine': { dx: -2, dy: -6, vx: -12, vy: 5 },
  'magnum turret': { dx: -16, dy: -2, vx: 8, vy: -14 },
  musketeers: { dx: 1, dy: -4, vx: 1, vy: -19 },
  phalanx: { dy: -3, vx: 2, vy: -8 },
  paratroopers: { vy: -7 },
  pikemen: { dx: 1, dy: -4, vx: -1, vy: -7 },
  riflemen: { dx: -4, dy: -2, vx: -9, vy: -4 },
  'ram ship': { vx: -1, vy: -1 },
  scout: { dx: -2, dy: -3 },
  settlers: { dx: -3, dy: -2 },
  'siege ram': { dx: -2, dy: -4, vx: 3, vy: 2 },
  'spy plane': { dx: -27, sx: 8 },
  'stealth bomber': { dx: -31, dy: -4, vx: -45, vy: 4 },
  'stealth fighter': { dx: -2, dy: -1, vx: 4, vy: -14 },
  'strategic bomber': { dx: -3, dy: 4, sx: 8, vx: -13, vy: 15 },
  submarine: { dx: -3, dy: -4, vx: -11, vy: 8 },
  train: { dx: 5, dy: -8 },
  transport: { dx: -3, dy: -1, vx: -23, vy: 12 },
  'transport helicopter': { vx: -24, vy: 15 },
  trawler: { dx: -13, dy: 6 },
  trireme: { vx: 2, vy: 1 },
  tribesmen: { dx: 2 },
  wagon: { dx: -9, dy: -5 },
  'war galley': { vx: -4, vy: 3 },
  warriors: { dx: -3, dy: -2, vx: -2, vy: -2 },
  zeppelin: { dx: -19, dy: 4, sx: -13, sy: 5, vx: 11, vy: -5 },
};

export function resolveUnitOverlayOffsets(nameOrId: string): UnitOverlayOffsets {
  const {
    dx = 0,
    dy = 0,
    sx = 0,
    sy = 0,
    vx = 0,
    vy = 0,
  } = REFERENCE_ADJUSTMENTS[nameOrId.trim().toLowerCase()] ?? {};

  return {
    unitX: UNIT_OFFSET_X + UNIT_OFFSET_ADJ_X + dx,
    unitY: -(UNIT_OFFSET_Y + UNIT_OFFSET_ADJ_Y + dy),
    shieldX: UNIT_FLAG_OFFSET_X + sx,
    shieldY: -(UNIT_FLAG_OFFSET_Y - 1 + sy),
    veteranX: UNIT_ACTIVITY_OFFSET_X - 20 + vx,
    veteranY: -UNIT_ACTIVITY_OFFSET_Y - 10 - vy,
    stackX: sx > 0 ? 2 : 0,
    stackY: -UNIT_FLAG_OFFSET_Y - 15,
    stackRingX: sx > 0 ? -sx : 0,
    stackRingY: -31 - sy,
    stackRingKey: sx > 0 ? 'unit.stk_shld_r' : 'unit.stk_shld_l',
    shieldRight: sx > 0,
    shieldYAligned: sy !== 0,
  };
}
