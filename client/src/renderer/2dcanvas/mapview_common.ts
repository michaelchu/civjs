/**********************************************************************
    Freeciv-web - the web version of Freeciv. https://www.freeciv.org/
    Copyright (C) 2009-2015  The Freeciv-web project

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.

***********************************************************************/

// TypeScript conversion of Freeciv-web mapview_common.js

// Global state variables (converting from var to proper types)
interface MapView {
  gui_x0: number;
  gui_y0: number;
  width: number;
  height: number;
  store_width: number;
  store_height: number;
}

interface MapViewSlide {
  active: boolean;
  dx: number;
  dy: number;
  i: number;
  max: number;
  slide_time: number;
  start?: number;
}

interface Tile {
  x: number;
  y: number;
  tile?: number;
  [key: string]: any;
}

// Global variables (will need to be managed properly in React context)
export let mapview: MapView = {
  gui_x0: 0,
  gui_y0: 0,
  width: 800,
  height: 600,
  store_width: 800,
  store_height: 600,
};

export let mapdeco_highlight_table: Record<string, any> = {};
export let mapdeco_crosshair_table: Record<string, any> = {};
export let last_redraw_time = 0;
export const MAPVIEW_REFRESH_INTERVAL = 10;

export let mapview_slide: MapViewSlide = {
  active: false,
  dx: 0,
  dy: 0,
  i: 0,
  max: 100,
  slide_time: 700,
};

// Import tile configuration and sprite functionality
import {
  tileset_tile_width,
  tileset_tile_height,
} from './tileset_config_amplio2';
import { sprites, mapview_put_tile } from './mapview';

// External dependencies that need to be defined elsewhere
declare let tiles: Record<number, Tile>;
declare let keyboard_input: boolean;

// Functions that need to be defined elsewhere
declare function init_game_unit_panel(): void;
declare function init_chatbox(): void;
declare function center_tile_mapcanvas(ptile: Tile): void;

export function mapdeco_init(): void {
  mapdeco_highlight_table = {};
  mapdeco_crosshair_table = {};

  init_game_unit_panel();
  init_chatbox();
  keyboard_input = true;
}

/**************************************************************************
  Centers the mapview around (map_x, map_y).
**************************************************************************/
export function center_tile_mapcanvas_2d(ptile: Tile): void {
  const r = map_to_gui_pos(ptile.x, ptile.y);
  let gui_x = r.gui_dx;
  let gui_y = r.gui_dy;

  gui_x -= (mapview.width - tileset_tile_width) >> 1;
  gui_y -= (mapview.height - tileset_tile_height) >> 1;

  set_mapview_origin(gui_x, gui_y);
}

/**************************************************************************
  Centers the mapview around tile with given id.
**************************************************************************/
export function center_tile_id(ptile_id: number): void {
  const ptile = tiles[ptile_id];
  center_tile_mapcanvas(ptile);
}

/****************************************************************************
  Translate from a cartesian system to the GUI system.  This function works
  on vectors, meaning it can be passed a (dx,dy) pair and will return the
  change in GUI coordinates corresponding to this vector.  It is thus more
  general than map_to_gui_pos.

  Note that a gui_to_map_vector function is not possible, since the
  resulting map vector may differ based on the origin of the gui vector.
  Note that is function is for isometric tilesets only.
****************************************************************************/
export function map_to_gui_vector(
  map_dx: number,
  map_dy: number
): { gui_dx: number; gui_dy: number } {
  /*
   * Convert the map coordinates to isometric GUI
   * coordinates.  We'll make tile map(0,0) be the origin, and
   * transform like this:
   *
   *                     3
   * 123                2 6
   * 456 -> becomes -> 1 5 9
   * 789                4 8
   *                     7
   */

  const gui_dx = ((map_dx - map_dy) * tileset_tile_width) >> 1;
  const gui_dy = ((map_dx + map_dy) * tileset_tile_height) >> 1;
  return { gui_dx: gui_dx, gui_dy: gui_dy };
}

/****************************************************************************
  Change the mapview origin, clip it, and update everything.
****************************************************************************/
export function set_mapview_origin(gui_x0: number, gui_y0: number): void {
  /* Normalize (wrap) the mapview origin. */
  const r = normalize_gui_pos(gui_x0, gui_y0);
  gui_x0 = r.gui_x;
  gui_y0 = r.gui_y;

  base_set_mapview_origin(gui_x0, gui_y0);
}

/****************************************************************************
  Move the GUI origin to the given normalized, clipped origin.  This may
  be called many times when sliding the mapview.
****************************************************************************/
export function base_set_mapview_origin(gui_x0: number, gui_y0: number): void {
  const g = normalize_gui_pos(gui_x0, gui_y0);
  gui_x0 = g.gui_x;
  gui_y0 = g.gui_y;

  mapview.gui_x0 = gui_x0;
  mapview.gui_y0 = gui_y0;
}

/****************************************************************************
  Normalize (wrap) the GUI position.  This is equivalent to a map wrapping,
  but in GUI coordinates so that pixel accuracy is preserved.
****************************************************************************/
export function normalize_gui_pos(
  gui_x: number,
  gui_y: number
): { gui_x: number; gui_y: number } {
  // Simplified version - in full Freeciv this handles map wrapping
  return { gui_x, gui_y };
}

export function map_to_gui_pos(
  map_x: number,
  map_y: number
): { gui_dx: number; gui_dy: number } {
  return map_to_gui_vector(map_x, map_y);
}

/****************************************************************************
  Translate from gui to map coordinate systems.  See map_to_gui_pos().
****************************************************************************/
export function gui_to_map_pos(
  gui_x: number,
  gui_y: number
): { map_x: number; map_y: number } {
  const W = tileset_tile_width;
  const H = tileset_tile_height;

  gui_x -= W >> 1;
  const map_x = DIVIDE(gui_x * H + gui_y * W, W * H);
  const map_y = DIVIDE(gui_y * W - gui_x * H, W * H);

  return { map_x: map_x, map_y: map_y };
}

/****************************************************************************
  Integer division that rounds towards negative infinity (like Freeciv's DIVIDE)
****************************************************************************/
function DIVIDE(a: number, b: number): number {
  return Math.floor(a / b);
}

/**************************************************************************
  Update (refresh) the map canvas starting at the given tile (in map
  coordinates) and with the given dimensions (also in map coordinates).

  Freeciv's exact update_map_canvas implementation
**************************************************************************/
export function update_map_canvas(
  canvas_x: number,
  canvas_y: number,
  width: number,
  height: number,
  ctx: CanvasRenderingContext2D,
  terrainMap: any[][],
  mapWidth: number,
  mapHeight: number
): void {
  let gui_x0: number, gui_y0: number;

  gui_x0 = mapview.gui_x0 + canvas_x;
  gui_y0 = mapview.gui_y0 + canvas_y;

  // Clear the area
  ctx.fillStyle = 'rgb(0,0,0)';
  ctx.fillRect(canvas_x, canvas_y, width, height);

  // mapview_layer_iterate - simplified to just terrain layer
  const LAYER_COUNT = 1;
  for (let layer = 0; layer <= LAYER_COUNT; layer++) {
    //gui_rect_iterate begin - Freeciv's exact complex algorithm
    let gui_x_0 = gui_x0;
    let gui_y_0 = gui_y0;
    let gui_x_w = width + (tileset_tile_width >> 1);
    let gui_y_h = height + (tileset_tile_height >> 1);

    if (gui_x_w < 0) {
      gui_x_0 += gui_x_w;
      gui_x_w = -gui_x_w;
    }

    if (gui_y_h < 0) {
      gui_y_0 += gui_y_h;
      gui_y_h = -gui_y_h;
    }

    if (gui_x_w > 0 && gui_y_h > 0) {
      let ptile_xi: number,
        ptile_yi: number,
        ptile_si: number,
        ptile_di: number;
      let gui_x: number, gui_y: number;
      const ptile_r1 = 2;
      const ptile_r2 = ptile_r1 * 2;
      const ptile_w = tileset_tile_width;
      const ptile_h = tileset_tile_height;

      // Freeciv's exact complex tile bounds calculation
      const ptile_x0 = Math.floor(
        (gui_x_0 * ptile_r2) / ptile_w -
          (gui_x_0 * ptile_r2 < 0 && (gui_x_0 * ptile_r2) % ptile_w < 0
            ? 1
            : 0) -
          ptile_r1 / 2
      );
      const ptile_y0 = Math.floor(
        (gui_y_0 * ptile_r2) / ptile_h -
          (gui_y_0 * ptile_r2 < 0 && (gui_y_0 * ptile_r2) % ptile_h < 0
            ? 1
            : 0) -
          ptile_r1 / 2
      );
      const ptile_x1 = Math.floor(
        ((gui_x_0 + gui_x_w) * ptile_r2 + ptile_w - 1) / ptile_w -
          ((gui_x_0 + gui_x_w) * ptile_r2 + ptile_w - 1 < 0 &&
          ((gui_x_0 + gui_x_w) * ptile_r2 + ptile_w - 1) % ptile_w < 0
            ? 1
            : 0) +
          ptile_r1
      );
      const ptile_y1 = Math.floor(
        ((gui_y_0 + gui_y_h) * ptile_r2 + ptile_h - 1) / ptile_h -
          ((gui_y_0 + gui_y_h) * ptile_r2 + ptile_h - 1 < 0 &&
          ((gui_y_0 + gui_y_h) * ptile_r2 + ptile_h - 1) % ptile_h < 0
            ? 1
            : 0) +
          ptile_r1
      );
      const ptile_count = (ptile_x1 - ptile_x0) * (ptile_y1 - ptile_y0);

      for (let ptile_index = 0; ptile_index < ptile_count; ptile_index++) {
        let ptile: any = null;

        ptile_xi = ptile_x0 + (ptile_index % (ptile_x1 - ptile_x0));
        ptile_yi = Math.floor(ptile_y0 + ptile_index / (ptile_x1 - ptile_x0));
        ptile_si = ptile_xi + ptile_yi;
        ptile_di = ptile_yi - ptile_xi;

        if ((ptile_xi + ptile_yi) % 2 != 0) {
          continue;
        }

        if (ptile_xi % 2 == 0 && ptile_yi % 2 == 0) {
          if ((ptile_xi + ptile_yi) % 4 == 0) {
            // Tile - Freeciv's exact formula
            const map_x = ptile_si / 4 - 1;
            const map_y = ptile_di / 4;

            // Check if tile is within our map bounds
            if (
              map_x >= 0 &&
              map_x < mapWidth &&
              map_y >= 0 &&
              map_y < mapHeight
            ) {
              ptile = { x: map_x, y: map_y, terrain: terrainMap[map_y][map_x] };
            }
          }
        }

        gui_x = Math.floor((ptile_xi * ptile_w) / ptile_r2 - ptile_w / 2);
        gui_y = Math.floor((ptile_yi * ptile_h) / ptile_r2 - ptile_h / 2);

        const cx = gui_x - mapview.gui_x0;
        const cy = gui_y - mapview.gui_y0;

        if (ptile != null) {
          put_one_tile(ctx, layer, ptile, cx, cy);
        }
      }
    }
  }
}

/**************************************************************************
  Draw some or all of a tile onto the canvas.
**************************************************************************/
export function put_one_tile(
  pcanvas: CanvasRenderingContext2D,
  layer: number,
  ptile: any,
  canvas_x: number,
  canvas_y: number
): void {
  // For now just draw terrain layer
  if (layer === 0) {
    put_one_element(
      pcanvas,
      layer,
      ptile,
      null,
      null,
      null,
      null,
      canvas_x,
      canvas_y
    );
  }
}

/**************************************************************************
  Draw one layer of a tile, edge, corner, unit, and/or city onto the
  canvas at the given position.
**************************************************************************/
export function put_one_element(
  pcanvas: CanvasRenderingContext2D,
  layer: number,
  ptile: any,
  pedge: any,
  pcorner: any,
  punit: any,
  pcity: any,
  canvas_x: number,
  canvas_y: number
): void {
  if (layer === 0 && ptile) {
    const tile_sprs = fill_sprite_array(layer, ptile);
    put_drawn_sprites(pcanvas, canvas_x, canvas_y, tile_sprs);
  }
}

/****************************************************************************
  Simplified fill_sprite_array - returns sprites to draw for this tile
****************************************************************************/
export function fill_sprite_array(layer: number, ptile: any): any[] {
  if (layer === 0 && ptile && ptile.terrain) {
    return [{ key: ptile.terrain }];
  }
  return [];
}

/****************************************************************************
  Draw an array of drawn sprites onto the canvas.
****************************************************************************/
export function put_drawn_sprites(
  pcanvas: CanvasRenderingContext2D,
  canvas_x: number,
  canvas_y: number,
  pdrawn: any[]
): void {
  for (let i = 0; i < pdrawn.length; i++) {
    const sprite_key = pdrawn[i].key;

    // Try to use the sprite system first
    if (sprites[sprite_key]) {
      mapview_put_tile(pcanvas, sprite_key, canvas_x, canvas_y);
    } else {
      // Fallback: draw basic colored rectangles
      drawBasicTerrain(pcanvas, sprite_key, canvas_x, canvas_y);
    }
  }
}

// Fallback terrain rendering function
function drawBasicTerrain(
  ctx: CanvasRenderingContext2D,
  terrain: string,
  x: number,
  y: number
): void {
  const colors: Record<string, string> = {
    ocean: '#006994',
    coast: '#4A90A4',
    grassland: '#7CBA3D',
    plains: '#C4A57B',
    desert: '#F2E7AE',
    tundra: '#BFBFBF',
    forest: '#228B22',
    hills: '#8B7355',
    mountains: '#8B7D6B',
  };

  const color = colors[terrain] || '#808080';
  const tileWidth = tileset_tile_width;
  const tileHeight = tileset_tile_height;

  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;

  // Draw isometric diamond
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(tileWidth / 2, tileHeight / 2);
  ctx.lineTo(0, tileHeight);
  ctx.lineTo(-tileWidth / 2, tileHeight / 2);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

/****************************************************************************
  Find map coordinates corresponding to pixel coordinates.
****************************************************************************/
export function base_canvas_to_map_pos(
  canvas_x: number,
  canvas_y: number
): { map_x: number; map_y: number } {
  return gui_to_map_pos(canvas_x + mapview.gui_x0, canvas_y + mapview.gui_y0);
}

/**************************************************************************
  Find the tile corresponding to pixel coordinates.
**************************************************************************/
export function canvas_pos_to_tile(canvas_x: number, canvas_y: number): any {
  const r = base_canvas_to_map_pos(canvas_x, canvas_y);
  // Would normally call map_pos_to_tile, for now return basic object
  return { x: r.map_x, y: r.map_y };
}
