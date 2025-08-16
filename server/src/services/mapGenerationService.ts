import type { MapTile, TerrainType, GameSettings } from '../../../shared/types';

export interface MapDimensions {
  width: number;
  height: number;
}

export interface StartingPosition {
  x: number;
  y: number;
}

export class MapGenerationService {
  public getMapDimensions(mapSize: GameSettings['mapSize']): MapDimensions {
    switch (mapSize) {
      case 'small':
        return { width: 40, height: 40 };
      case 'medium':
        return { width: 60, height: 60 };
      case 'large':
        return { width: 80, height: 80 };
      default:
        return { width: 40, height: 40 };
    }
  }

  private getTerrainAtPosition(
    x: number,
    y: number,
    dimensions: MapDimensions
  ): TerrainType {
    const centerX = dimensions.width / 2;
    const centerY = dimensions.height / 2;

    // Calculate distance from center
    const distanceFromCenter = Math.sqrt(
      Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2)
    );

    // Add noise for more natural coastlines
    const noise =
      Math.sin(x * 0.1) + Math.cos(y * 0.1) + Math.sin(x * 0.05 + y * 0.05);

    const continentRadius = Math.min(dimensions.width, dimensions.height) * 0.3;
    const adjustedDistance = distanceFromCenter + noise * 3;

    // Determine if this is land, coast, or ocean
    if (adjustedDistance < continentRadius) {
      // Interior land - determine terrain based on distance and randomness
      const landFactor = 1 - distanceFromCenter / continentRadius;
      const randomFactor = Math.random();
      const combinedFactor = landFactor + randomFactor * 0.3;

      if (combinedFactor > 0.8) return 'mountains';
      if (combinedFactor > 0.6) return 'hills';
      if (combinedFactor > 0.4) {
        return Math.random() > 0.5 ? 'forest' : 'grassland';
      }
      if (combinedFactor > 0.2) {
        return Math.random() > 0.3 ? 'plains' : 'grassland';
      }

      // Desert near equator (middle of map)
      if (
        Math.abs(y - centerY) < dimensions.height / 12 &&
        Math.random() > 0.85
      ) {
        return 'desert';
      }

      // Tundra near edges
      if (landFactor < 0.3 && Math.random() > 0.7) {
        return 'tundra';
      }

      return 'grassland';
    } else if (adjustedDistance < continentRadius + 2) {
      return 'coast';
    } else {
      return 'ocean';
    }
  }

  public generateMap(gameId: string, settings: GameSettings): MapTile[] {
    const dimensions = this.getMapDimensions(settings.mapSize);
    const tiles: MapTile[] = [];

    for (let x = 0; x < dimensions.width; x++) {
      for (let y = 0; y < dimensions.height; y++) {
        const terrain = this.getTerrainAtPosition(x, y, dimensions);

        const tile: MapTile = {
          x,
          y,
          terrain,
        };

        tiles.push(tile);
      }
    }

    return tiles;
  }

  public generateStartingPositions(
    playerCount: number,
    dimensions: MapDimensions
  ): StartingPosition[] {
    // Predefined balanced starting positions
    const positions: StartingPosition[] = [
      { x: 5, y: 5 },
      { x: dimensions.width - 6, y: dimensions.height - 6 },
      { x: 5, y: dimensions.height - 6 },
      { x: dimensions.width - 6, y: 5 },
      {
        x: Math.floor(dimensions.width / 2),
        y: Math.floor(dimensions.height / 2),
      },
      { x: 10, y: Math.floor(dimensions.height / 2) },
    ];

    return positions.slice(0, playerCount);
  }

  public validateStartingPosition(
    position: StartingPosition,
    tiles: MapTile[]
  ): boolean {
    const tile = tiles.find(t => t.x === position.x && t.y === position.y);

    if (!tile) return false;

    // Starting positions should be on land
    const landTerrains: TerrainType[] = [
      'grassland',
      'plains',
      'hills',
      'forest',
      'desert',
      'tundra',
    ];

    return landTerrains.includes(tile.terrain);
  }

  public adjustStartingPositions(
    positions: StartingPosition[],
    tiles: MapTile[],
    dimensions: MapDimensions
  ): StartingPosition[] {
    return positions.map(pos => {
      if (this.validateStartingPosition(pos, tiles)) {
        return pos;
      }

      // Find nearest land tile if current position is invalid
      let bestPos = pos;
      let minDistance = Infinity;

      for (const tile of tiles) {
        if (this.validateStartingPosition({ x: tile.x, y: tile.y }, tiles)) {
          const distance = Math.sqrt(
            Math.pow(tile.x - pos.x, 2) + Math.pow(tile.y - pos.y, 2)
          );

          if (distance < minDistance) {
            minDistance = distance;
            bestPos = { x: tile.x, y: tile.y };
          }
        }
      }

      return bestPos;
    });
  }
}
