/**
 * @module client/services/MapTileReducer
 * Provides the client-side Map Tile Reducer service.
 */
import type { Tile } from '../types';

export interface MapTileWireData {
  tile?: number;
  x: number;
  y: number;
  terrain: string;
  known?: number;
  resource?: string;
  elevation?: number;
  riverMask?: number;
  hasRoad?: boolean;
  hasRailroad?: boolean;
  improvements?: string[];
  cityId?: string;
  owner?: string;
  claimer?: string;
  label?: string;
}

export function mapTileFromWire(data: MapTileWireData): Tile {
  return {
    x: data.x,
    y: data.y,
    terrain: data.terrain,
    visible: data.known === 2,
    known: (data.known ?? 0) >= 1,
    units: [],
    city: undefined,
    resource: data.resource,
    elevation: data.elevation,
    riverMask: data.riverMask,
    hasRoad: data.hasRoad,
    hasRailroad: data.hasRailroad,
    improvements: data.improvements,
    cityId: data.cityId,
    owner: data.owner,
    claimer: data.claimer,
    label: data.label,
  };
}
