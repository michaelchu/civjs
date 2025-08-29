import { logger } from '../../utils/logger';
import { MapTile, TerrainType, TemperatureType } from './MapTypes';
import { PlayerState } from '../GameManager';

export class StartingPositionGenerator {
  private width: number;
  private height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  /**
   * Generate starting positions for players
   */
  public async generateStartingPositions(
    tiles: MapTile[][],
    players: Map<string, PlayerState>
  ): Promise<Array<{ x: number; y: number; playerId: string }>> {
    const positions: Array<{ x: number; y: number; playerId: string }> = [];
    const playerIds = Array.from(players.keys());

    // Find suitable starting locations
    const candidatePositions: Array<{ x: number; y: number; score: number }> = [];

    for (let x = 5; x < this.width - 5; x++) {
      for (let y = 5; y < this.height - 5; y++) {
        const tile = tiles[x][y];

        if (!this.isStartingSuitableTerrain(tile.terrain)) {
          continue;
        }

        const score = this.evaluateStartingPosition(tiles, x, y);
        if (score > 50) {
          candidatePositions.push({ x, y, score });
        }
      }
    }

    // Sort by score descending
    candidatePositions.sort((a, b) => b.score - a.score);

    // Select positions with minimum distance between players
    const minDistance = Math.max(
      8,
      Math.floor(Math.sqrt((this.width * this.height) / playerIds.length))
    );

    for (const playerId of playerIds) {
      let bestPosition = null;

      for (const candidate of candidatePositions) {
        // Check minimum distance from existing positions
        const tooClose = positions.some(pos => {
          const dx = pos.x - candidate.x;
          const dy = pos.y - candidate.y;
          return Math.sqrt(dx * dx + dy * dy) < minDistance;
        });

        if (!tooClose) {
          bestPosition = candidate;
          break;
        }
      }

      if (bestPosition) {
        positions.push({ x: bestPosition.x, y: bestPosition.y, playerId });
        logger.debug('Assigned starting position', {
          playerId,
          x: bestPosition.x,
          y: bestPosition.y,
          score: bestPosition.score,
        });
      } else {
        // Fallback: use any available position or create emergency position
        if (candidatePositions.length > 0) {
          const fallback = candidatePositions[positions.length % candidatePositions.length];
          positions.push({ x: fallback.x, y: fallback.y, playerId });
          logger.warn('Used fallback starting position', {
            playerId,
            x: fallback.x,
            y: fallback.y,
          });
        } else {
          // Emergency: place at safe coordinates if no candidates found
          const emergencyX = Math.min(5 + positions.length, this.width - 6);
          const emergencyY = Math.min(5 + positions.length, this.height - 6);
          positions.push({ x: emergencyX, y: emergencyY, playerId });
          logger.warn('Used emergency starting position', {
            playerId,
            x: emergencyX,
            y: emergencyY,
          });
        }
      }
    }

    return positions;
  }

  /**
   * Check if terrain is suitable for starting
   */
  private isStartingSuitableTerrain(terrain: TerrainType): boolean {
    return ['grassland', 'plains', 'forest', 'hills'].includes(terrain);
  }

  /**
   * Enhanced climate-aware starting position evaluation
   */
  private evaluateStartingPosition(tiles: MapTile[][], x: number, y: number): number {
    let score = 0;
    const radius = 3;
    const centerTile = tiles[x][y];

    // Climate base score - temperate zones are best for starting
    const climateScore = this.getClimateScore(centerTile);
    score += climateScore * 0.4; // Climate is 40% of base score

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const nx = x + dx;
        const ny = y + dy;

        if (!this.isValidCoord(nx, ny)) continue;

        const tile = tiles[nx][ny];
        const distance = Math.sqrt(dx * dx + dy * dy);
        const weight = Math.max(0, 1 - distance / radius);

        // Enhanced terrain scoring with climate consideration
        let terrainScore = this.getTerrainStartingScore(tile);

        // Climate synergy bonuses
        if (tile.temperature & TemperatureType.TEMPERATE) {
          terrainScore *= 1.2; // Temperate zones are ideal
        } else if (tile.temperature & TemperatureType.TROPICAL) {
          terrainScore *= 1.1; // Tropical can be productive
        } else if (tile.temperature & TemperatureType.COLD) {
          terrainScore *= 0.8; // Cold zones are challenging
        } else if (tile.temperature & TemperatureType.FROZEN) {
          terrainScore *= 0.5; // Frozen zones are very challenging
        }

        score += terrainScore * weight;

        // Enhanced resource bonus with climate consideration
        if (tile.resource) {
          let resourceScore = 15;

          // Some resources are better in certain climates
          if (tile.resource === 'wheat' && tile.temperature & TemperatureType.TEMPERATE) {
            resourceScore *= 1.3; // Wheat thrives in temperate zones
          } else if (tile.resource === 'spices' && tile.temperature & TemperatureType.TROPICAL) {
            resourceScore *= 1.3; // Spices from tropical regions
          }

          score += resourceScore * weight;
        }

        // River bonus (enhanced for climate)
        if (tile.riverMask > 0) {
          let riverScore = 8;
          // Rivers are more valuable in arid climates
          if (tile.wetness < 40) {
            riverScore *= 1.5;
          }
          score += riverScore * weight;
        }

        // Climate diversity bonus (access to different biomes is good)
        if (distance <= 2) {
          const centerClimate = centerTile.temperature;
          if (tile.temperature !== centerClimate) {
            score += 3 * weight; // Bonus for climate variety nearby
          }
        }
      }
    }

    // Penalty for extreme climates without variety
    const nearbyClimateVariety = this.hasClimateVariety(tiles, x, y);
    if (!nearbyClimateVariety) {
      if (centerTile.temperature & (TemperatureType.FROZEN | TemperatureType.TROPICAL)) {
        score *= 0.7; // Penalty for monotonous extreme climates
      }
    }

    // Bonus for climate transition zones (more strategic options)
    if (nearbyClimateVariety) {
      score += 10;
    }

    return Math.max(0, score);
  }

  /**
   * Get climate score for a tile
   */
  private getClimateScore(tile: MapTile): number {
    if (tile.temperature & TemperatureType.TEMPERATE) {
      return 60; // Ideal climate
    } else if (tile.temperature & TemperatureType.TROPICAL) {
      return 45; // Good but can be hot
    } else if (tile.temperature & TemperatureType.COLD) {
      return 30; // Challenging but manageable
    } else if (tile.temperature & TemperatureType.FROZEN) {
      return 10; // Very challenging
    }
    return 25; // Default/unknown
  }

  /**
   * Get terrain starting score
   */
  private getTerrainStartingScore(tile: MapTile): number {
    const terrainScores: Record<TerrainType, number> = {
      grassland: 12, // Excellent for starting
      plains: 10, // Very good base terrain
      forest: 8, // Good for production
      hills: 6, // Good for mining/defense
      coast: 4, // Decent for fishing/trade
      jungle: 3, // Can be cleared for good land
      swamp: 2, // Poor but can be improved
      tundra: 2, // Cold but manageable
      desert: 1, // Harsh conditions
      mountains: 1, // Very poor for starting cities
      lake: -1, // Water tile
      deep_ocean: -5,
      ocean: -5,
    };

    return terrainScores[tile.terrain] || 0;
  }

  /**
   * Check if there's climate variety nearby
   */
  private hasClimateVariety(tiles: MapTile[][], centerX: number, centerY: number): boolean {
    const centerTile = tiles[centerX][centerY];
    const radius = 2;

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const x = centerX + dx;
        const y = centerY + dy;

        if (this.isValidCoord(x, y)) {
          const tile = tiles[x][y];
          if (tile.temperature !== centerTile.temperature) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Check if coordinates are valid
   */
  private isValidCoord(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }
}
