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

// TypeScript conversion of Freeciv-web mapview.js

// Global canvas and context variables
export let mapview_canvas_ctx: CanvasRenderingContext2D | null = null;
export let mapview_canvas: HTMLCanvasElement | null = null;
export let buffer_canvas_ctx: CanvasRenderingContext2D | null = null;
export let buffer_canvas: HTMLCanvasElement | null = null;
export let city_canvas_ctx: CanvasRenderingContext2D | null = null;
export let city_canvas: HTMLCanvasElement | null = null;

// Setter functions for external modules
export function set_mapview_canvas(canvas: HTMLCanvasElement): void {
  mapview_canvas = canvas;
}

export function set_mapview_canvas_ctx(ctx: CanvasRenderingContext2D): void {
  mapview_canvas_ctx = ctx;
}

export function set_buffer_canvas(canvas: HTMLCanvasElement): void {
  buffer_canvas = canvas;
}

export function set_buffer_canvas_ctx(ctx: CanvasRenderingContext2D): void {
  buffer_canvas_ctx = ctx;
}

export let tileset_images: HTMLImageElement[] = [];
export let sprites: Record<string, HTMLCanvasElement> = {};
export let loaded_images = 0;

export let sprites_init = false;

export const canvas_text_font = '16px Georgia, serif';

export let fullfog: string[] = [];

export const GOTO_DIR_DX = [0, 1, 2, -1, 1, -2, -1, 0];
export const GOTO_DIR_DY = [-2, -1, 0, -1, 1, 0, 1, 2];
export let dashedSupport = false;

// External dependencies
declare let $: any; // jQuery
declare let tileset: Record<string, [number, number, number, number, number]>;
declare let tileset_name: string;
declare let tileset_image_count: number;
declare let ts: string;
declare function setup_window_size(): void;
declare function get_tileset_file_extention(): string;
declare function preload_check(): void;

/**************************************************************************
  Initialize mapview for 2D canvas
**************************************************************************/
export function init_mapview(): void {
  // Note: In React, we'll handle canvas creation differently
  // For now, this is the original logic converted to TypeScript

  console.log('Initializing 2D canvas mapview...');

  // Canvas will be created by React component, so we'll get reference differently
  // This is placeholder for the original jQuery canvas creation
}

/**************************************************************************
  This will load the tileset, blocking the UI while loading.
**************************************************************************/
export function init_sprites(): void {
  console.log('Generating procedural sprites...');

  // Since we don't have actual sprite files, generate them programmatically
  generate_procedural_sprites();
  sprites_init = true;
}

/**************************************************************************
  Generate procedural sprites instead of loading from files
**************************************************************************/
function generate_procedural_sprites(): void {
  // Generate basic terrain sprites
  const terrainTypes = [
    { name: 'ocean', color: '#006994' },
    { name: 'coast', color: '#4A90A4' },
    { name: 'grassland', color: '#7CBA3D' },
    { name: 'plains', color: '#C4A57B' },
    { name: 'desert', color: '#F2E7AE' },
    { name: 'tundra', color: '#BFBFBF' },
    { name: 'forest', color: '#228B22' },
    { name: 'hills', color: '#8B7355' },
    { name: 'mountains', color: '#8B7D6B' },
  ];

  terrainTypes.forEach(terrain => {
    // Generate multiple variations for each terrain type
    for (let i = 1; i <= 4; i++) {
      const sprite_name = `t.l0.${terrain.name}${i}`;
      const sprite_canvas = generate_terrain_sprite(
        terrain.color,
        terrain.name
      );
      sprites[sprite_name] = sprite_canvas;
    }

    // Also create base terrain sprite without number
    sprites[terrain.name] = generate_terrain_sprite(
      terrain.color,
      terrain.name
    );
  });

  console.log(`Generated ${Object.keys(sprites).length} procedural sprites`);
}

/**************************************************************************
  Generate a single terrain sprite
**************************************************************************/
function generate_terrain_sprite(
  color: string,
  terrain_name: string
): HTMLCanvasElement {
  const tileWidth = 96; // Freeciv Amplio2 tile width
  const tileHeight = 48; // Freeciv Amplio2 tile height

  const canvas = document.createElement('canvas');
  canvas.width = tileWidth;
  canvas.height = tileHeight + 16; // Extra height for overlap
  const ctx = canvas.getContext('2d');

  if (!ctx) throw new Error('Failed to create sprite context');

  // Draw isometric diamond
  ctx.save();
  ctx.translate(tileWidth / 2, 8);

  // Base terrain color
  ctx.fillStyle = color;

  // Draw diamond shape
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(tileWidth / 2, tileHeight / 2);
  ctx.lineTo(0, tileHeight);
  ctx.lineTo(-tileWidth / 2, tileHeight / 2);
  ctx.closePath();
  ctx.fill();

  // Add terrain-specific details
  add_terrain_details(ctx, terrain_name, tileWidth, tileHeight);

  // Add border for clarity
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
  return canvas;
}

/**************************************************************************
  Add terrain-specific visual details
**************************************************************************/
function add_terrain_details(
  ctx: CanvasRenderingContext2D,
  terrain: string,
  width: number,
  height: number
): void {
  ctx.save();

  switch (terrain) {
    case 'forest':
      // Add simple tree shapes
      ctx.fillStyle = 'rgba(0, 100, 0, 0.7)';
      for (let i = 0; i < 3; i++) {
        const x = (Math.random() - 0.5) * width * 0.6;
        const y = (Math.random() - 0.5) * height * 0.6;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;

    case 'mountains':
      // Add mountain peaks
      ctx.fillStyle = 'rgba(139, 125, 107, 0.8)';
      ctx.beginPath();
      ctx.moveTo(-width / 4, height / 4);
      ctx.lineTo(0, -height / 4);
      ctx.lineTo(width / 4, height / 4);
      ctx.closePath();
      ctx.fill();
      break;

    case 'hills':
      // Add hill shapes
      ctx.fillStyle = 'rgba(139, 115, 85, 0.6)';
      ctx.beginPath();
      ctx.ellipse(0, height / 4, width / 3, height / 6, 0, 0, Math.PI * 2);
      ctx.fill();
      break;

    case 'ocean':
    case 'coast':
      // Add wave patterns
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        const y = ((i - 1) * height) / 6;
        ctx.beginPath();
        ctx.moveTo(-width / 3, y);
        ctx.quadraticCurveTo(0, y - 5, width / 3, y);
        ctx.stroke();
      }
      break;

    case 'desert':
      // Add sand texture
      ctx.fillStyle = 'rgba(210, 180, 140, 0.4)';
      for (let i = 0; i < 8; i++) {
        const x = (Math.random() - 0.5) * width * 0.8;
        const y = (Math.random() - 0.5) * height * 0.8;
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
  }

  ctx.restore();
}

/**************************************************************************
  Initialize sprite cache from loaded tileset images
**************************************************************************/
export function init_cache_sprites(): void {
  try {
    if (typeof tileset === 'undefined') {
      console.error(
        'Tileset not generated correctly. Run sync.sh in freeciv-img-extract and recompile.'
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
      const newCtx = newCanvas.getContext('2d');

      if (newCtx && tileset_images[i]) {
        newCtx.drawImage(tileset_images[i], x, y, w, h, 0, 0, w, h);
        sprites[tile_tag] = newCanvas;
      }
    }

    sprites_init = true;
    // Clean up tileset images to save memory
    tileset_images[0] = null as any;
    tileset_images[1] = null as any;
    tileset_images = null as any;
  } catch (e) {
    console.log('Problem caching sprite: ' + e);
  }
}

/**************************************************************************
  Draw a sprite onto the canvas
**************************************************************************/
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

/****************************************************************************
  Draw a filled-in colored rectangle onto the mapview or citydialog canvas.
****************************************************************************/
export function canvas_put_rectangle(
  canvas_context: CanvasRenderingContext2D,
  pcolor: string,
  canvas_x: number,
  canvas_y: number,
  width: number,
  height: number
): void {
  canvas_context.fillStyle = pcolor;
  canvas_context.fillRect(
    canvas_x,
    canvas_y,
    canvas_x + width,
    canvas_y + height
  );
}

/****************************************************************************
  Draw a colored rectangle onto the mapview.
****************************************************************************/
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

// Initialize fog sprites
export function init_fog_sprites(): void {
  for (let i = 0; i < 81; i++) {
    /* Unknown, fog, known. */
    const ids = ['u', 'f', 'k'];
    let buf = 't.fog';
    const values: number[] = [];
    let k = i;

    for (let j = 0; j < 4; j++) {
      values[j] = k % 3;
      k = Math.floor(k / 3);
      buf += '_' + ids[values[j]];
    }

    fullfog[i] = buf;
  }
}
