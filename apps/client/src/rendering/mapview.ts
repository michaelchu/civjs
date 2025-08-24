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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const $: any; // jQuery
declare const tileset_image_count: number;
declare const tileset_name: string;
declare const ts: number;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const tileset: any;
declare const renderer: number;
declare const RENDERER_WEBGL: number;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const swal: any;

// Functions referenced by sprite loading functions
declare function get_tileset_file_extention(): string;
declare function webgl_preload(): void;

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
 * Initialize sprites and load tileset images
 * Ported from mapview.js init_sprites()
 */
export function init_sprites(): void {
  $.blockUI({
    message:
      '<h1>Freeciv-web is loading. Please wait...' +
      "<br><center><img src='/images/loading.gif'></center></h1>",
  });

  if (loaded_images != tileset_image_count) {
    for (let i = 0; i < tileset_image_count; i++) {
      const tileset_image = new Image();
      tileset_image.onload = preload_check;
      tileset_image.src =
        '/tileset/freeciv-web-tileset-' +
        tileset_name +
        '-' +
        i +
        get_tileset_file_extention() +
        '?ts=' +
        ts;
      tileset_images[i] = tileset_image;
    }
  } else {
    // already loaded
    if (renderer == RENDERER_WEBGL) {
      webgl_preload();
    } else {
      $.unblockUI();
    }
  }
}

/**
 * Determines when the whole tileset has been preloaded
 * Ported from mapview.js preload_check()
 */
function preload_check(): void {
  loaded_images += 1;

  if (loaded_images == tileset_image_count) {
    init_cache_sprites();
    if (renderer == RENDERER_WEBGL) {
      webgl_preload();
    } else {
      $.unblockUI();
    }
  }
}

/**
 * Cache sprites by cropping them from tileset sheets
 * Ported from mapview.js init_cache_sprites()
 */
function init_cache_sprites(): void {
  try {
    if (typeof tileset === 'undefined') {
      swal(
        'Tileset not generated correctly. Run sync.sh in ' +
          'freeciv-img-extract and recompile.'
      );
      return;
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

// TODO: Port remaining ~25 functions from original mapview.js including:
// - mapview_put_city_bar
// - mapview_put_tile_label
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
