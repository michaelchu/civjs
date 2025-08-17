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

/* Amplio.tilespec ported to TypeScript */

export const tileset_tile_width = 96;
export const tileset_tile_height = 48;

export const tileset_options = '+tilespec4+2007.Oct.26';

// A simple name for the tileset specified by this file:
export const tileset_name = 'amplio2';
export const priority = 20;

export const tileset_image_count = 3;

export const normal_tile_width = 96;
export const normal_tile_height = 48;
export const small_tile_width = 15;
export const small_tile_height = 20;

export const is_hex = 0;
export const is_isometric = 1;

// Do not blend hills and mountains together.
export const is_mountainous = 0;

// Use roadstyle 0 (old iso style)
export const roadstyle = 0;

// Fogstyle 2, darkness_style 4 : blended fog
export const fogstyle = 2;
export const darkness_style = 4;

// Which terrain layer sprites are drawn top to bottom
export const layer_order = [
  0, // background
  1, // terrain
  2, // rivers
  3, // roads
  4, // bases
  5, // units
  6, // cities
  7, // goto
];

// Tileset sprite definitions will be added here
// This would normally be generated from the tileset extraction process
export const tileset: Record<string, [number, number, number, number, number]> =
  {
    // Format: "sprite_name": [x, y, width, height, image_index]
    // For now we'll add basic terrain sprites
    't.l0.desert1': [0, 0, 96, 48, 0],
    't.l0.forest1': [96, 0, 96, 48, 0],
    't.l0.grassland1': [192, 0, 96, 48, 0],
    't.l0.hills1': [288, 0, 96, 48, 0],
    't.l0.mountains1': [384, 0, 96, 48, 0],
    't.l0.ocean1': [480, 0, 96, 48, 0],
    't.l0.plains1': [576, 0, 96, 48, 0],
    't.l0.swamp1': [672, 0, 96, 48, 0],
    't.l0.tundra1': [768, 0, 96, 48, 0],
  };
