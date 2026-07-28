import { z } from 'zod';
export { PacketType, PACKET_NAMES, PROTOCOL_VERSION } from './shared/packetContract';
import { PacketType } from './shared/packetContract';

// Base packet interface
export interface Packet<T = any> {
  type: PacketType;
  version?: number;
  seq?: number;
  requestId?: string;
  timestamp?: number;
  data: T;
}

// Connection packets
export const ServerJoinReqSchema = z.object({
  username: z.string().min(1).max(32),
  version: z.string(),
  capability: z.string().optional(),
});

export const ServerJoinReplySchema = z.object({
  accepted: z.boolean(),
  playerId: z.string().optional(),
  message: z.string().optional(),
  capability: z.string().optional(),
});

// Game packets
export const GameInfoSchema = z.object({
  gameId: z.string(),
  name: z.string(),
  turn: z.number(),
  phase: z.string(),
  year: z.number(),
  players: z.number(),
  maxPlayers: z.number(),
});

// Chat packets
export const ChatMsgSchema = z.object({
  sender: z.string(),
  message: z.string(),
  channel: z.enum(['all', 'team', 'private']),
  recipient: z.string().optional(),
});

// Map packets - Reference-compliant structures based on freeciv packets.def
export const MapInfoSchema = z.object({
  xsize: z.number(), // XYSIZE xsize
  ysize: z.number(), // XYSIZE ysize
  topology_id: z.number(), // UINT8 topology_id
  wrap_id: z.number(), // UINT8 wrap_id
  north_latitude: z.number(), // SINT16 north_latitude
  south_latitude: z.number(), // SINT16 south_latitude
  altitude_info: z.boolean(), // BOOL altitude_info
});

export const TileInfoSchema = z.object({
  x: z.number(),
  y: z.number(),
  terrain: z.string(),
  resource: z.string().optional(),
  owner: z.string().optional(),
  city: z.string().optional(),
  units: z.array(z.string()),
  improvements: z.array(z.string()),
  riverMask: z.number(),
  continent: z.number(), // continent ID
});

// Unit packets - Reference-compliant based on freeciv PACKET_UNIT_INFO
export const UnitInfoSchema = z.object({
  id: z.string(), // UNIT id; key
  owner: z.string(), // PLAYER owner
  nationality: z.string(), // PLAYER nationality
  x: z.number(), // TILE tile (x component)
  y: z.number(), // TILE tile (y component)
  facing: z.number(), // DIRECTION facing
  homecity: z.string().optional(), // CITY homecity
  upkeep: z.array(z.number()), // UINT8 upkeep[O_LAST]
  veteran: z.number(), // UINT8 veteran
  type: z.string(), // UNIT_TYPE type
  hp: z.number(), // HP hp
  activity: z.number(), // ACTIVITY activity
  activity_target: z.string().optional(), // EXTRA activity_tgt
  paradropped: z.boolean(), // BOOL paradropped
  occupied: z.boolean(), // BOOL occupied
  transported: z.boolean(), // BOOL transported
  done_moving: z.boolean(), // BOOL done_moving
  stay: z.boolean(), // BOOL stay
  birth_turn: z.number(), // TURN birth_turn
});

export const UnitMoveSchema = z.object({
  unitId: z.string(),
  x: z.number(),
  y: z.number(),
});

export const UnitAttackSchema = z.object({
  attackerUnitId: z.string(),
  defenderUnitId: z.string(),
});

export const UnitFortifySchema = z.object({
  unitId: z.string(),
});

export const UnitCreateSchema = z.object({
  unitType: z.string(),
  x: z.number(),
  y: z.number(),
});

export const TileVisibilityReqSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const DebugVisibilitySetSchema = z.object({
  enabled: z.boolean(),
});

// City packets
export const CityFoundSchema = z.object({
  name: z.string().min(1).max(100),
  x: z.number(),
  y: z.number(),
  unitId: z.string().optional(), // Optional settler unit ID for city founding
});

export const CityInfoSchema = z.object({
  id: z.string(),
  gameId: z.string(),
  playerId: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  population: z.number(),
  foodStock: z.number(),
  foodPerTurn: z.number(),
  productionStock: z.number(),
  productionPerTurn: z.number(),
  currentProduction: z.string().optional(),
  productionType: z.enum(['unit', 'building']).optional(),
  turnsToComplete: z.number(),
  goldPerTurn: z.number(),
  sciencePerTurn: z.number(),
  culturePerTurn: z.number(),
  buildings: z.array(z.string()),
  workingTiles: z.array(
    z.object({
      x: z.number(),
      y: z.number(),
    })
  ),
  isCapital: z.boolean(),
  defenseStrength: z.number(),
  happinessLevel: z.number(),
  healthLevel: z.number(),
  foundedTurn: z.number(),
});

export const CityProductionChangeSchema = z.object({
  cityId: z.string(),
  production: z.string(),
  type: z.enum(['unit', 'building', 'wonder']),
});

export const CityFoundReplySchema = z.object({
  success: z.boolean(),
  cityId: z.string().optional(),
  message: z.string().optional(),
});

export const CityProductionChangeReplySchema = z.object({
  success: z.boolean(),
  cityId: z.string().optional(),
  production: z.unknown().optional(),
  shieldStock: z.number().optional(),
  message: z.string().optional(),
});

// Research packets
export const ResearchSetSchema = z.object({
  techId: z.string(),
});

export const ResearchSetReplySchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  availableTechs: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        cost: z.number(),
        requirements: z.array(z.string()),
        description: z.string().optional(),
      })
    )
    .optional(),
});

export const ResearchGoalSetSchema = z.object({
  techId: z.string(),
});

export const ResearchGoalSetReplySchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});

export const ResearchListSchema = z.object({});

export const ResearchListReplySchema = z.object({
  availableTechs: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      cost: z.number(),
      requirements: z.array(z.string()),
      description: z.string().optional(),
    })
  ),
  researchedTechs: z.array(z.string()),
});

export const ResearchProgressSchema = z.object({});

export const ResearchProgressReplySchema = z.object({
  currentTech: z.string().optional(),
  techGoal: z.string().optional(),
  current: z.number(),
  required: z.number(),
  turnsRemaining: z.number(),
});

// Connection & Authentication packets
export const AuthenticationReqSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export const AuthenticationReplySchema = z.object({
  accepted: z.boolean(),
  message: z.string().optional(),
});

export const ServerShutdownSchema = z.object({
  message: z.string(),
  reason: z.string().optional(),
});

// Player Management packets
export const NationSelectReqSchema = z.object({
  nation: z.string(),
});

export const NationSelectReplySchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  selectedNation: z.string().optional(),
});

export const NationListReqSchema = z.object({
  ruleset: z.string().optional().default('classic'),
});

export const NationListReplySchema = z.object({
  success: z.boolean(),
  nations: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        plural: z.string(),
        adjective: z.string(),
        class: z.string(),
        style: z.string(),
        init_government: z.string(),
        leaders: z.array(
          z.object({
            name: z.string(),
            sex: z.enum(['Male', 'Female']),
          })
        ),
        flag: z.string(),
        flag_alt: z.string(),
        legend: z.string(),
      })
    )
    .optional(),
  message: z.string().optional(),
});

export const PlayerReadySchema = z.object({
  ready: z.boolean(),
});

export const EndgameReportSchema = z.object({
  version: z.literal(1),
  gameId: z.string(),
  turn: z.number(),
  year: z.number(),
  reason: z.enum(['conquest', 'culture', 'world_peace']),
  winnerPlayerId: z.string(),
  winnerPlayerIds: z.array(z.string()),
  endedAt: z.string(),
  standings: z.array(
    z.object({
      playerId: z.string(),
      civilization: z.string(),
      score: z.number(),
      cities: z.number(),
      population: z.number(),
      units: z.number(),
      technologies: z.number(),
      history: z.number(),
      alive: z.boolean(),
    })
  ),
});

export const PlayerInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  nation: z.string(),
  team: z.string().optional(),
  score: z.number(),
  gold: z.number(),
  goldPerTurn: z.number().optional(),
  science: z.number(),
  sciencePerTurn: z.number().optional(),
  culture: z.number(),
  government: z.string(),
  alive: z.boolean(),
  color: z.object({
    r: z.number(),
    g: z.number(),
    b: z.number(),
  }),
});

export const PlayerRemoveSchema = z.object({
  playerId: z.string(),
  reason: z.string().optional(),
});

// Map & Tile packets - Enhanced for structured packet system
export const MapInfoPacketSchema = z.object({
  xsize: z.number(),
  ysize: z.number(),
  topology: z.number().default(0),
  wrap_id: z.number().default(0),
  startpos: z
    .array(
      z.object({
        x: z.number(),
        y: z.number(),
      })
    )
    .optional(),
});

export const TileInfoPacketSchema = z.object({
  tile: z.number(), // tile index
  x: z.number(),
  y: z.number(),
  terrain: z.string(),
  resource: z.string().optional(),
  elevation: z.number().default(0),
  riverMask: z.number().default(0),
  known: z.number().int().min(0).max(2), // Freeciv known_type: 0 unknown, 1 fogged, 2 seen
  seen: z.number().min(0).max(1), // compatibility flag: 0 = unseen, 1 = visible
  player: z.string().nullable(),
  worked: z.string().nullable(),
  extras: z.number().default(0),
});

export const TileInfoBatchSchema = z.object({
  tiles: z.array(TileInfoPacketSchema),
  startIndex: z.number(),
  endIndex: z.number(),
  total: z.number(),
});

export const NukeTileInfoSchema = z.object({
  x: z.number(),
  y: z.number(),
  fallout: z.boolean(),
});

// Chat & Messages packets
export const EarlyChatMsgSchema = z.object({
  sender: z.string(),
  message: z.string(),
  timestamp: z.number(),
});

export const ConnectMsgSchema = z.object({
  username: z.string(),
  message: z.string(),
  event: z.enum(['join', 'leave', 'reconnect']),
});

export const ServerInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  capability: z.string(),
  players: z.number(),
  maxPlayers: z.number(),
  uptime: z.number(),
});

// City Management packets - Enhanced
export const CityRemoveSchema = z.object({
  cityId: z.string(),
  reason: z.string().optional(),
});

export const CityShortInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  size: z.number(),
  owner: z.string(),
});

export const CitySellSchema = z.object({
  cityId: z.string(),
  improvementId: z.string(),
});

export const CityBuySchema = z.object({
  cityId: z.string(),
  improvementId: z.string(),
});

export const CityChangeSchema = z.object({
  cityId: z.string(),
  changeType: z.enum(['name', 'production', 'specialist_assignment']),
  value: z.any(), // flexible for different change types
});

export const CityWorklistSchema = z.object({
  cityId: z.string(),
  worklist: z.array(
    z.object({
      type: z.enum(['unit', 'building']),
      id: z.string(),
      priority: z.number(),
    })
  ),
});

export const CityMakeSpecialistSchema = z.object({
  cityId: z.string(),
  tileX: z.number(),
  tileY: z.number(),
  specialistType: z.string(),
});

export const CityMakeWorkerSchema = z.object({
  cityId: z.string(),
  specialistType: z.string(),
  tileX: z.number(),
  tileY: z.number(),
});

// Unit Management packets - Enhanced
export const UnitShortInfoSchema = z.object({
  id: z.string(),
  type: z.string(),
  x: z.number(),
  y: z.number(),
  owner: z.string(),
  hp: z.number(),
  moves: z.number(),
});

export const UnitBuildCitySchema = z.object({
  unitId: z.string(),
  cityName: z.string(),
});

export const UnitDisbandSchema = z.object({
  unitId: z.string(),
});

export const UnitChangeHomecitySchema = z.object({
  unitId: z.string(),
  newHomecityId: z.string(),
});

export const UnitCombatInfoSchema = z.object({
  attackerId: z.string(),
  defenderId: z.string(),
  attackerHp: z.number(),
  defenderHp: z.number(),
  attackerDamage: z.number(),
  defenderDamage: z.number(),
  attackerDestroyed: z.boolean(),
  defenderDestroyed: z.boolean(),
  veteran: z.boolean(),
});

export const UnitOrdersSchema = z.object({
  unitId: z.string(),
  orders: z.array(
    z.object({
      action: z.enum(['move', 'attack', 'fortify', 'sentry', 'build_city', 'goto']),
      x: z.number().optional(),
      y: z.number().optional(),
      target: z.string().optional(),
    })
  ),
  repeat: z.boolean().default(false),
});

// Turn Management packets - Enhanced
export const TurnDoneSchema = z.object({
  playerId: z.string(),
});

export const NewTurnSchema = z.object({
  turn: z.number(),
  year: z.number(),
  phase: z.string(),
});

export const BeginTurnSchema = z.object({
  turn: z.number(),
  playerId: z.string(),
});

export const EndTurnSchema = z.object({
  turn: z.number(),
  playerId: z.string(),
});

export const NewYearSchema = z.object({
  turn: z.number(),
  year: z.number(),
  fragments: z.number().default(0), // Calendar fragments for sub-year precision
});

export const FreezeClientSchema = z.object({
  reason: z.string().optional(),
});

export const ThawClientSchema = z.object({
  message: z.string().optional(),
});

//Game management packets
export const GameCreateSchema = z.object({
  name: z.string().min(1).max(100),
  gameType: z.enum(['single', 'multiplayer']).optional(),
  maxPlayers: z.number().int().min(1).max(16).optional(),
  mapWidth: z.number().int().min(40).max(200).optional(),
  mapHeight: z.number().int().min(25).max(150).optional(),
  ruleset: z.string().optional(),
  selectedNation: z.string().min(1).optional(),
  turnTimeLimit: z.number().int().min(0).max(86_400).optional(),
  victoryConditions: z.array(z.string()).optional(),
  terrainSettings: z
    .object({
      generator: z.string(),
      landmass: z.string(),
      huts: z.number().min(0).max(100),
      temperature: z.number().min(0).max(100),
      wetness: z.number().min(0).max(100),
      rivers: z.number().min(0).max(100),
      resources: z.string(),
      startpos: z.number().optional(),
      topologyId: z.number().int().min(0).max(3).optional(),
      wrapId: z.number().int().min(0).max(3).optional(),
      scenarioId: z
        .string()
        .regex(/^[a-zA-Z0-9_-]+$/)
        .optional(),
    })
    .optional(),
});

export const GameCreateReplySchema = z.object({
  success: z.boolean(),
  gameId: z.string().optional(),
  playerId: z.string().optional(),
  assignedNation: z.string().optional(),
  assignedColor: z.object({ r: z.number(), g: z.number(), b: z.number() }).optional(),
  maxPlayers: z.number().int().optional(),
  message: z.string().optional(),
});

export const GameJoinSchema = z.object({
  gameId: z.string().min(1),
  playerName: z.string().min(1).max(32).optional(),
  selectedNation: z.string().min(1).optional(),
  civilization: z.string().optional(),
});

export const GameIdSchema = z.object({
  gameId: z.string().min(1),
});

export const GameJoinReplySchema = z.object({
  success: z.boolean(),
  playerId: z.string().optional(),
  message: z.string().optional(),
});

export const TurnEndReplySchema = z.object({
  success: z.boolean(),
  turnAdvanced: z.boolean().optional(),
  message: z.string().optional(),
});

export const ServerMessageSchema = z.object({
  message: z.string(),
  type: z.enum(['info', 'warning', 'error']).optional(),
});

export const UnitMoveReplySchema = z.object({
  success: z.boolean(),
  unitId: z.string(),
  newX: z.number().optional(),
  newY: z.number().optional(),
  movementLeft: z.number().optional(),
  message: z.string().optional(),
});

export const UnitAttackReplySchema = z.object({
  success: z.boolean(),
  combatResult: z
    .object({
      attackerId: z.string(),
      defenderId: z.string(),
      attackerDamage: z.number(),
      defenderDamage: z.number(),
      attackerDestroyed: z.boolean(),
      defenderDestroyed: z.boolean(),
    })
    .optional(),
  message: z.string().optional(),
});

export const UnitFortifyReplySchema = z.object({
  success: z.boolean(),
  unitId: z.string(),
  message: z.string().optional(),
});

export const UnitCreateReplySchema = z.object({
  success: z.boolean(),
  unitId: z.string().optional(),
  message: z.string().optional(),
});

export const MapViewReplySchema = z.object({
  mapData: z.any(), // Complex map structure
});

export const TileVisibilityReplySchema = z.object({
  success: z.boolean(),
  x: z.number(),
  y: z.number(),
  isVisible: z.boolean(),
  isExplored: z.boolean(),
  lastSeen: z.union([z.date(), z.number()]).optional(),
  message: z.string().optional(),
});

export const TurnProcessingStepSchema = z.object({
  step: z.enum(['validate', 'units', 'cities', 'research', 'events', 'advance']),
  label: z.string(),
  completed: z.boolean(),
  active: z.boolean(),
});

// Type exports
export type ServerJoinReq = z.infer<typeof ServerJoinReqSchema>;
export type ServerJoinReply = z.infer<typeof ServerJoinReplySchema>;
export type GameInfo = z.infer<typeof GameInfoSchema>;
export type ChatMsg = z.infer<typeof ChatMsgSchema>;
export type MapInfo = z.infer<typeof MapInfoSchema>;
export type TileInfo = z.infer<typeof TileInfoSchema>;
export type UnitInfo = z.infer<typeof UnitInfoSchema>;
export type UnitMove = z.infer<typeof UnitMoveSchema>;
export type UnitAttack = z.infer<typeof UnitAttackSchema>;
export type UnitFortify = z.infer<typeof UnitFortifySchema>;
export type UnitCreate = z.infer<typeof UnitCreateSchema>;
export type GameCreate = z.infer<typeof GameCreateSchema>;
export type GameCreateReply = z.infer<typeof GameCreateReplySchema>;
export type GameJoin = z.infer<typeof GameJoinSchema>;
export type GameJoinReply = z.infer<typeof GameJoinReplySchema>;
export type TurnEndReply = z.infer<typeof TurnEndReplySchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type UnitMoveReply = z.infer<typeof UnitMoveReplySchema>;
export type UnitAttackReply = z.infer<typeof UnitAttackReplySchema>;
export type UnitFortifyReply = z.infer<typeof UnitFortifyReplySchema>;
export type UnitCreateReply = z.infer<typeof UnitCreateReplySchema>;
export type TileVisibilityReq = z.infer<typeof TileVisibilityReqSchema>;
export type DebugVisibilitySet = z.infer<typeof DebugVisibilitySetSchema>;
export type MapViewReply = z.infer<typeof MapViewReplySchema>;
export type TileVisibilityReply = z.infer<typeof TileVisibilityReplySchema>;
export type TurnProcessingStep = z.infer<typeof TurnProcessingStepSchema>;
export type CityFound = z.infer<typeof CityFoundSchema>;
export type CityInfo = z.infer<typeof CityInfoSchema>;
export type CityProductionChange = z.infer<typeof CityProductionChangeSchema>;
export type CityFoundReply = z.infer<typeof CityFoundReplySchema>;
export type CityProductionChangeReply = z.infer<typeof CityProductionChangeReplySchema>;
export type ResearchSet = z.infer<typeof ResearchSetSchema>;
export type ResearchSetReply = z.infer<typeof ResearchSetReplySchema>;
export type ResearchGoalSet = z.infer<typeof ResearchGoalSetSchema>;
export type ResearchGoalSetReply = z.infer<typeof ResearchGoalSetReplySchema>;
export type ResearchList = z.infer<typeof ResearchListSchema>;
export type ResearchListReply = z.infer<typeof ResearchListReplySchema>;
export type ResearchProgress = z.infer<typeof ResearchProgressSchema>;
export type ResearchProgressReply = z.infer<typeof ResearchProgressReplySchema>;

// Additional type exports for new schemas
export type AuthenticationReq = z.infer<typeof AuthenticationReqSchema>;
export type AuthenticationReply = z.infer<typeof AuthenticationReplySchema>;
export type ServerShutdown = z.infer<typeof ServerShutdownSchema>;
export type NationSelectReq = z.infer<typeof NationSelectReqSchema>;
export type NationSelectReply = z.infer<typeof NationSelectReplySchema>;
export type NationListReq = z.infer<typeof NationListReqSchema>;
export type NationListReply = z.infer<typeof NationListReplySchema>;
export type PlayerReady = z.infer<typeof PlayerReadySchema>;
export type EndgameReport = z.infer<typeof EndgameReportSchema>;
export type PlayerInfo = z.infer<typeof PlayerInfoSchema>;
export type PlayerRemove = z.infer<typeof PlayerRemoveSchema>;
export type MapInfoPacket = z.infer<typeof MapInfoPacketSchema>;
export type TileInfoPacket = z.infer<typeof TileInfoPacketSchema>;
export type TileInfoBatch = z.infer<typeof TileInfoBatchSchema>;
export type NukeTileInfo = z.infer<typeof NukeTileInfoSchema>;
export type EarlyChatMsg = z.infer<typeof EarlyChatMsgSchema>;
export type ConnectMsg = z.infer<typeof ConnectMsgSchema>;
export type ServerInfo = z.infer<typeof ServerInfoSchema>;
export type CityRemove = z.infer<typeof CityRemoveSchema>;
export type CityShortInfo = z.infer<typeof CityShortInfoSchema>;
export type CitySell = z.infer<typeof CitySellSchema>;
export type CityBuy = z.infer<typeof CityBuySchema>;
export type CityChange = z.infer<typeof CityChangeSchema>;
export type CityWorklist = z.infer<typeof CityWorklistSchema>;
export type CityMakeSpecialist = z.infer<typeof CityMakeSpecialistSchema>;
export type CityMakeWorker = z.infer<typeof CityMakeWorkerSchema>;
export type UnitShortInfo = z.infer<typeof UnitShortInfoSchema>;
export type UnitBuildCity = z.infer<typeof UnitBuildCitySchema>;
export type UnitDisband = z.infer<typeof UnitDisbandSchema>;
export type UnitChangeHomecity = z.infer<typeof UnitChangeHomecitySchema>;
export type UnitCombatInfo = z.infer<typeof UnitCombatInfoSchema>;
export type UnitOrders = z.infer<typeof UnitOrdersSchema>;
export type TurnDone = z.infer<typeof TurnDoneSchema>;
export type NewTurn = z.infer<typeof NewTurnSchema>;
export type BeginTurn = z.infer<typeof BeginTurnSchema>;
export type EndTurn = z.infer<typeof EndTurnSchema>;
export type NewYear = z.infer<typeof NewYearSchema>;
export type FreezeClient = z.infer<typeof FreezeClientSchema>;
export type ThawClient = z.infer<typeof ThawClientSchema>;
