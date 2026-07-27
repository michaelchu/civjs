/**
 * Canonical CivJS protocol v1 identifiers and transport metadata.
 *
 * Numeric identifiers are deployed CivJS wire values. They are intentionally
 * not renumbered to Freeciv values without a negotiated protocol version.
 */
export const PROTOCOL_VERSION = 1;

export enum PacketType {
  PROCESSING_STARTED = 0,
  PROCESSING_FINISHED = 1,
  SERVER_JOIN_REQ = 4,
  SERVER_JOIN_REPLY = 5,
  AUTHENTICATION_REQ = 6,
  AUTHENTICATION_REPLY = 7,
  SERVER_SHUTDOWN = 8,
  NATION_SELECT_REQ = 10,
  NATION_SELECT_REPLY = 11,
  PLAYER_READY = 12,
  ENDGAME_REPORT = 13,
  PLAYER_INFO = 14,
  PLAYER_REMOVE = 15,
  NATION_LIST_REQ = 16,
  NATION_LIST_REPLY = 17,
  TILE_INFO = 18,
  GAME_INFO = 19,
  MAP_INFO = 20,
  NUKE_TILE_INFO = 21,
  MAP_VIEW_REQ = 22,
  TILE_VISIBILITY_REQ = 23,
  CHAT_MSG = 25,
  CHAT_MSG_REQ = 26,
  CONNECT_MSG = 27,
  EARLY_CHAT_MSG = 28,
  SERVER_INFO = 29,
  CITY_REMOVE = 30,
  CITY_INFO = 31,
  CITY_SHORT_INFO = 32,
  CITY_SELL = 33,
  CITY_BUY = 34,
  CITY_CHANGE = 35,
  CITY_WORKLIST = 36,
  CITY_MAKE_SPECIALIST = 37,
  CITY_MAKE_WORKER = 38,
  UNIT_INFO = 50,
  UNIT_SHORT_INFO = 51,
  UNIT_MOVE = 52,
  UNIT_BUILD_CITY = 53,
  UNIT_DISBAND = 54,
  UNIT_CHANGE_HOMECITY = 55,
  UNIT_COMBAT_INFO = 56,
  UNIT_ORDERS = 57,
  UNIT_ATTACK = 58,
  UNIT_FORTIFY = 59,
  UNIT_CREATE = 60,
  TURN_DONE = 80,
  NEW_TURN = 81,
  BEGIN_TURN = 82,
  END_TURN = 83,
  TURN_END_REPLY = 84,
  TURN_START = 85,
  FREEZE_CLIENT = 86,
  THAW_CLIENT = 87,
  NEW_YEAR = 127,
  GAME_CREATE = 200,
  GAME_CREATE_REPLY = 201,
  GAME_JOIN = 202,
  GAME_JOIN_REPLY = 203,
  GAME_LEAVE = 204,
  GAME_START = 205,
  GAME_LIST = 206,
  PLAYER_LIST = 207,
  SERVER_MESSAGE = 208,
  UNIT_MOVE_REPLY = 209,
  UNIT_ATTACK_REPLY = 210,
  UNIT_FORTIFY_REPLY = 211,
  UNIT_CREATE_REPLY = 212,
  MAP_VIEW_REPLY = 213,
  TILE_VISIBILITY_REPLY = 214,
  CITY_FOUND = 215,
  CITY_FOUND_REPLY = 216,
  CITY_PRODUCTION_CHANGE = 217,
  CITY_PRODUCTION_CHANGE_REPLY = 218,
  RESEARCH_SET = 219,
  RESEARCH_SET_REPLY = 220,
  RESEARCH_GOAL_SET = 221,
  RESEARCH_GOAL_SET_REPLY = 222,
  RESEARCH_LIST = 223,
  RESEARCH_LIST_REPLY = 224,
  RESEARCH_PROGRESS = 225,
  RESEARCH_PROGRESS_REPLY = 226,
  TURN_PROCESSING_STEP = 227,
  GOVERNMENT_LIST = 228,
  GOVERNMENT_LIST_REPLY = 229,
  GOVERNMENT_CHANGE_REQ = 230,
  GOVERNMENT_CHANGE_REPLY = 231,
  REVOLUTION_START = 232,
  REVOLUTION_START_REPLY = 233,
  BORDER_UPDATE = 240,
  BORDER_SOURCE_UPDATE = 241,
  BORDER_INFO_REQUEST = 242,
  BORDER_INFO_RESPONSE = 243,
  BORDER_CHANGE_NOTIFICATION = 244,
  DIPLOMACY_LIST_REQ = 250,
  DIPLOMACY_LIST_REPLY = 251,
  DIPLOMACY_TREATY_PROPOSE = 252,
  DIPLOMACY_TREATY_RESPONSE = 253,
  DIPLOMACY_TREATY_CANCEL = 254,
  DIPLOMACY_DECLARE_WAR = 255,
  DIPLOMACY_UPDATE = 256,
}

export const PACKET_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(PacketType)
    .filter(([, value]) => typeof value === 'number')
    .map(([name, value]) => [value, name])
);

export type PacketDirection = 'client_to_server' | 'server_to_client' | 'bidirectional';
export type PacketLifecycle = 'active' | 'legacy' | 'declared';

export interface PacketContractEntry {
  type: PacketType;
  name: string;
  family: string;
  direction: PacketDirection;
  lifecycle: PacketLifecycle;
  schema?: string;
  serverHandler?: string;
  clientConsumer?: string;
  upstream?: string;
}

const active = (
  type: PacketType,
  family: string,
  direction: PacketDirection,
  details: Omit<PacketContractEntry, 'type' | 'name' | 'family' | 'direction' | 'lifecycle'> = {}
): PacketContractEntry => ({
  type,
  name: PACKET_NAMES[type],
  family,
  direction,
  lifecycle: 'active',
  ...details,
});

export const ACTIVE_PACKET_CONTRACT: readonly PacketContractEntry[] = [
  active(PacketType.SERVER_JOIN_REQ, 'connection', 'client_to_server', {
    schema: 'ServerJoinReqSchema',
    serverHandler: 'ConnectionHandler',
    upstream: 'PACKET_SERVER_JOIN_REQ',
  }),
  active(PacketType.SERVER_JOIN_REPLY, 'connection', 'server_to_client', {
    schema: 'ServerJoinReplySchema',
    clientConsumer: 'GameClient.authenticatePlayer',
    upstream: 'PACKET_SERVER_JOIN_REPLY',
  }),
  active(PacketType.CONNECT_MSG, 'connection', 'server_to_client', {
    clientConsumer: 'GameClient.handlePacket',
    upstream: 'PACKET_CONNECT_MSG',
  }),
  active(PacketType.SERVER_MESSAGE, 'connection', 'server_to_client', {
    clientConsumer: 'GameClient.handlePacket',
  }),
  active(PacketType.GAME_CREATE, 'lobby', 'client_to_server', {
    serverHandler: 'GameManagementHandler',
  }),
  active(PacketType.GAME_CREATE_REPLY, 'lobby', 'server_to_client', {
    clientConsumer: 'GameClient.createGame',
  }),
  active(PacketType.GAME_JOIN, 'lobby', 'client_to_server', {
    serverHandler: 'GameManagementHandler',
  }),
  active(PacketType.GAME_JOIN_REPLY, 'lobby', 'server_to_client', {
    clientConsumer: 'GameClient.joinGame',
  }),
  active(PacketType.GAME_LIST, 'lobby', 'bidirectional', {
    serverHandler: 'GameManagementHandler',
    clientConsumer: 'GameClient.getGameList',
  }),
  active(PacketType.GAME_INFO, 'game_state', 'server_to_client', {
    schema: 'GameInfoSchema',
    clientConsumer: 'GameClient.handlePacket',
    upstream: 'PACKET_GAME_INFO',
  }),
  active(PacketType.PLAYER_INFO, 'game_state', 'server_to_client', {
    clientConsumer: 'GameClient.handlePacket',
    upstream: 'PACKET_PLAYER_INFO',
  }),
  active(PacketType.ENDGAME_REPORT, 'game_state', 'server_to_client', {
    clientConsumer: 'GameClient.handlePacket',
    upstream: 'PACKET_ENDGAME_REPORT',
  }),
  active(PacketType.MAP_VIEW_REQ, 'map', 'client_to_server', {
    serverHandler: 'MapVisibilityHandler',
  }),
  active(PacketType.MAP_VIEW_REPLY, 'map', 'server_to_client', {
    clientConsumer: 'GameClient.requestMapData',
  }),
  active(PacketType.MAP_INFO, 'map', 'server_to_client', {
    schema: 'MapInfoSchema',
    clientConsumer: 'GameClient.handlePacket',
    upstream: 'PACKET_MAP_INFO',
  }),
  active(PacketType.TILE_INFO, 'map', 'server_to_client', {
    schema: 'TileInfoSchema',
    clientConsumer: 'GameClient.handlePacket',
    upstream: 'PACKET_TILE_INFO',
  }),
  active(PacketType.TILE_VISIBILITY_REQ, 'map', 'client_to_server', {
    schema: 'TileVisibilityReqSchema',
    serverHandler: 'MapVisibilityHandler',
  }),
  active(PacketType.TILE_VISIBILITY_REPLY, 'map', 'server_to_client', {
    clientConsumer: 'GameClient.getTileVisibility',
  }),
  active(PacketType.UNIT_MOVE, 'units', 'client_to_server', {
    serverHandler: 'UnitActionHandler',
  }),
  active(PacketType.UNIT_MOVE_REPLY, 'units', 'server_to_client', {
    clientConsumer: 'GameClient.moveUnit',
  }),
  active(PacketType.UNIT_ATTACK, 'units', 'client_to_server', {
    serverHandler: 'UnitActionHandler',
  }),
  active(PacketType.UNIT_ATTACK_REPLY, 'units', 'server_to_client', {
    clientConsumer: 'GameClient.attackUnit',
  }),
  active(PacketType.UNIT_FORTIFY, 'units', 'client_to_server', {
    serverHandler: 'UnitActionHandler',
  }),
  active(PacketType.UNIT_FORTIFY_REPLY, 'units', 'server_to_client', {
    clientConsumer: 'GameClient.fortifyUnit',
  }),
  active(PacketType.UNIT_CREATE, 'units', 'client_to_server', {
    serverHandler: 'UnitActionHandler',
  }),
  active(PacketType.UNIT_CREATE_REPLY, 'units', 'server_to_client', {
    clientConsumer: 'GameClient.createUnit',
  }),
  active(PacketType.UNIT_INFO, 'units', 'server_to_client', {
    schema: 'UnitInfoSchema',
    clientConsumer: 'GameClient.handlePacket',
    upstream: 'PACKET_UNIT_INFO',
  }),
  active(PacketType.CITY_FOUND, 'cities', 'client_to_server', {
    serverHandler: 'CityManagementHandler',
  }),
  active(PacketType.CITY_FOUND_REPLY, 'cities', 'server_to_client', {
    clientConsumer: 'GameClient.foundCity',
  }),
  active(PacketType.CITY_PRODUCTION_CHANGE, 'cities', 'client_to_server', {
    serverHandler: 'CityManagementHandler',
  }),
  active(PacketType.CITY_PRODUCTION_CHANGE_REPLY, 'cities', 'server_to_client', {
    clientConsumer: 'GameClient.changeProduction',
  }),
  active(PacketType.CITY_INFO, 'cities', 'server_to_client', {
    clientConsumer: 'GameClient.handlePacket',
    upstream: 'PACKET_CITY_INFO',
  }),
  active(PacketType.RESEARCH_SET, 'research', 'client_to_server', {
    serverHandler: 'ResearchHandler',
  }),
  active(PacketType.RESEARCH_SET_REPLY, 'research', 'server_to_client', {
    clientConsumer: 'GameClient.setResearch',
  }),
  active(PacketType.RESEARCH_GOAL_SET, 'research', 'client_to_server', {
    serverHandler: 'ResearchHandler',
  }),
  active(PacketType.RESEARCH_GOAL_SET_REPLY, 'research', 'server_to_client', {
    clientConsumer: 'GameClient.setResearchGoal',
  }),
  active(PacketType.RESEARCH_LIST, 'research', 'client_to_server', {
    serverHandler: 'ResearchHandler',
  }),
  active(PacketType.RESEARCH_LIST_REPLY, 'research', 'server_to_client', {
    clientConsumer: 'GameClient.handlePacket',
  }),
  active(PacketType.RESEARCH_PROGRESS, 'research', 'client_to_server', {
    serverHandler: 'ResearchHandler',
  }),
  active(PacketType.RESEARCH_PROGRESS_REPLY, 'research', 'server_to_client', {
    clientConsumer: 'GameClient.handlePacket',
  }),
  active(PacketType.END_TURN, 'turn', 'client_to_server', {
    serverHandler: 'TurnManagementHandler',
    upstream: 'PACKET_TURN_DONE',
  }),
  active(PacketType.TURN_END_REPLY, 'turn', 'server_to_client', {
    clientConsumer: 'GameClient.handlePacket',
  }),
  active(PacketType.TURN_START, 'turn', 'server_to_client', {
    clientConsumer: 'GameClient.handlePacket',
  }),
  active(PacketType.NEW_YEAR, 'turn', 'server_to_client', {
    clientConsumer: 'GameClient.handlePacket',
    upstream: 'PACKET_NEW_YEAR',
  }),
  active(PacketType.BEGIN_TURN, 'turn', 'server_to_client', {
    clientConsumer: 'GameClient.handlePacket',
    upstream: 'PACKET_BEGIN_TURN',
  }),
  active(PacketType.TURN_PROCESSING_STEP, 'turn', 'server_to_client', {
    clientConsumer: 'GameClient.handlePacket',
  }),
  active(PacketType.FREEZE_CLIENT, 'turn', 'server_to_client', {
    clientConsumer: 'GameClient.handlePacket',
    upstream: 'PACKET_FREEZE_CLIENT',
  }),
  active(PacketType.THAW_CLIENT, 'turn', 'server_to_client', {
    clientConsumer: 'GameClient.handlePacket',
    upstream: 'PACKET_THAW_CLIENT',
  }),
  active(PacketType.CHAT_MSG_REQ, 'chat', 'client_to_server', {
    schema: 'ChatMsgReqSchema',
    serverHandler: 'ChatCommunicationHandler',
    upstream: 'PACKET_CHAT_MSG_REQ',
  }),
  active(PacketType.CHAT_MSG, 'chat', 'server_to_client', {
    schema: 'ChatMsgSchema',
    clientConsumer: 'GameClient.handlePacket',
    upstream: 'PACKET_CHAT_MSG',
  }),
  active(PacketType.BORDER_UPDATE, 'borders', 'server_to_client', {
    clientConsumer: 'GameClient.handlePacket',
    upstream: 'PACKET_BORDER_INFO',
  }),
  active(PacketType.BORDER_SOURCE_UPDATE, 'borders', 'server_to_client', {
    clientConsumer: 'GameClient.handlePacket',
  }),
  active(PacketType.BORDER_CHANGE_NOTIFICATION, 'borders', 'server_to_client', {
    clientConsumer: 'GameClient.handlePacket',
  }),
  ...[
    PacketType.DIPLOMACY_LIST_REQ,
    PacketType.DIPLOMACY_TREATY_PROPOSE,
    PacketType.DIPLOMACY_TREATY_RESPONSE,
    PacketType.DIPLOMACY_TREATY_CANCEL,
    PacketType.DIPLOMACY_DECLARE_WAR,
  ].map(type =>
    active(type, 'diplomacy', 'client_to_server', { serverHandler: 'DiplomacyHandler' })
  ),
  active(PacketType.DIPLOMACY_LIST_REPLY, 'diplomacy', 'server_to_client', {
    clientConsumer: 'GameClient.handlePacket',
  }),
  active(PacketType.DIPLOMACY_UPDATE, 'diplomacy', 'server_to_client', {
    clientConsumer: 'GameClient.handlePacket',
  }),
];

export interface SocketEventContractEntry {
  event: string;
  family: string;
  classification: 'lifecycle' | 'notification' | 'compatibility';
  sinceVersion: number;
  canonicalPacket?: PacketType;
}

export const SOCKET_EVENT_CONTRACT: readonly SocketEventContractEntry[] = [
  ...[
    'connect',
    'connect_error',
    'connection',
    'disconnect',
    'error',
    'packet',
    'ping',
    'reconnect',
    'reconnect_error',
  ].map(event => ({
    event,
    family: 'connection',
    classification: 'lifecycle' as const,
    sinceVersion: 1,
  })),
  {
    event: 'join_game',
    family: 'lobby',
    classification: 'compatibility',
    sinceVersion: 1,
    canonicalPacket: PacketType.GAME_JOIN,
  },
  {
    event: 'observe_game',
    family: 'lobby',
    classification: 'compatibility',
    sinceVersion: 1,
  },
  {
    event: 'get_game_list',
    family: 'lobby',
    classification: 'compatibility',
    sinceVersion: 1,
    canonicalPacket: PacketType.GAME_LIST,
  },
  {
    event: 'delete_game',
    family: 'lobby',
    classification: 'compatibility',
    sinceVersion: 1,
  },
  ...['host:getControls', 'host:setPaused', 'host:setTurnTimeLimit'].map(event => ({
    event,
    family: 'host_controls',
    classification: 'compatibility' as const,
    sinceVersion: 1,
  })),
  {
    event: 'get_map_data',
    family: 'map',
    classification: 'compatibility',
    sinceVersion: 1,
    canonicalPacket: PacketType.MAP_VIEW_REQ,
  },
  {
    event: 'get_visible_tiles',
    family: 'map',
    classification: 'compatibility',
    sinceVersion: 1,
    canonicalPacket: PacketType.TILE_VISIBILITY_REQ,
  },
  ...['unit_action', 'path_request'].map(event => ({
    event,
    family: 'units',
    classification: 'compatibility' as const,
    sinceVersion: 1,
  })),
  {
    event: 'city:getAvailableProductions',
    family: 'cities',
    classification: 'compatibility',
    sinceVersion: 1,
  },
  {
    event: 'city:changeProduction',
    family: 'cities',
    classification: 'compatibility',
    sinceVersion: 1,
    canonicalPacket: PacketType.CITY_PRODUCTION_CHANGE,
  },
  ...['city:configureGovernor', 'city:optimizeCitizens', 'city:buyProduction'].map(event => ({
    event,
    family: 'cities',
    classification: 'compatibility' as const,
    sinceVersion: 1,
  })),
  ...['government:getState', 'government:startRevolution'].map(event => ({
    event,
    family: 'government',
    classification: 'compatibility' as const,
    sinceVersion: 1,
  })),
  ...['economy:getTaxRates', 'economy:setTaxRates'].map(event => ({
    event,
    family: 'economy',
    classification: 'compatibility' as const,
    sinceVersion: 1,
  })),
  ...['game_created', 'game_started', 'game_deleted', 'game-ended', 'game-control-changed'].map(
    event => ({
      event,
      family: 'lobby',
      classification: 'notification' as const,
      sinceVersion: 1,
    })
  ),
  ...[
    'cities_updated',
    'city:updated',
    'city:availableProductions',
    'city:productionChanged',
    'city_founded',
    'production:completed',
  ].map(event => ({
    event,
    family: 'cities',
    classification: 'notification' as const,
    sinceVersion: 1,
  })),
  ...['unit_update', 'unit_destroyed', 'unit_moved', 'path_response'].map(event => ({
    event,
    family: 'units',
    classification: 'notification' as const,
    sinceVersion: 1,
  })),
  {
    event: 'culture_updated',
    family: 'culture',
    classification: 'notification',
    sinceVersion: 1,
  },
  {
    event: 'turn-started',
    family: 'turn',
    classification: 'notification',
    sinceVersion: 1,
  },
  ...['border_info_request', 'request_full_border_update'].map(event => ({
    event,
    family: 'borders',
    classification: 'compatibility' as const,
    sinceVersion: 1,
  })),
  ...['map_data', 'border_change_notification'].map(event => ({
    event,
    family: 'borders',
    classification: 'notification' as const,
    sinceVersion: 1,
  })),
];
