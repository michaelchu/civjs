/**
 * Border system network packets for CivJS
 * These packets handle border synchronization between client and server
 * @reference docs/BORDER_SYSTEM_PORT_PLAN.md Phase 2.1
 */

import type { BorderSource, TileOwnership } from './BorderTypes';

/**
 * Packet for updating tile ownership and border sources
 */
export interface BorderUpdatePacket {
  type: 'border_update';
  tiles: Array<{
    x: number;
    y: number;
    owner: string | null;
    strength: number;
  }>;
  updateType: 'full_update' | 'incremental' | 'player_specific';
  affectedPlayers?: string[];
}

/**
 * Packet for updating border sources (cities, forts, etc.)
 */
export interface BorderSourcePacket {
  type: 'border_source_update';
  sources: BorderSource[];
  removed: Array<{ x: number; y: number }>;
}

/**
 * Request packet for border information
 */
export interface BorderInfoRequestPacket {
  type: 'border_info_request';
  region?: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  playerId?: string;
}

/**
 * Response packet with complete border information
 */
export interface BorderInfoResponsePacket {
  type: 'border_info_response';
  sources: BorderSource[];
  ownership: TileOwnership[];
  requestId?: string;
}

/**
 * Notification packet for border changes that affect players
 */
export interface BorderChangeNotificationPacket {
  type: 'border_change_notification';
  playerId: string;
  tilesGained: Array<{ x: number; y: number }>;
  tilesLost: Array<{ x: number; y: number }>;
  sourceAdded?: BorderSource;
  sourceRemoved?: { x: number; y: number };
}
