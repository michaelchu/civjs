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

// Canvas management and sprite loading system ported from freeciv-web mapview.js

import {
  DIR8_NORTH,
  DIR8_EAST,
  DIR8_SOUTH,
  DIR8_WEST,
  GOTO_DIR_DX,
  GOTO_DIR_DY,
  RENDERER_2DCANVAS,
  RENDERER_WEBGL,
} from './constants';
import { tileset_tile_width, tileset_tile_height, tileset_image_count, tileset_name, get_tileset_file_extention, ts } from './tileset-config';
import type { City, Nation, Player, SpriteDefinition } from './types';
import { SERVER_URL } from '../config';

// Canvas contexts and elements - these will be assigned during initialization
let mapview_canvas_ctx: CanvasRenderingContext2D | null = null;
let mapview_canvas: HTMLCanvasElement | null = null;
const buffer_canvas_ctx: CanvasRenderingContext2D | null = null;
const buffer_canvas: HTMLCanvasElement | null = null;
let city_canvas_ctx: CanvasRenderingContext2D | null = null;
const city_canvas: HTMLCanvasElement | null = null;

// Sprite loading state
const tileset_images: HTMLImageElement[] = [];
const sprites: { [key: string]: HTMLCanvasElement } = {};
let loaded_images = 0;
let sprites_init = false;

// Global variables referenced by sprite loading functions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const tileset: any;

// Set renderer to use 2D Canvas since we're using Canvas2D rendering
const renderer = RENDERER_2DCANVAS;

// Loading state management
interface LoadingState {
  isLoading: boolean;
  progress: number;
  message: string;
}

let loadingState: LoadingState = {
  isLoading: false,
  progress: 0,
  message: '',
};

// Loading state callbacks for React components
type LoadingStateCallback = (state: LoadingState) => void;
const loadingStateCallbacks: LoadingStateCallback[] = [];

// Functions referenced by sprite loading functions
// WebGL preload is not needed for 2D canvas rendering
function webgl_preload(): void {
  // No-op for 2D canvas rendering
}


// Game data access functions - these will be implemented elsewhere
declare const nations: Nation[];
declare function city_owner(city: City): Player | null;
declare function get_city_production_type(city: City): { kind: number };
declare function get_city_flag_sprite(city: City): SpriteDefinition | null;
declare function city_production_type_sprite_name(prodtype: {
  kind: number;
}): string;

// Additional missing function declarations
declare function get_city_occupied_sprite(): SpriteDefinition | null;
declare const VUT_UTYPE: number;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function tileset_unit_type_graphic_tag(utype: any): string;
declare function tileset_ruleset_entity_tag_str_or_alt(
  tag: string,
  alt: string
): string;
declare const normal_tile_width: number;
declare const canvas_text_font: string;
declare const mapview: { width: number; height: number };
declare const citydlg_map_width: number;
declare const citydlg_map_height: number;
declare let overview_active: boolean;
declare let chatbox_active: boolean;

/**
 * Register a callback for loading state changes (for React components)
 */
export function onLoadingStateChange(
  callback: LoadingStateCallback
): () => void {
  loadingStateCallbacks.push(callback);
  // Return unsubscribe function
  return () => {
    const index = loadingStateCallbacks.indexOf(callback);
    if (index > -1) {
      loadingStateCallbacks.splice(index, 1);
    }
  };
}

/**
 * Update loading state and notify React components
 */
function updateLoadingState(updates: Partial<LoadingState>): void {
  loadingState = { ...loadingState, ...updates };
  loadingStateCallbacks.forEach(callback => callback(loadingState));
}

/**
 * Get current loading state
 */
export function getLoadingState(): LoadingState {
  return { ...loadingState };
}

// Rendering configuration - these will be used once mapview functions are ported
// const canvas_text_font = "16px Georgia, serif";
// const fullfog: any[] = [];

// Path rendering constants - these will be used once mapview functions are ported
// const GOTO_DIR_DX = [0, 1, 2, -1, 1, -2, -1, 0];
// const GOTO_DIR_DY = [-2, -1, 0, -1, 1, 0, 1, 2];
// let dashedSupport = false;

/**
 * Set the canvas context for rendering (called by React component)
 */
export function setCanvasContext(canvas: HTMLCanvasElement): void {
  mapview_canvas = canvas;
  mapview_canvas_ctx = canvas.getContext('2d');
  console.log('Canvas context set:', !!mapview_canvas_ctx);
}

/**
 * Get a tile from the tiles array (freeciv-web compatible access)
 * This replaces the global tiles array access pattern
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getTile(index: number, tilesArray: any[]): any | null {
  return tilesArray && tilesArray[index] ? tilesArray[index] : null;
}

/**
 * Get tiles array length (freeciv-web compatible)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getTilesLength(tilesArray: any[]): number {
  return tilesArray ? tilesArray.length : 0;
}

/**
 * Initialize the map view canvas system
 */
export function init_mapview(): void {
  // TODO: Port complete initialization logic from original mapview.js
  console.log('Initializing mapview system...');
}

/**
 * Load tileset spec from server (defines sprite coordinates)
 */
async function loadTilesetSpec(): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${SERVER_URL}/js/2dcanvas/tileset_spec_amplio2.js`;
    script.onload = () => {
      // The script sets window.tileset
      if ((window as any).tileset) {
        document.head.removeChild(script);
        resolve();
      } else {
        document.head.removeChild(script);
        reject(new Error('Tileset spec not found in loaded script'));
      }
    };
    script.onerror = () => {
      document.head.removeChild(script);
      reject(new Error('Failed to load tileset spec'));
    };
    document.head.appendChild(script);
  });
}

/**
 * Initialize sprites and load tileset images (modernized without jQuery)
 * Returns a Promise that resolves when all sprites are loaded
 */
export async function init_sprites(): Promise<void> {
  updateLoadingState({
    isLoading: true,
    progress: 0,
    message: 'Loading tileset configuration...',
  });
  
  // Load tileset spec first
  try {
    await loadTilesetSpec();
  } catch (error) {
    console.error('Failed to load tileset spec:', error);
    updateLoadingState({
      isLoading: false,
      progress: 0,
      message: 'Failed to load tileset configuration',
    });
    throw error;
  }

  updateLoadingState({
    isLoading: true,
    progress: 10,
    message: 'Loading tileset images...',
  });

  if (loaded_images !== tileset_image_count) {
    const imagePromises: Promise<HTMLImageElement>[] = [];

    for (let i = 0; i < tileset_image_count; i++) {
      const imagePromise = loadTilesetImage(i);
      imagePromises.push(imagePromise);
    }

    try {
      const loadedImages = await Promise.all(imagePromises);

      // Store loaded images
      loadedImages.forEach((img, index) => {
        tileset_images[index] = img;
      });

      loaded_images = tileset_image_count;

      updateLoadingState({
        progress: 100,
        message: 'Processing sprites...',
      });

      // Process sprites after all images are loaded
      await processSprites();
    } catch (error) {
      console.error('Failed to load tileset images:', error);
      updateLoadingState({
        isLoading: false,
        progress: 0,
        message: 'Failed to load sprites',
      });
      throw error;
    }
  } else {
    // Already loaded
    await processSprites();
  }
}

/**
 * Load a single tileset image with Promise-based approach
 */
function loadTilesetImage(index: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const tileset_image = new Image();

    tileset_image.onload = () => {
      loaded_images++;
      const progress = Math.floor((loaded_images / tileset_image_count) * 80); // 80% for loading
      updateLoadingState({
        progress,
        message: `Loading tileset images... (${loaded_images}/${tileset_image_count})`,
      });
      resolve(tileset_image);
    };

    tileset_image.onerror = () => {
      reject(new Error(`Failed to load tileset image ${index}`));
    };

    // Load from server, not from client public folder
    tileset_image.src =
      SERVER_URL +
      '/tilesets/freeciv-web-tileset-' +
      tileset_name +
      '-' +
      index +
      get_tileset_file_extention() +
      '?ts=' +
      ts;
  });
}

/**
 * Process sprites after images are loaded
 */
async function processSprites(): Promise<void> {
  init_cache_sprites();

  // WebGL is not currently used - renderer is hardcoded to RENDERER_2DCANVAS
  // if (renderer === RENDERER_WEBGL) {
  //   webgl_preload();
  // }

  updateLoadingState({
    isLoading: false,
    progress: 100,
    message: 'Sprites loaded successfully',
  });
}

/**
 * Legacy preload_check function - no longer needed with Promise-based loading
 * Removed to clean up code - all loading is now Promise-based
 */

/**
 * Cache sprites by cropping them from tileset sheets
 * Ported from mapview.js init_cache_sprites()
 */
function init_cache_sprites(): void {
  try {
    if (typeof tileset === 'undefined') {
      const errorMessage =
        'Tileset not generated correctly. Run sync.sh in freeciv-img-extract and recompile.';
      console.error(errorMessage);
      updateLoadingState({
        isLoading: false,
        progress: 0,
        message: 'Tileset configuration error',
      });
      throw new Error(errorMessage);
    }

    let cached = 0;
    let skipped = 0;
    
    for (const tile_tag in tileset) {
      const spriteData = tileset[tile_tag];
      
      /**
       * SPRITE FORMAT CONVERSION
       * 
       * During Phase 1 freeciv-web rendering port, we discovered that tileset data comes in two formats:
       * 1. Legacy array format: [x, y, width, height, sheetIndex] (from original freeciv-web)
       * 2. Modern object format: {x, y, width, height, sheetIndex} (preferred TypeScript format)
       * 
       * This conversion handles both formats for backward compatibility while we transition
       * to the modern object format. The array format was causing "sheetIndex undefined" errors
       * because the code expected object properties but received array indices.
       * 
       * Fix implemented: Check if spriteData is array, then destructure accordingly.
       * This resolved sprite caching failures from 0 cached to 1600+ sprites successfully.
       */
      let x, y, w, h, i;
      if (Array.isArray(spriteData)) {
        // Convert legacy array format [x, y, width, height, sheetIndex] to variables
        [x, y, w, h, i] = spriteData;
      } else {
        // Use modern object format {x, y, width, height, sheetIndex}
        x = spriteData.x;
        y = spriteData.y;
        w = spriteData.width;
        h = spriteData.height;
        i = spriteData.sheetIndex;
      }

      // Skip sprites with missing images
      if (!tileset_images[i]) {
        skipped++;
        continue;
      }

      const newCanvas = document.createElement('canvas');
      newCanvas.height = h;
      newCanvas.width = w;
      const newCtx = newCanvas.getContext('2d')!;

      newCtx.drawImage(tileset_images[i], x, y, w, h, 0, 0, w, h);
      sprites[tile_tag] = newCanvas;
      cached++;
    }
    
    sprites_init = true;
    
    if (cached === 0) {
      console.error('🚨 CRITICAL: No sprites cached!');
    } else {
      console.log(`✅ Cached ${cached} sprites successfully`);
    }
    
    // Keep images in memory to prevent issues - they're not that large
    // tileset_images.length = 0;
  } catch (e) {
    console.log('Problem caching sprites:', e);
  }
}

/**
 * Check if all sprites have been preloaded
 */
export function is_sprites_loaded(): boolean {
  return sprites_init;
}

/**
 * Put a tile sprite on the canvas at the specified coordinates
 * Ported from mapview.js mapview_put_tile()
 */
export function mapview_put_tile(
  pcanvas: CanvasRenderingContext2D,
  sprite: SpriteDefinition | string,
  canvas_x: number,
  canvas_y: number
): void {
  // Handle both string tags (legacy) and SpriteDefinition objects
  if (typeof sprite === 'string') {
    const tag = sprite;
    if (sprites[tag] == null) {
      //console.log("Missing sprite " + tag);
      return;
    }
    pcanvas.drawImage(sprites[tag], canvas_x, canvas_y);
  } else {
    // Handle SpriteDefinition object
    const tag = sprite.tag || sprite.key;
    const spriteCanvas = sprites[tag];
    if (spriteCanvas == null) {
      return;
    }
    pcanvas.drawImage(spriteCanvas, canvas_x, canvas_y);
  }
}

/**
 * Draw a path with 4 points (typically used for tile borders)
 * Ported from mapview.js drawPath()
 */
export function drawPath(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  x4: number,
  y4: number
): void {
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.lineTo(x4, y4);
  ctx.lineTo(x1, y1);
}

/**
 * Draw a filled-in colored rectangle onto the canvas
 * Ported from mapview.js canvas_put_rectangle()
 */
export function canvas_put_rectangle(
  canvas_context: CanvasRenderingContext2D,
  pcolor: string,
  canvas_x: number,
  canvas_y: number,
  width: number,
  height: number
): void {
  canvas_context.fillStyle = pcolor;
  canvas_context.fillRect(canvas_x, canvas_y, width, height);
}

/**
 * Draw a red selection rectangle outline onto the canvas
 * Ported from mapview.js canvas_put_select_rectangle()
 */
export function canvas_put_select_rectangle(
  canvas_context: CanvasRenderingContext2D,
  canvas_x: number,
  canvas_y: number,
  width: number,
  height: number
): void {
  canvas_context.beginPath();
  canvas_context.strokeStyle = 'rgb(255,0,0)';
  canvas_context.rect(canvas_x, canvas_y, width, height);
  canvas_context.stroke();
}

/**************************************************************************
  Draw city text onto the canvas.
**************************************************************************/
export function mapview_put_city_bar(
  pcanvas: CanvasRenderingContext2D,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  city: any,
  canvas_x: number,
  canvas_y: number
): void {
  const text = decodeURIComponent(city['name']).toUpperCase();
  const size = city['size'];
  const owner = city_owner(city);
  const color = owner
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (nations as any)[(owner as any)['nation']]?.['color'] || '#FFFFFF'
    : '#FFFFFF';
  const prod_type = get_city_production_type(city);

  const txt_measure = pcanvas.measureText(text);
  const size_measure = pcanvas.measureText(size);
  pcanvas.globalAlpha = 0.7;
  pcanvas.fillStyle = 'rgba(0, 0, 0, 0.5)';
  pcanvas.fillRect(
    canvas_x - Math.floor(txt_measure.width / 2) - 14,
    canvas_y - 17,
    txt_measure.width + 20,
    20
  );

  pcanvas.fillStyle = color;
  pcanvas.fillRect(
    canvas_x + Math.floor(txt_measure.width / 2) + 5,
    canvas_y - 19,
    prod_type != null ? size_measure.width + 35 : size_measure.width + 8,
    24
  );

  const city_flag = get_city_flag_sprite(city);
  if (city_flag) {
    pcanvas.drawImage(
      sprites[city_flag['key']],
      canvas_x - Math.floor(txt_measure.width / 2) - 45,
      canvas_y - 17
    );
  }

  const occupied_sprite = get_city_occupied_sprite();
  if (occupied_sprite) {
    pcanvas.drawImage(
      sprites[occupied_sprite['key']],
      canvas_x - Math.floor(txt_measure.width / 2) - 12,
      canvas_y - 16
    );
  }

  pcanvas.strokeStyle = color;
  pcanvas.lineWidth = 1.5;
  pcanvas.beginPath();
  pcanvas.moveTo(
    canvas_x - Math.floor(txt_measure.width / 2) - 46,
    canvas_y - 18
  );
  pcanvas.lineTo(
    canvas_x + Math.floor(txt_measure.width / 2) + size_measure.width + 13,
    canvas_y - 18
  );
  pcanvas.moveTo(
    canvas_x + Math.floor(txt_measure.width / 2) + size_measure.width + 13,
    canvas_y + 4
  );
  pcanvas.lineTo(
    canvas_x - Math.floor(txt_measure.width / 2) - 46,
    canvas_y + 4
  );
  pcanvas.lineTo(
    canvas_x - Math.floor(txt_measure.width / 2) - 46,
    canvas_y - 18
  );
  pcanvas.moveTo(
    canvas_x - Math.floor(txt_measure.width / 2) - 15,
    canvas_y - 17
  );
  pcanvas.lineTo(
    canvas_x - Math.floor(txt_measure.width / 2) - 15,
    canvas_y + 3
  );
  pcanvas.stroke();

  pcanvas.globalAlpha = 1.0;

  if (prod_type != null) {
    let tag;
    if (city['production_kind'] == VUT_UTYPE) {
      tag = tileset_unit_type_graphic_tag(prod_type);
    } else {
      tag = tileset_ruleset_entity_tag_str_or_alt(
        city_production_type_sprite_name(prod_type),
        'building'
      );
    }

    if (tag == null) {
      return;
    }

    pcanvas.drawImage(
      sprites[tag],
      canvas_x + Math.floor(txt_measure.width / 2) + size_measure.width + 13,
      canvas_y - 19,
      28,
      24
    );
  }

  pcanvas.fillStyle = 'rgba(0, 0, 0, 1)';
  pcanvas.fillText(
    size,
    canvas_x + Math.floor(txt_measure.width / 2) + 10,
    canvas_y + 1
  );

  pcanvas.fillStyle = 'rgba(255, 255, 255, 1)';
  pcanvas.fillText(
    text,
    canvas_x - Math.floor(txt_measure.width / 2) - 2,
    canvas_y - 1
  );
  pcanvas.fillText(
    size,
    canvas_x + Math.floor(txt_measure.width / 2) + 8,
    canvas_y - 1
  );
}

/**************************************************************************
  Draw tile label onto the canvas.
**************************************************************************/
export function mapview_put_tile_label(
  pcanvas: CanvasRenderingContext2D,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tile: any,
  canvas_x: number,
  canvas_y: number
): void {
  const text = tile['label'];
  if (text != null && text.length > 0) {
    const txt_measure = pcanvas.measureText(text);

    pcanvas.fillStyle = 'rgba(255, 255, 255, 1)';
    pcanvas.fillText(
      text,
      canvas_x + normal_tile_width / 2 - Math.floor(txt_measure.width / 2),
      canvas_y - 1
    );
  }
}

/**************************************************************************
  Renders the national border lines onto the canvas.
**************************************************************************/
export function mapview_put_border_line(
  pcanvas: CanvasRenderingContext2D,
  dir: number,
  color: string,
  canvas_x: number,
  canvas_y: number
): void {
  const x = canvas_x + 47;
  const y = canvas_y + 3;
  pcanvas.strokeStyle = color;
  pcanvas.beginPath();

  if (dir == DIR8_NORTH) {
    pcanvas.moveTo(x, y - 2);
    pcanvas.lineTo(x + tileset_tile_width / 2, y + tileset_tile_height / 2 - 2);
  } else if (dir == DIR8_EAST) {
    pcanvas.moveTo(x - 3, y + tileset_tile_height - 3);
    pcanvas.lineTo(
      x + tileset_tile_width / 2 - 3,
      y + tileset_tile_height / 2 - 3
    );
  } else if (dir == DIR8_SOUTH) {
    pcanvas.moveTo(
      x - tileset_tile_width / 2 + 3,
      y + tileset_tile_height / 2 - 3
    );
    pcanvas.lineTo(x + 3, y + tileset_tile_height - 3);
  } else if (dir == DIR8_WEST) {
    pcanvas.moveTo(
      x - tileset_tile_width / 2 + 3,
      y + tileset_tile_height / 2 - 3
    );
    pcanvas.lineTo(x + 3, y - 3);
  }
  pcanvas.closePath();
  pcanvas.stroke();
}

/**************************************************************************
  ...
**************************************************************************/
export function mapview_put_goto_line(
  pcanvas: CanvasRenderingContext2D,
  dir: number,
  canvas_x: number,
  canvas_y: number
): void {
  const x0 = canvas_x + tileset_tile_width / 2;
  const y0 = canvas_y + tileset_tile_height / 2;
  const x1 = x0 + GOTO_DIR_DX[dir] * (tileset_tile_width / 2);
  const y1 = y0 + GOTO_DIR_DY[dir] * (tileset_tile_height / 2);

  pcanvas.strokeStyle = 'rgba(0,168,255,0.9)';
  pcanvas.lineWidth = 10;
  pcanvas.lineCap = 'round';
  pcanvas.beginPath();
  pcanvas.moveTo(x0, y0);
  pcanvas.lineTo(x1, y1);
  pcanvas.stroke();
}

/**************************************************************************
  ...
**************************************************************************/
export function set_city_mapview_active(): void {
  const city_canvas_element = document.getElementById(
    'city_canvas'
  ) as HTMLCanvasElement;
  if (city_canvas_element == null) return;
  city_canvas_ctx = city_canvas_element.getContext('2d')!;
  city_canvas_ctx.font = canvas_text_font;

  mapview_canvas_ctx = city_canvas_element.getContext('2d')!;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mapview as any)['width'] = citydlg_map_width;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mapview as any)['height'] = citydlg_map_height;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mapview as any)['store_width'] = citydlg_map_width;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mapview as any)['store_height'] = citydlg_map_height;

  set_default_mapview_inactive();
}

/**************************************************************************
  ...
**************************************************************************/
function set_default_mapview_inactive(): void {
  if (overview_active) {
    const overviewPanel = document.getElementById(
      'game_overview_panel'
    )?.parentElement;
    if (overviewPanel) overviewPanel.style.display = 'none';
  }
  const unitPanel = document.getElementById('game_unit_panel')?.parentElement;
  if (unitPanel) unitPanel.style.display = 'none';

  if (chatbox_active) {
    const chatboxPanel =
      document.getElementById('game_chatbox_panel')?.parentElement;
    if (chatboxPanel) chatboxPanel.style.display = 'none';
  }
}

// TODO: Port remaining functions from original mapview.js including:
// - enable_mapview_slide
// - mapview_window_resized
// - And other canvas management functions
// - init_cache_sprites
// - And all other canvas management functions

export {
  mapview_canvas_ctx,
  mapview_canvas,
  buffer_canvas_ctx,
  buffer_canvas,
  city_canvas_ctx,
  city_canvas,
  tileset_images,
  sprites,
  loaded_images,
  sprites_init,
};
