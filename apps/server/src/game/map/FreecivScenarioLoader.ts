/**
 * @module server/game/map/FreecivScenarioLoader
 * Implements Freeciv Scenario Loader map behavior.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PlayerState } from '@game/runtime/GameTypes';
import { MapTopology, TopologyFlag, WrapFlag } from './MapTopology';
import { MapTile, ResourceType, TerrainType } from './MapTypes';
import { createBaseTile, isLandTile, setTerrainGameProperties } from './TerrainUtils';
import type { LoadedScenario, ScenarioProvider } from './ScenarioProvider';

export const CIV2CIV3_SCENARIOS = [
  'british-isles',
  'earth-large',
  'earth-small',
  'europe',
  'france',
  'hagworld',
  'iberian-peninsula',
  'italy',
  'japan',
  'north_america',
] as const;

export type Civ2Civ3ScenarioId = (typeof CIV2CIV3_SCENARIOS)[number];

interface ScenarioStart {
  x: number;
  y: number;
  exclude: boolean;
  nations: string[];
}

const TERRAIN_NAMES: Record<string, TerrainType> = {
  inaccessible: 'inaccessible',
  lake: 'lake',
  ocean: 'ocean',
  'deep ocean': 'deep_ocean',
  glacier: 'glacier',
  desert: 'desert',
  forest: 'forest',
  grassland: 'grassland',
  hills: 'hills',
  jungle: 'jungle',
  mountains: 'mountains',
  plains: 'plains',
  swamp: 'swamp',
  tundra: 'tundra',
};

const RESOURCE_NAMES: Record<string, ResourceType> = {
  resources: 'resources',
  wheat: 'wheat',
  buffalo: 'buffalo',
  fish: 'fish',
  whales: 'whales',
  game: 'game',
  furs: 'furs',
  fruit: 'fruit',
  oasis: 'oasis',
  peat: 'peat',
  pheasant: 'pheasant',
  iron: 'iron',
  coal: 'coal',
  gold: 'gold',
  gems: 'gems',
  spice: 'spice',
  silk: 'silk',
  wine: 'wine',
  oil: 'oil',
  ivory: 'ivory',
};

/**
 * Loads the map-bearing subset of Freeciv savegame3 scenario files. Scenario
 * scripts and pre-created player/city/unit state belong to lifecycle/savegame
 * loading rather than map generation and are deliberately rejected here.
 *
 * @reference reference/freeciv/server/savegame/savegame3.c
 */
export class FreecivScenarioLoader implements ScenarioProvider {
  constructor(
    private readonly scenarioDirectory = path.resolve(__dirname, '../../shared/data/scenarios')
  ) {}

  listScenarios(): readonly Civ2Civ3ScenarioId[] {
    return CIV2CIV3_SCENARIOS;
  }

  loadScenario(id: string, players: Map<string, PlayerState>): LoadedScenario {
    if (!CIV2CIV3_SCENARIOS.includes(id as Civ2Civ3ScenarioId)) {
      throw new Error(`Unknown Civ2Civ3 scenario '${id}'`);
    }

    const source = fs.readFileSync(path.join(this.scenarioDirectory, `${id}.sav`), 'utf8');
    return this.parseScenario(source, id, players);
  }

  parseScenario(source: string, id: string, players: Map<string, PlayerState>): LoadedScenario {
    if (!this.readBoolean(source, 'is_scenario')) {
      throw new Error(`Scenario '${id}' is not marked as a Freeciv scenario`);
    }

    const terrainRows = this.readRows(source, 't');
    const height = terrainRows.length;
    const width = terrainRows[0]?.length ?? 0;
    if (width === 0 || height === 0 || terrainRows.some(row => row.length !== width)) {
      throw new Error(`Scenario '${id}' has an invalid terrain grid`);
    }

    const topologyId = this.readTopologyId(source);
    const wrapId = this.readWrapId(source);
    const topology = new MapTopology(width, height, { topologyId, wrapId });
    const terrainIdentifiers = this.readTerrainIdentifiers(source);
    const tiles = this.createTiles(terrainRows, terrainIdentifiers);
    this.applyExtras(source, tiles);
    this.assignContinents(tiles, topology);
    this.connectRivers(tiles, topology);

    const starts = this.readStarts(source);
    const startingPositions = this.assignPlayersToStarts(starts, players);
    if (players.size > 0 && startingPositions.length !== players.size) {
      throw new Error(
        `Scenario '${id}' has ${starts.length} usable starts for ${players.size} players`
      );
    }

    return {
      metadata: {
        id,
        name: this.readTranslatedString(source, 'name') ?? id,
        authors: this.readTranslatedString(source, 'authors'),
        description: this.readTranslatedString(source, 'description'),
        ruleset: this.readString(source, 'rulesetdir') ?? 'civ2civ3',
      },
      mapData: {
        width,
        height,
        topologyId,
        wrapId,
        tiles,
        startingPositions,
        seed: `scenario:${id}`,
        generatedAt: new Date(),
      },
    };
  }

  private createTiles(rows: string[], identifiers: Map<string, TerrainType>): MapTile[][] {
    const tiles: MapTile[][] = Array.from({ length: rows[0].length }, () => []);
    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < rows[y].length; x++) {
        const terrain = identifiers.get(rows[y][x]);
        if (!terrain) {
          throw new Error(`Unknown scenario terrain identifier '${rows[y][x]}' at ${x},${y}`);
        }
        const tile = createBaseTile(x, y);
        tile.terrain = terrain;
        tile.elevation = isLandTile(terrain) ? 128 : 0;
        setTerrainGameProperties(tile);
        tiles[x][y] = tile;
      }
    }
    return tiles;
  }

  private readTerrainIdentifiers(source: string): Map<string, TerrainType> {
    const block = source.match(/terrident=\{"name","identifier"\s*\n([\s\S]*?)\n\}/)?.[1];
    if (!block) throw new Error('Scenario is missing its terrain identifier table');

    const identifiers = new Map<string, TerrainType>();
    for (const match of block.matchAll(/^"([^"]+)","(.)"$/gm)) {
      const terrain = TERRAIN_NAMES[match[1].toLowerCase()];
      if (!terrain) throw new Error(`Unsupported scenario terrain '${match[1]}'`);
      identifiers.set(match[2], terrain);
    }
    return identifiers;
  }

  private applyExtras(source: string, tiles: MapTile[][]): void {
    const extras = this.readQuotedVector(source, 'extras_vector');
    const layerPattern = /^e(\d{2})_(\d{4})="([0-9a-fA-F]+)"$/gm;
    for (const match of source.matchAll(layerPattern)) {
      const layer = Number(match[1]);
      const y = Number(match[2]);
      const row = match[3];
      if (!tiles[0]?.[y] || row.length !== tiles.length) {
        throw new Error(`Invalid scenario extra row e${match[1]}_${match[2]}`);
      }
      for (let x = 0; x < row.length; x++) {
        const bits = Number.parseInt(row[x], 16);
        for (let bit = 0; bit < 4; bit++) {
          if ((bits & (1 << bit)) !== 0) {
            const extra = extras[layer * 4 + bit];
            if (extra) this.applyExtra(tiles[x][y], extra);
          }
        }
      }
    }
  }

  private applyExtra(tile: MapTile, extraName: string): void {
    const normalized = extraName.toLowerCase();
    if (normalized === 'road') tile.hasRoad = true;
    if (normalized === 'railroad' || normalized === 'maglev') tile.hasRailroad = true;

    const resource = RESOURCE_NAMES[normalized];
    if (resource) {
      tile.resource = resource;
      return;
    }

    if (!tile.improvements.includes(normalized)) tile.improvements.push(normalized);
  }

  private assignContinents(tiles: MapTile[][], topology: MapTopology): void {
    const visited = new Set<string>();
    let continentId = 1;
    for (let x = 0; x < topology.width; x++) {
      for (let y = 0; y < topology.height; y++) {
        if (!isLandTile(tiles[x][y].terrain) || visited.has(`${x},${y}`)) continue;
        const queue = [{ x, y }];
        while (queue.length > 0) {
          const current = queue.pop()!;
          const key = `${current.x},${current.y}`;
          if (visited.has(key) || !isLandTile(tiles[current.x][current.y].terrain)) continue;
          visited.add(key);
          tiles[current.x][current.y].continentId = continentId;
          queue.push(...topology.getCardinalNeighbors(current.x, current.y));
        }
        continentId++;
      }
    }
  }

  private connectRivers(tiles: MapTile[][], topology: MapTopology): void {
    for (let x = 0; x < topology.width; x++) {
      for (let y = 0; y < topology.height; y++) {
        const tile = tiles[x][y];
        if (!tile.improvements.includes('river')) continue;
        for (const [index, direction] of topology.getCardinalDirections().entries()) {
          const neighbor = topology.step(x, y, direction);
          if (neighbor && tiles[neighbor.x][neighbor.y].improvements.includes('river')) {
            tile.riverMask |= 1 << index;
          }
        }
      }
    }
  }

  private readStarts(source: string): ScenarioStart[] {
    const block = source.match(/startpos=\{"x","y","exclude","nations"\s*\n([\s\S]*?)\n\}/)?.[1];
    if (!block) return [];
    return [...block.matchAll(/^(\d+),(\d+),(TRUE|FALSE),"([^"]*)"$/gm)].map(match => ({
      x: Number(match[1]),
      y: Number(match[2]),
      exclude: match[3] === 'TRUE',
      nations: match[4].split('#').filter(Boolean),
    }));
  }

  private assignPlayersToStarts(
    starts: ScenarioStart[],
    players: Map<string, PlayerState>
  ): Array<{ x: number; y: number; playerId: string }> {
    const remaining = [...starts];
    return [...players.values()].flatMap(player => {
      const civilization = player.civilization.toLowerCase();
      let index = remaining.findIndex(
        start =>
          !start.exclude && start.nations.some(nation => nation.toLowerCase() === civilization)
      );
      if (index < 0) index = remaining.findIndex(start => start.nations.length === 0);
      if (index < 0) index = 0;
      const start = remaining.splice(index, 1)[0];
      return start ? [{ x: start.x, y: start.y, playerId: player.id }] : [];
    });
  }

  private readRows(source: string, prefix: string): string[] {
    return [...source.matchAll(new RegExp(`^${prefix}(\\d{4})="(.*)"$`, 'gm'))]
      .sort((left, right) => Number(left[1]) - Number(right[1]))
      .map(match => match[2]);
  }

  private readQuotedVector(source: string, key: string): string[] {
    const line = source.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1] ?? '';
    return [...line.matchAll(/"([^"]*)"/g)].map(match => match[1]);
  }

  private readBoolean(source: string, key: string): boolean {
    return new RegExp(`^${key}=TRUE$`, 'm').test(source);
  }

  private readString(source: string, key: string): string | undefined {
    return source.match(new RegExp(`^${key}="([^"]*)"$`, 'm'))?.[1];
  }

  private readTranslatedString(source: string, key: string): string | undefined {
    const value = source.match(new RegExp(`^${key}=_\\("([\\s\\S]*?)"\\)$`, 'm'))?.[1];
    return value?.replaceAll('\\n', '\n');
  }

  private readSetting(source: string, name: string): string | undefined {
    return source
      .match(new RegExp(`^"${name}",(?:"([^"]*)"|([^,]+)),`, 'm'))
      ?.slice(1)
      .find(Boolean);
  }

  private readTopologyId(source: string): number {
    const value = this.readSetting(source, 'topology')?.toUpperCase() ?? '';
    return (
      (value.includes('ISO') ? TopologyFlag.ISO : 0) |
      (value.includes('HEX') ? TopologyFlag.HEX : 0)
    );
  }

  private readWrapId(source: string): number {
    const value = this.readSetting(source, 'wrap')?.toUpperCase() ?? '';
    return (value.includes('WRAPX') ? WrapFlag.X : 0) | (value.includes('WRAPY') ? WrapFlag.Y : 0);
  }
}
