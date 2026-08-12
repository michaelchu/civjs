/**
 * @module client/components/Canvas2D/renderers/FogRenderer
 * Implements the Fog Renderer canvas rendering stage.
 */
import { BaseRenderer, type RenderState } from './BaseRenderer';

const TILE_UNKNOWN = 0;
const TILE_KNOWN_UNSEEN = 1;
const TILE_KNOWN_SEEN = 2;

type Knowledge = typeof TILE_UNKNOWN | typeof TILE_KNOWN_UNSEEN | typeof TILE_KNOWN_SEEN;

interface FogPainterCorner {
  states: Knowledge[];
  screen: { x: number; y: number };
}

interface FogTile {
  x?: number;
  y?: number;
  known?: boolean;
  visible?: boolean;
}

/**
 * Freeciv's blended, four-corner fog layer.
 *
 * Fog sprites describe the knowledge state of the four tiles surrounding a
 * map-grid corner. Rendering these masks at corners, rather than placing one
 * diamond on every tile, prevents seams at visibility transitions. Coordinates
 * outside the finite map are deliberately treated as unknown. Fully unknown
 * corners are omitted because MapRenderer's opaque black backing already
 * covers them; drawing their overlapping sprites can obscure remembered
 * terrain at the edge of explored space.
 *
 * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview.js:160-179
 * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:372-443
 * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:1881-1911
 */
export class FogRenderer extends BaseRenderer {
  private currentWrapId = 0;
  private currentTopologyId = 0;

  render(state: RenderState): void {
    const mapWidth = state.map.xsize ?? state.map.width;
    const mapHeight = state.map.ysize ?? state.map.height;
    if (!mapWidth || !mapHeight) return;
    this.setMapGeometry(state.map);
    this.currentWrapId = state.map.wrap_id ?? 0;
    this.currentTopologyId = state.map.topology_id ?? 0;
    const knowledgeByCoordinate = new Map<string, Knowledge>();
    for (const rawTile of Object.values(state.map.tiles)) {
      const tile = rawTile as FogTile | undefined;
      if (tile?.x === undefined || tile.y === undefined) continue;
      knowledgeByCoordinate.set(
        this.coordinateKey(tile.x, tile.y),
        this.normalizeKnowledge(tile.known, tile.visible)
      );
    }

    const corners =
      (state.map.topology_id ?? 0) & 4
        ? this.getReferencePainterCorners(state, mapWidth, mapHeight, knowledgeByCoordinate)
        : this.getRectangularCorners(state, mapWidth, mapHeight, knowledgeByCoordinate);

    for (const corner of corners) {
      const { states, screen } = corner;
      if (
        states.every(knowledge => knowledge === TILE_KNOWN_SEEN) ||
        states.every(knowledge => knowledge === TILE_UNKNOWN)
      ) {
        continue;
      }

      const sprite = this.tilesetLoader.getSprite(this.getFogSpriteKey(states));
      if (sprite) {
        this.ctx.drawImage(sprite, screen.x, screen.y);
      } else {
        this.drawFallback(screen.x, screen.y, states);
      }
    }
  }

  /**
   * Reproduce the reference painter's corner pass rather than culling fog in
   * a rectangular native-coordinate box. The legacy renderer walks a doubled
   * GUI grid; odd/even positions are corners and their four tile pointers are
   * populated from map_pos_to_tile() before fill_fog_sprite_array() reverses
   * the order while encoding the ternary mask.
   *
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:305-374
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:1126-1154
   */
  private getReferencePainterCorners(
    state: RenderState,
    mapWidth: number,
    mapHeight: number,
    knowledgeByCoordinate: Map<string, Knowledge>
  ): FogPainterCorner[] {
    const width = this.ctx.canvas?.width || state.viewport.width;
    const height = this.ctx.canvas?.height || state.viewport.height;
    let guiX0 = state.viewport.x;
    let guiY0 = state.viewport.y;
    let guiW = width + (this.tileWidth >> 1);
    let guiH = height + (this.tileHeight >> 1);

    if (guiW < 0) {
      guiX0 += guiW;
      guiW = -guiW;
    }
    if (guiH < 0) {
      guiY0 += guiH;
      guiH = -guiH;
    }
    if (guiW <= 0 || guiH <= 0) return [];

    const painterRadius = 2;
    const painterScale = painterRadius * 2;
    const referenceFloor = (numerator: number, denominator: number): number =>
      Math.floor(numerator / denominator - (numerator < 0 && numerator % denominator < 0 ? 1 : 0));
    const painterX0 = referenceFloor(guiX0 * painterScale, this.tileWidth) - painterRadius / 2;
    const painterY0 = referenceFloor(guiY0 * painterScale, this.tileHeight) - painterRadius / 2;
    const painterX1 =
      referenceFloor((guiX0 + guiW) * painterScale + this.tileWidth - 1, this.tileWidth) +
      painterRadius;
    const painterY1 =
      referenceFloor((guiY0 + guiH) * painterScale + this.tileHeight - 1, this.tileHeight) +
      painterRadius;
    const corners: FogPainterCorner[] = [];

    for (let painterY = Math.floor(painterY0); painterY < Math.floor(painterY1); painterY += 1) {
      for (let painterX = Math.floor(painterX0); painterX < Math.floor(painterX1); painterX += 1) {
        const sum = painterX + painterY;
        if (sum % 2 !== 0) continue;
        if (this.currentWrapId === 0 && (sum <= 0 || sum / 4 > mapWidth)) continue;
        if (painterX % 2 !== 0 || painterY % 2 !== 0 || sum % 4 === 0) continue;

        const difference = painterY - painterX;
        const tilePositions = [
          { x: (sum - 6) / 4, y: (difference - 2) / 4 },
          { x: (sum - 2) / 4, y: (difference - 2) / 4 },
          { x: (sum - 2) / 4, y: (difference + 2) / 4 },
          { x: (sum - 6) / 4, y: (difference + 2) / 4 },
        ];
        // Keep the pcorner array in the same order as the reference. Its
        // fill_fog_sprite_array() encodes indices from 3 down to 0 and the
        // fullfog lookup expands the ternary number back in low-digit order,
        // so the final sprite tag is the original tile[0..3] order.
        const states = tilePositions.map(point =>
          this.getKnowledge(point.x, point.y, mapWidth, mapHeight, knowledgeByCoordinate)
        );
        const guiX = Math.floor((painterX * this.tileWidth) / painterScale - this.tileWidth / 2);
        const guiY = Math.floor((painterY * this.tileHeight) / painterScale - this.tileHeight / 2);
        corners.push({
          states,
          screen: { x: guiX - state.viewport.x, y: guiY - state.viewport.y },
        });
      }
    }

    return corners;
  }

  private getRectangularCorners(
    state: RenderState,
    mapWidth: number,
    mapHeight: number,
    knowledgeByCoordinate: Map<string, Knowledge>
  ): FogPainterCorner[] {
    const bounds = this.getCornerBounds(state);
    const corners: FogPainterCorner[] = [];
    for (let mapY = bounds.minY; mapY <= bounds.maxY; mapY++) {
      for (let mapX = bounds.minX; mapX <= bounds.maxX; mapX++) {
        corners.push({
          states: this.getCornerStates(mapX, mapY, mapWidth, mapHeight, knowledgeByCoordinate),
          screen: this.mapCornerToScreen(mapX, mapY, state),
        });
      }
    }
    return corners;
  }

  /**
   * Match gui_rect_iterate's corner tile ordering. A painter corner is formed
   * from the four native tiles at (x,y), (x+1,y), (x+1,y+1), and (x,y+1), but
   * freeciv-web's fog encoder reads that array in reverse order.
   */
  private getCornerStates(
    mapX: number,
    mapY: number,
    mapWidth: number,
    mapHeight: number,
    knowledgeByCoordinate: Map<string, Knowledge>
  ): Knowledge[] {
    const cornerTiles = [
      { x: mapX, y: mapY },
      { x: mapX + 1, y: mapY },
      { x: mapX + 1, y: mapY + 1 },
      { x: mapX, y: mapY + 1 },
    ];
    return cornerTiles
      .map(point => this.getKnowledge(point.x, point.y, mapWidth, mapHeight, knowledgeByCoordinate))
      .reverse();
  }

  private getCornerBounds(state: RenderState): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } {
    const { viewport } = state;
    // The Zustand viewport dimensions can lag the canvas during resize and
    // route transitions. Fog culling must use the actual backing buffer or
    // the rendered fog rectangle appears to slide as the camera moves.
    const width = this.ctx.canvas?.width || viewport.width;
    const height = this.ctx.canvas?.height || viewport.height;
    const guiCorners = [
      { x: viewport.x, y: viewport.y },
      { x: viewport.x + width, y: viewport.y },
      { x: viewport.x, y: viewport.y + height },
      { x: viewport.x + width, y: viewport.y + height },
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
    const wrapId = this.currentWrapId;
    if ((wrapId & 1) !== 0) x = ((x % mapWidth) + mapWidth) % mapWidth;
    if ((wrapId & 2) !== 0) y = ((y % mapHeight) + mapHeight) % mapHeight;

    // Match the browser reference's finite ISO map_pos_to_tile() lookup. An
    // edge x coordinate is translated into the adjacent diagonal row before
    // indexing the flat tile array; it is not treated as an off-map unknown.
    // @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/map.js:215-219
    if ((this.currentTopologyId & 4) !== 0 && wrapId === 0) {
      if (x >= mapWidth) y -= 1;
      else if (x < 0) y += 1;
      const flatIndex = x + y * mapWidth;
      if (flatIndex < 0 || flatIndex >= mapWidth * mapHeight) return TILE_UNKNOWN;
      const lookupX = ((flatIndex % mapWidth) + mapWidth) % mapWidth;
      const lookupY = Math.floor(flatIndex / mapWidth);
      return knowledgeByCoordinate.get(this.coordinateKey(lookupX, lookupY)) ?? TILE_UNKNOWN;
    }

    if (x < 0 || x >= mapWidth || y < 0 || y >= mapHeight) return TILE_UNKNOWN;
    return knowledgeByCoordinate.get(this.coordinateKey(x, y)) ?? TILE_UNKNOWN;
  }

  private normalizeKnowledge(known: boolean | undefined, visible: boolean | undefined): Knowledge {
    if (!known) return TILE_UNKNOWN;
    if (visible) return TILE_KNOWN_SEEN;
    return TILE_KNOWN_UNSEEN;
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
    // Freeciv-web enumerates fog corners in the same map grid used by the
    // 2D painter; do not convert them through the C native/logical transform.
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
