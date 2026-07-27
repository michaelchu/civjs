import { BaseRenderer, type RenderState } from './BaseRenderer';

const TILE_UNKNOWN = 0;
const TILE_KNOWN_UNSEEN = 1;
const TILE_KNOWN_SEEN = 2;

type Knowledge = typeof TILE_UNKNOWN | typeof TILE_KNOWN_UNSEEN | typeof TILE_KNOWN_SEEN;

interface FogTile {
  x?: number;
  y?: number;
  known?: number;
}

interface MapDimensions {
  xsize?: number;
  ysize?: number;
}

/**
 * Freeciv's blended, four-corner fog layer.
 *
 * Fog sprites describe the knowledge state of the four tiles surrounding a
 * map-grid corner. Rendering these masks at corners, rather than placing one
 * diamond on every tile, prevents seams at visibility transitions. Coordinates
 * outside the finite map are deliberately treated as unknown so fog also
 * covers the infinite ocean padding rendered beneath the map.
 *
 * @reference reference/freeciv-web/javascript/2dcanvas/mapview.js:160-179
 * @reference reference/freeciv-web/javascript/2dcanvas/mapview_common.js:372-443
 * @reference reference/freeciv-web/javascript/2dcanvas/tilespec.js:1881-1911
 */
export class FogRenderer extends BaseRenderer {
  render(state: RenderState, globalTiles: unknown[]): void {
    const stateMap = state.map as MapDimensions | undefined;
    const globalMap = (window as unknown as { map?: MapDimensions }).map;
    const map = stateMap?.xsize && stateMap?.ysize ? stateMap : globalMap;
    const mapWidth = map?.xsize;
    const mapHeight = map?.ysize;
    if (!mapWidth || !mapHeight) return;

    const knowledgeByCoordinate = new Map<string, Knowledge>();
    for (const rawTile of globalTiles) {
      const tile = rawTile as FogTile | undefined;
      if (tile?.x === undefined || tile.y === undefined) continue;
      knowledgeByCoordinate.set(
        this.coordinateKey(tile.x, tile.y),
        this.normalizeKnowledge(tile.known)
      );
    }

    const bounds = this.getCornerBounds(state);
    for (let mapY = bounds.minY; mapY <= bounds.maxY; mapY++) {
      for (let mapX = bounds.minX; mapX <= bounds.maxX; mapX++) {
        const states = [
          this.getKnowledge(mapX, mapY, mapWidth, mapHeight, knowledgeByCoordinate),
          this.getKnowledge(mapX + 1, mapY, mapWidth, mapHeight, knowledgeByCoordinate),
          this.getKnowledge(mapX + 1, mapY + 1, mapWidth, mapHeight, knowledgeByCoordinate),
          this.getKnowledge(mapX, mapY + 1, mapWidth, mapHeight, knowledgeByCoordinate),
        ];

        if (states.every(knowledge => knowledge === TILE_KNOWN_SEEN)) continue;

        const sprite = this.tilesetLoader.getSprite(this.getFogSpriteKey(states));
        const screen = this.mapCornerToScreen(mapX, mapY, state);
        if (sprite) {
          this.ctx.drawImage(sprite, screen.x, screen.y);
        } else {
          this.drawFallback(screen.x, screen.y, states);
        }
      }
    }
  }

  private getCornerBounds(state: RenderState): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } {
    const { viewport } = state;
    const guiCorners = [
      { x: viewport.x, y: viewport.y },
      { x: viewport.x + viewport.width, y: viewport.y },
      { x: viewport.x, y: viewport.y + viewport.height },
      { x: viewport.x + viewport.width, y: viewport.y + viewport.height },
    ];
    const mapCorners = guiCorners.map(({ x, y }) => ({
      x: x / this.tileWidth + y / this.tileHeight,
      y: y / this.tileHeight - x / this.tileWidth,
    }));

    // The transition sprites extend one tile around their anchor. Two extra
    // coordinates absorb rounding at negative viewport positions.
    return {
      minX: Math.floor(Math.min(...mapCorners.map(corner => corner.x))) - 2,
      maxX: Math.ceil(Math.max(...mapCorners.map(corner => corner.x))) + 2,
      minY: Math.floor(Math.min(...mapCorners.map(corner => corner.y))) - 2,
      maxY: Math.ceil(Math.max(...mapCorners.map(corner => corner.y))) + 2,
    };
  }

  private getKnowledge(
    x: number,
    y: number,
    mapWidth: number,
    mapHeight: number,
    knowledgeByCoordinate: Map<string, Knowledge>
  ): Knowledge {
    if (x < 0 || x >= mapWidth || y < 0 || y >= mapHeight) return TILE_UNKNOWN;
    return knowledgeByCoordinate.get(this.coordinateKey(x, y)) ?? TILE_UNKNOWN;
  }

  private normalizeKnowledge(known: number | undefined): Knowledge {
    if (known === TILE_KNOWN_SEEN) return TILE_KNOWN_SEEN;
    if (known === TILE_KNOWN_UNSEEN) return TILE_KNOWN_UNSEEN;
    return TILE_UNKNOWN;
  }

  private getFogSpriteKey(states: Knowledge[]): string {
    const suffix = states
      .map(knowledge =>
        knowledge === TILE_KNOWN_SEEN ? 'k' : knowledge === TILE_KNOWN_UNSEEN ? 'f' : 'u'
      )
      .join('_');
    return `t.fog_${suffix}`;
  }

  private mapCornerToScreen(
    mapX: number,
    mapY: number,
    state: RenderState
  ): { x: number; y: number } {
    const tileOrigin = this.mapToScreen(mapX, mapY, state.viewport);
    return {
      x: tileOrigin.x,
      y: tileOrigin.y + this.tileHeight / 2,
    };
  }

  private coordinateKey(x: number, y: number): string {
    return `${x},${y}`;
  }

  private drawFallback(x: number, y: number, states: Knowledge[]): void {
    const hasUnknown = states.some(knowledge => knowledge === TILE_UNKNOWN);
    this.ctx.fillStyle = hasUnknown ? '#000' : 'rgba(15, 20, 30, 0.58)';
    this.ctx.fillRect(x, y, this.tileWidth, this.tileHeight);
  }
}
