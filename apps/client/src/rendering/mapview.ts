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

// Canvas contexts and elements - these will be assigned during initialization
// eslint-disable-next-line prefer-const
let mapview_canvas_ctx: CanvasRenderingContext2D | null = null;
// eslint-disable-next-line prefer-const
let mapview_canvas: HTMLCanvasElement | null = null;
// eslint-disable-next-line prefer-const
let buffer_canvas_ctx: CanvasRenderingContext2D | null = null;
// eslint-disable-next-line prefer-const
let buffer_canvas: HTMLCanvasElement | null = null;
// eslint-disable-next-line prefer-const
let city_canvas_ctx: CanvasRenderingContext2D | null = null;
// eslint-disable-next-line prefer-const
let city_canvas: HTMLCanvasElement | null = null;

// Sprite loading state
const tileset_images: HTMLImageElement[] = [];
const sprites: { [key: string]: HTMLCanvasElement } = {};
let loaded_images = 0;
let sprites_init = false;

// Global variables referenced by sprite loading functions
declare const tileset_image_count: number;
declare const tileset_name: string;
declare const ts: number;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const tileset: any;
declare const renderer: number;
declare const RENDERER_WEBGL: number;

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
declare function get_tileset_file_extention(): string;
declare function webgl_preload(): void;

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
 * Initialize the map view canvas system
 */
export function init_mapview(): void {
  // TODO: Port complete initialization logic from original mapview.js
  console.log('Initializing mapview system...');
}

/**
 * Initialize sprites and load tileset images (modernized without jQuery)
 * Returns a Promise that resolves when all sprites are loaded
 */
export async function init_sprites(): Promise<void> {
  updateLoadingState({
    isLoading: true,
    progress: 0,
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

    tileset_image.src =
      '/tileset/freeciv-web-tileset-' +
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

  if (renderer === RENDERER_WEBGL) {
    webgl_preload();
  }

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

    for (const tile_tag in tileset) {
      const x = tileset[tile_tag][0];
      const y = tileset[tile_tag][1];
      const w = tileset[tile_tag][2];
      const h = tileset[tile_tag][3];
      const i = tileset[tile_tag][4];

      const newCanvas = document.createElement('canvas');
      newCanvas.height = h;
      newCanvas.width = w;
      const newCtx = newCanvas.getContext('2d')!;

      newCtx.drawImage(tileset_images[i], x, y, w, h, 0, 0, w, h);
      sprites[tile_tag] = newCanvas;
    }

    sprites_init = true;
    // Clear image references to free memory
    tileset_images.length = 0;
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
  tag: string,
  canvas_x: number,
  canvas_y: number
): void {
  if (sprites[tag] == null) {
    //console.log("Missing sprite " + tag);
    return;
  }

  pcanvas.drawImage(sprites[tag], canvas_x, canvas_y);
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapview_put_city_bar(
  pcanvas: CanvasRenderingContext2D,
  city: any,
  canvas_x: number,
  canvas_y: number
): void {
  const text = decodeURIComponent(city['name']).toUpperCase();
  const size = city['size'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const color = (nations as any)[city_owner(city)['nation']]['color'];
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
  pcanvas.drawImage(
    sprites[city_flag['key']],
    canvas_x - Math.floor(txt_measure.width / 2) - 45,
    canvas_y - 17
  );

  pcanvas.drawImage(
    sprites[get_city_occupied_sprite(city)],
    canvas_x - Math.floor(txt_measure.width / 2) - 12,
    canvas_y - 16
  );

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
      tag = tileset_ruleset_entity_tag_str_or_alt(prod_type, 'building');
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapview_put_tile_label(
  pcanvas: CanvasRenderingContext2D,
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
export function set_default_mapview_inactive(): void {
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
