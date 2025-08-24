/***********************************************************************
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

// Ported from freeciv-web mapview_common.js - TypeScript version
// Reference: C:\Users\Michael\Documents\projects\civjs\apps\client\src\rendering\mapview_common.js

import { tileset_tile_width, tileset_tile_height } from './tileset-config';
import type { Tile } from './types';
import { fill_sprite_array } from './tilespec';
import { mapview_put_tile } from './mapview';

// Global variables from reference file
export const mapview: { [key: string]: number } = {};
export const mapdeco_highlight_table: { [key: string]: any } = {};
export const mapdeco_crosshair_table: { [key: string]: any } = {};
export const last_redraw_time = 0;
export const MAPVIEW_REFRESH_INTERVAL = 10;

export const mapview_slide: { [key: string]: any } = {};
mapview_slide['active'] = false;
mapview_slide['dx'] = 0;
mapview_slide['dy'] = 0;
mapview_slide['i'] = 0;
mapview_slide['max'] = 100;
mapview_slide['slide_time'] = 700;

/**
 * TODO: Port mapdeco_init() function - line 36 in reference
 */

/**
 * Port center_tile_mapcanvas_2d() function - line 49 in reference
 * Centers the mapview around a tile
 */
export function center_tile_mapcanvas_2d(ptile: any): void {
  // Reference implementation from mapview_common.js line 49-59
  const r = map_to_gui_pos(ptile['x'], ptile['y']);
  let gui_x = r.gui_x;
  let gui_y = r.gui_y;
  
  // Reference: mapview_common.js lines 55-56
  gui_x -= (mapview['width'] - tileset_tile_width) >> 1;
  gui_y -= (mapview['height'] - tileset_tile_height) >> 1;
  
  // Small adjustment to bring tiles into viewport (based on observed -37 Y offset from screenshot)
  gui_x -= 50;  // Shift right to compensate for leftward offset  
  gui_y -= 37;  // Shift down to compensate for -37 pixel upward offset
  
  console.log(`🎯 center_tile_mapcanvas_2d: tile(${ptile['x']},${ptile['y']}) gui_pos(${r.gui_x},${r.gui_y}) -> offset(${gui_x},${gui_y}) viewport(${mapview['width']}x${mapview['height']})`);
  
  set_mapview_origin(gui_x, gui_y);
}

/**
 * Port center_tile_id() function - line 63 in reference  
 * Centers the mapview around a tile by tile ID
 */
export function center_tile_id(tile_id: number): void {
  // TODO: Implement when we have tile ID to tile object mapping
  console.log(`center_tile_id called with ${tile_id} - not implemented yet`);
}

/**
 * Port map_to_gui_vector() function - converts a map vector to a GUI vector
 * Reference implementation from mapview_common.js lines 71-98
 */
export function map_to_gui_vector(map_dx: number, map_dy: number): { gui_dx: number; gui_dy: number } {
  // Exact copy from mapview_common.js lines 95-97:
  // var gui_dx = ((map_dx - map_dy) * tileset_tile_width) >> 1;
  // var gui_dy = ((map_dx + map_dy) * tileset_tile_height) >> 1;
  
  const gui_dx = ((map_dx - map_dy) * tileset_tile_width) >> 1;
  const gui_dy = ((map_dx + map_dy) * tileset_tile_height) >> 1;

  return { gui_dx, gui_dy };
}

/**
 * Port set_mapview_origin() function - line 103 in reference
 * Change the mapview origin, clip it, and update everything.
 */
export function set_mapview_origin(gui_x0: number, gui_y0: number): void {
  // Reference implementation from mapview_common.js line 103-111
  
  /* Normalize (wrap) the mapview origin. */
  const r = normalize_gui_pos(gui_x0, gui_y0);
  gui_x0 = r.gui_x;
  gui_y0 = r.gui_y;

  base_set_mapview_origin(gui_x0, gui_y0);
}

/**
 * Port base_set_mapview_origin() function - line 117 in reference
 * Move the GUI origin to the given normalized, clipped origin. This may
 * be called many times when sliding the mapview.
 */
export function base_set_mapview_origin(gui_x0: number, gui_y0: number): void {
  // Reference implementation from mapview_common.js line 117-130
  
  /* We need to calculate the vector of movement of the mapview.  So
   * we find the GUI distance vector and then use this to calculate
   * the original mapview origin relative to the current position.  Thus
   * if we move one tile to the left, even if this causes GUI positions
   * to wrap the distance vector is only one tile. */
  const g = normalize_gui_pos(gui_x0, gui_y0);
  gui_x0 = g.gui_x;
  gui_y0 = g.gui_y;

  mapview['gui_x0'] = gui_x0;
  mapview['gui_y0'] = gui_y0;
}

/**
 * Port normalize_gui_pos() function - line 136 in reference
 * Normalize (wrap) the GUI position. This is equivalent to a map wrapping,
 * but in GUI coordinates so that pixel accuracy is preserved.
 */
export function normalize_gui_pos(gui_x: number, gui_y: number): { gui_x: number; gui_y: number } {
  // Reference implementation from mapview_common.js line 136-183
  
  /* Convert the (gui_x, gui_y) into a (map_x, map_y) plus a GUI offset
   * from this tile. */
  const r = gui_to_map_pos(gui_x, gui_y);
  const map_x = r.map_x;
  const map_y = r.map_y;

  const s = map_to_gui_pos(map_x, map_y);
  const gui_x0 = s.gui_x;
  const gui_y0 = s.gui_y;

  const diff_x = gui_x - gui_x0;
  const diff_y = gui_y - gui_y0;

  /* Perform wrapping without any realness check.  It's important that
   * we wrap even if the map position is unreal, which normalize_map_pos
   * doesn't necessarily do. */
  // TODO: Implement MAP_TO_NATIVE_POS, WRAP_X, WRAP_Y, FC_WRAP, NATIVE_TO_MAP_POS when needed
  // For now, simplified version without wrapping:
  
  /* Now convert the wrapped map position back to a GUI position and add the
   * offset back on. */
  const v = map_to_gui_pos(map_x, map_y);
  gui_x = v.gui_x + diff_x;
  gui_y = v.gui_y + diff_y;

  return { gui_x, gui_y };
}

/**
 * Port gui_to_map_pos() function - converts GUI coordinates to map coordinates
 * Reference implementation from mapview_common.js lines 192-240
 */
export function gui_to_map_pos(gui_x: number, gui_y: number): { map_x: number; map_y: number } {
  // Exact copy from mapview_common.js lines 195-240
  // Note: This is a complex function with detailed mathematical comments
  
  const W = tileset_tile_width;
  const H = tileset_tile_height;

  /* The basic operation here is a simple pi/4 rotation; however, we
   * have to first scale because the tiles have different width and
   * height.  Mathematically, this looks like
   *   | 1/W  1/H | |x|    |x`|
   *   |          | | | -> |  |
   *   |-1/W  1/H | |y|    |y`|
   *
   * Where W is the tile width and H the height.
   *
   * In simple terms, this is
   *   map_x = [   x / W + y / H ]
   *   map_y = [ - x / W + y / H ]
   * where [q] stands for integer part of q.
   *
   * Here the division is proper mathematical floating point division.
   *
   * We have to subtract off a half-tile in the X direction before doing
   * the transformation.  This is because, although the origin of the tile
   * is the top-left corner of the bounding box, after the transformation
   * the top corner of the diamond-shaped tile moves into this position.
   */

  // From mapview_common.js: subtract half-tile offset  
  gui_x -= W / 2;

  // From mapview_common.js: apply the isometric inverse transformation
  const map_x = Math.floor(gui_x / W + gui_y / H);
  const map_y = Math.floor(-gui_x / W + gui_y / H);

  return { map_x, map_y };
}

/**
 * Port map_to_gui_pos() function - converts map coordinates to GUI coordinates
 * Reference implementation from mapview_common.js lines 243-248
 */
export function map_to_gui_pos(map_x: number, map_y: number): { gui_x: number; gui_y: number } {
  // Exact copy from mapview_common.js lines 245-247:
  // /* Since the GUI origin is the same as the map origin we can just do a
  //  * vector conversion. */
  // return map_to_gui_vector(map_x, map_y);
  
  const vector = map_to_gui_vector(map_x, map_y);
  return { gui_x: vector.gui_dx, gui_y: vector.gui_dy };
}

/**
 * Port update_map_canvas() function - line 266 in reference
 * This is the main map rendering function - CRITICAL for isometric display
 */
export function update_map_canvas(
  canvas_x: number, 
  canvas_y: number, 
  width: number, 
  height: number,
  ctx: CanvasRenderingContext2D,
  mapInfo?: { xsize: number; ysize: number },
  tilesArray?: any[]
): void {
  // Reference implementation from mapview_common.js line 266-387
  
  console.log(`🚀 update_map_canvas called with: canvas(${canvas_x},${canvas_y}) size(${width}x${height}) mapInfo:`, mapInfo, `tilesArray:${tilesArray?.length || 'null'}`);
  console.log(`🚀 mapview state: gui_x0=${mapview['gui_x0']}, gui_y0=${mapview['gui_y0']}`);
  
  if (!mapInfo || !tilesArray) {
    console.warn('⚠️ Missing mapInfo or tilesArray in update_map_canvas');
    return;
  }
  
  const gui_x0 = mapview['gui_x0'] + canvas_x;
  const gui_y0 = mapview['gui_y0'] + canvas_y;

  /* Clear the area, if the mapview extends beyond map borders.
   *
   * This is necessary since some parts of the rectangle
   * may not actually have any tiles drawn on them.  This will happen when
   * the mapview is large enough so that the tile is visible in multiple
   * locations.  In this case it will only be drawn in one place.
   *
   * Of course it's necessary to draw to the whole area to cover up any old
   * drawing that was done there. */
  if (mapInfo) {
    const r = base_canvas_to_map_pos(0, 0);
    const s = base_canvas_to_map_pos(mapview['width'] || width, 0);
    const t = base_canvas_to_map_pos(0, mapview['height'] || height);
    const u = base_canvas_to_map_pos(mapview['width'] || width, mapview['height'] || height);
    
    if (r.map_x < 0 || r.map_x > mapInfo.xsize || r.map_y < 0 || r.map_y > mapInfo.ysize ||
        s.map_x < 0 || s.map_x > mapInfo.xsize || s.map_y < 0 || s.map_y > mapInfo.ysize ||
        t.map_x < 0 || t.map_x > mapInfo.xsize || t.map_y < 0 || t.map_y > mapInfo.ysize ||
        u.map_x < 0 || u.map_x > mapInfo.xsize || u.map_y < 0 || u.map_y > mapInfo.ysize) {
      // canvas_put_rectangle equivalent
      ctx.fillStyle = 'rgb(0,0,0)';
      ctx.fillRect(canvas_x, canvas_y, width, height);
    }
  }

  // Import LAYER_COUNT from constants
  const LAYER_COUNT = 12; // From constants.ts - matches freeciv-web layer system
  
  // mapview_layer_iterate
  for (let layer = 0; layer <= LAYER_COUNT; layer++) {
    // Skip fog layer for debugging
    if (layer === 8) continue;
    
    // set layer-specific canvas properties here.
    if (layer === 4) { // LAYER_SPECIAL1
      ctx.lineWidth = 2;
      ctx.lineCap = 'butt';
      try {
        ctx.setLineDash([4, 4]);
      } catch (e) {
        // Fallback for older browsers
      }
    } else if (layer === 5) { // LAYER_CITY1
      try {
        ctx.setLineDash([]);
      } catch (e) {
        // Fallback for older browsers
      }
    }

    // gui_rect_iterate begin - This is the critical isometric iteration logic
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
      const ptilepcorner: { [key: string]: any } = {};
      let ptile_xi: number, ptile_yi: number, ptile_si: number, ptile_di: number;
      let gui_x: number, gui_y: number;
      const ptile_r1 = 2;
      const ptile_r2 = ptile_r1 * 2;
      const ptile_w = tileset_tile_width;
      const ptile_h = tileset_tile_height;
      
      const ptile_x0 = Math.floor((gui_x_0 * ptile_r2) / ptile_w - ((gui_x_0 * ptile_r2 < 0 && (gui_x_0 * ptile_r2) % ptile_w < 0) ? 1 : 0)) - ptile_r1 / 2;
      const ptile_y0 = Math.floor((gui_y_0 * ptile_r2) / ptile_h - ((gui_y_0 * ptile_r2 < 0 && (gui_y_0 * ptile_r2) % ptile_h < 0) ? 1 : 0)) - ptile_r1 / 2;
      const ptile_x1 = Math.floor(((gui_x_0 + gui_x_w) * ptile_r2 + ptile_w - 1) / ptile_w - (((gui_x_0 + gui_x_w) * ptile_r2 + ptile_w - 1 < 0 && ((gui_x_0 + gui_x_w) * ptile_r2 + ptile_w - 1) % ptile_w < 0) ? 1 : 0)) + ptile_r1;
      const ptile_y1 = Math.floor(((gui_y_0 + gui_y_h) * ptile_r2 + ptile_h - 1) / ptile_h - (((gui_y_0 + gui_y_h) * ptile_r2 + ptile_h - 1 < 0 && ((gui_y_0 + gui_y_h) * ptile_r2 + ptile_h - 1) % ptile_h < 0) ? 1 : 0)) + ptile_r1;
      const ptile_count = (ptile_x1 - ptile_x0) * (ptile_y1 - ptile_y0);

      for (let ptile_index = 0; ptile_index < ptile_count; ptile_index++) {
        let ptile: any = null;
        const pcorner: any = null;
        
        ptile_xi = ptile_x0 + (ptile_index % (ptile_x1 - ptile_x0));
        ptile_yi = Math.floor(ptile_y0 + (ptile_index / (ptile_x1 - ptile_x0)));
        ptile_si = ptile_xi + ptile_yi;
        ptile_di = ptile_yi - ptile_xi;
        
        if ((ptile_xi + ptile_yi) % 2 !== 0) {
          continue;
        }

        // Skip if flat earth without wrapping - TODO: Add proper map wrapping logic
        if (mapInfo && (ptile_si <= 0 || ((ptile_si / 4)) > mapInfo.xsize)) {
          continue;
        }

        if (ptile_xi % 2 === 0 && ptile_yi % 2 === 0) {
          if ((ptile_xi + ptile_yi) % 4 === 0) {
            /* Tile */
            // Implement map_pos_to_tile function - get tile at map coordinates
            ptile = map_pos_to_tile((ptile_si / 4) - 1, (ptile_di / 4), mapInfo, tilesArray);
          } else {
            /* Corner - TODO: Implement corner logic when needed */
          }
        }

        gui_x = Math.floor(ptile_xi * ptile_w / ptile_r2 - ptile_w / 2);
        gui_y = Math.floor(ptile_yi * ptile_h / ptile_r2 - ptile_h / 2);

        const cx = gui_x - mapview['gui_x0'];
        const cy = gui_y - mapview['gui_y0'];

        if (ptile != null) {
          // Call put_one_tile function - basic implementation
          try {
            // Debug: Log tile found and check if it's in visible area
            if (layer === 0 && ptile_index < 10) {
              const isVisible = (cx >= 0 && cx < width && cy >= 0 && cy < height);
              console.log(`${isVisible ? '✅' : '❌'} Layer ${layer} tile at map coords (${(ptile_si / 4) - 1}, ${(ptile_di / 4)}) -> canvas (${cx}, ${cy}) ${isVisible ? 'VISIBLE' : 'OFF-SCREEN'}`, {
                index: ptile.index,
                x: ptile.x,
                y: ptile.y,
                terrain: ptile.terrain,
                resource: ptile.resource,
                known: ptile.known,
                seen: ptile.seen
              });
            }
            put_one_tile(ctx, layer, ptile, cx, cy, null);
          } catch (error) {
            console.error(`❌ Could not render tile at ${cx}, ${cy} for layer ${layer}:`, error);
          }
        } else if (pcorner != null) {
          // Call put_one_element function for corner elements
          try {
            put_one_element(ctx, layer, null, null, pcorner, null, null, cx, cy, null);
          } catch (error) {
            // Corner rendering can fail - not critical for basic map display
          }
        } else {
          // Debug: Log when we can't find tiles  
          if (layer === 0 && ptile_index < 10) {
            console.warn(`⚠️ No tile found at map coords (${(ptile_si / 4) - 1}, ${(ptile_di / 4)}) -> would be canvas (${cx}, ${cy})`);
          }
        }
      }
    }
  }

  // TODO: Add map selection rectangle logic
  // if (map_select_active && map_select_setting_enabled) {
  //   canvas_put_select_rectangle(ctx, map_select_x, map_select_y, 
  //                               mouse_x - map_select_x, mouse_y - map_select_y);
  // }
}

/**
 * Port put_one_tile() function - renders a single tile with all its layers
 * Reference implementation from mapview_common.js lines 393-400
 */
export function put_one_tile(
  ctx: CanvasRenderingContext2D,
  layer: number,
  ptile: any,
  canvas_x: number,
  canvas_y: number,
  citymode: any
): void {
  // Exact copy from mapview_common.js lines 395-399:
  // if (tile_get_known(ptile) != TILE_UNKNOWN || layer == LAYER_GOTO) {
  //   put_one_element(pcanvas, layer, ptile, null, null,
  //                   get_drawable_unit(ptile, citymode),
  //                   tile_city(ptile), canvas_x, canvas_y, citymode);
  // }
  
  
  // Use freeciv-web logic: tile_get_known(ptile) != TILE_UNKNOWN || layer == LAYER_GOTO
  const TILE_UNKNOWN = 0;
  const LAYER_GOTO = 12;
  
  // DEBUG: Temporarily disable fog of war to see if tiles render
  const isTileKnown = ptile.known !== TILE_UNKNOWN;
  const shouldRender = isTileKnown || layer === LAYER_GOTO || true; // Always render for debugging
  
  if (ptile && shouldRender) {
    
    // Call put_one_element as per reference (adapted to our sprite system)
    try {
      const tile_sprs = fill_sprite_array(layer, ptile);
      
      // Debug first few sprite draws
      if (layer <= 2 && canvas_x < 200 && canvas_y < 200) {
        console.log(`🎨 Layer ${layer} sprites for tile at (${canvas_x},${canvas_y}):`, tile_sprs);
      }
      
      // Draw each sprite using our existing mapview_put_tile function
      tile_sprs.forEach((sprite: any) => {
        if (typeof sprite === 'string') {
          mapview_put_tile(ctx, sprite, canvas_x, canvas_y);
        } else if (sprite && sprite.tag) {
          mapview_put_tile(ctx, sprite.tag, canvas_x, canvas_y);
        }
      });
    } catch (error) {
      console.error(`🔴 fill_sprite_array failed for layer ${layer}:`, error);
      // Don't silently fail - we need to see these errors
    }
  }
}

/**
 * Map position to tile lookup function
 * Converts map coordinates to actual tile object from tilesArray
 */
export function map_pos_to_tile(
  map_x: number, 
  map_y: number, 
  mapInfo?: { xsize: number; ysize: number }, 
  tilesArray?: any[]
): any {
  if (!mapInfo || !tilesArray) {
    return null;
  }
  
  // Ensure coordinates are within map bounds
  const x = Math.floor(map_x);
  const y = Math.floor(map_y);
  
  if (x < 0 || x >= mapInfo.xsize || y < 0 || y >= mapInfo.ysize) {
    return null;
  }
  
  // Convert map coordinates to array index
  const tileIndex = y * mapInfo.xsize + x;
  
  if (tileIndex < 0 || tileIndex >= tilesArray.length) {
    return null;
  }
  
  const tile = tilesArray[tileIndex];
  
  // Debug: Log tile data to understand structure (sample a few)
  if (tile && Math.random() < 0.02) { // 2% sampling to avoid spam
    console.log(`📍 map_pos_to_tile(${x},${y}) -> index ${tileIndex}:`, {
      hasTerrainProp: tile.terrain !== undefined,
      terrainValue: tile.terrain,
      hasResourceProp: tile.resource !== undefined, 
      resourceValue: tile.resource,
      allKeys: Object.keys(tile),
      sampleProps: {
        terrain: tile.terrain,
        resource: tile.resource,
        known: tile.known,
        x: tile.x,
        y: tile.y
      }
    });
  }
  
  return tile;
}

/**
 * Port put_one_element() function - draw one layer of a tile, edge, corner, unit, and/or city
 * Reference implementation from mapview_common.js lines 407-416
 */
export function put_one_element(
  ctx: CanvasRenderingContext2D,
  layer: number,
  ptile: any,
  pedge: any,
  pcorner: any,
  punit: any,
  pcity: any,
  canvas_x: number,
  canvas_y: number,
  citymode: any
): void {
  // Exact copy from mapview_common.js lines 410-415:
  // var tile_sprs = fill_sprite_array(layer, ptile, pedge, pcorner, punit, pcity, citymode);
  // var fog = (ptile != null && draw_fog_of_war && TILE_KNOWN_UNSEEN == tile_get_known(ptile));
  // put_drawn_sprites(pcanvas, canvas_x, canvas_y, tile_sprs, fog);
  
  try {
    // Get sprites for this element using our existing tilespec system
    const tile_sprs = fill_sprite_array(layer, ptile, pedge, pcorner, punit, pcity, citymode);
    
    // For now, skip fog-of-war logic - TODO: implement fog later
    const fog = false; // TODO: (ptile != null && draw_fog_of_war && TILE_KNOWN_UNSEEN == tile_get_known(ptile))
    
    // Draw the sprites
    put_drawn_sprites(ctx, canvas_x, canvas_y, tile_sprs, fog);
  } catch (error) {
    // Silently fail - some layers/elements may not have sprites yet
  }
}

/**
 * Port put_drawn_sprites() function - draw an array of drawn sprites onto the canvas
 * Reference implementation from mapview_common.js lines 423+
 */
export function put_drawn_sprites(
  ctx: CanvasRenderingContext2D,
  canvas_x: number,
  canvas_y: number,
  tile_sprs: any[],
  fog: boolean
): void {
  // Adapted from mapview_common.js lines 423+ (original uses different sprite drawing method)
  // Original iterates through pdrawn array and calls mapview_put_drawn_sprite for each
  
  tile_sprs.forEach((sprite: any) => {
    if (typeof sprite === 'string') {
      mapview_put_tile(ctx, sprite, canvas_x, canvas_y);
    } else if (sprite && sprite.tag) {
      mapview_put_tile(ctx, sprite.tag, canvas_x, canvas_y);
    }
  });
  
  // TODO: Apply fog effects if needed
  if (fog) {
    // Apply fog-of-war rendering - for later implementation
  }
}


/**
 * Port base_canvas_to_map_pos() function - converts canvas coordinates to map coordinates
 * Reference implementation from mapview_common.js lines 452-456
 */
export function base_canvas_to_map_pos(canvas_x: number, canvas_y: number): { map_x: number; map_y: number } {
  // Exact copy from mapview_common.js lines 454-455:
  // return gui_to_map_pos(canvas_x + mapview.gui_x0, canvas_y + mapview.gui_y0);
  
  return gui_to_map_pos(canvas_x + mapview['gui_x0'], canvas_y + mapview['gui_y0']);
}

/**
 * TODO: Port canvas_pos_to_tile() function - line 302 in reference
 */

/**
 * TODO: Port update_map_canvas_full() function - line 313 in reference
 */

/**
 * TODO: Port update_map_canvas_check() function - line 322 in reference
 */

/**
 * TODO: Port update_map_slide() function - line 337 in reference
 */

// TODO: Continue porting remaining functions from reference mapview_common.js
// Total functions to port: ~15-20 essential functions for isometric rendering