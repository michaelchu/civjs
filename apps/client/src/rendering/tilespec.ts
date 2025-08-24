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

// Core rendering engine ported from freeciv-web tilespec.js
import type {
  LayerType,
  SpriteDefinition,
  Tile,
  Unit,
  City,
  Edge,
  Corner,
  Terrain,
} from './types';

import {
  LAYER_TERRAIN1,
  LAYER_TERRAIN2,
  LAYER_TERRAIN3,
  LAYER_ROADS,
  LAYER_SPECIAL1,
  LAYER_CITY1,
  LAYER_SPECIAL2,
  LAYER_UNIT,
  LAYER_FOG,
  LAYER_SPECIAL3,
  LAYER_TILELABEL,
  LAYER_CITYBAR,
  LAYER_GOTO,
  MATCH_NONE,
  LAYER_COUNT,
  DIR8_NORTH,
  DIR8_NORTHEAST,
  DIR8_EAST,
  DIR8_SOUTHEAST,
  DIR8_SOUTH,
  DIR8_SOUTHWEST,
  DIR8_WEST,
  DIR8_NORTHWEST,
} from './constants';

import { getSpriteCoordinate } from './tileset-spec';

// Local state variables (not constants)
const explosion_anim_map: { [key: string]: number } = {};

// Terrain matching configuration
const terrain_match: { [key: string]: number } = {
  't.l0.hills1': MATCH_NONE,
  't.l0.mountains1': MATCH_NONE,
  't.l0.plains1': MATCH_NONE,
  't.l0.desert1': MATCH_NONE,
};

// This is a placeholder for the complete conversion
// TODO: Port all 59 functions from the original tilespec.js

/**
 * Returns true iff the tileset has graphics for the specified tag.
 */
export function tileset_has_tag(tagname: string): boolean {
  return getSpriteCoordinate(tagname) !== null;
}

/**
 * Main sprite filling function - the core of the rendering system.
 * This function determines which sprites should be drawn for a given layer of a tile.
 * Ported from freeciv-web tilespec.js fill_sprite_array()
 */
export function fill_sprite_array(
  layer: LayerType,
  ptile: Tile | null,
  pedge: Edge | null = null,
  pcorner: Corner | null = null,
  punit: Unit | null = null,
  pcity: City | null = null,
  citymode = false
): SpriteDefinition[] {
  // Suppress unused parameter warning for citymode
  void citymode;
  const sprite_array: SpriteDefinition[] = [];

  switch (layer) {
    case LAYER_TERRAIN1:
      if (ptile != null) {
        const tterrain_near = tile_terrain_near(ptile);
        const pterrain = tile_terrain(ptile);
        sprite_array.push(
          ...fill_terrain_sprite_layer(0, ptile, pterrain, tterrain_near)
        );
      }
      break;

    case LAYER_TERRAIN2:
      if (ptile != null) {
        const tterrain_near = tile_terrain_near(ptile);
        const pterrain = tile_terrain(ptile);
        sprite_array.push(
          ...fill_terrain_sprite_layer(1, ptile, pterrain, tterrain_near)
        );
      }
      break;

    case LAYER_TERRAIN3:
      if (ptile != null) {
        const tterrain_near = tile_terrain_near(ptile);
        const pterrain = tile_terrain(ptile);
        sprite_array.push(
          ...fill_terrain_sprite_layer(2, ptile, pterrain, tterrain_near)
        );
        sprite_array.push(...fill_irrigation_sprite_array(ptile, pcity));
      }
      break;

    case LAYER_ROADS:
      if (ptile != null) {
        sprite_array.push(...fill_path_sprite_array(ptile, pcity));
      }
      break;

    case LAYER_SPECIAL1:
      if (ptile != null) {
        const river_sprite = get_tile_river_sprite(ptile);
        if (river_sprite != null) sprite_array.push(river_sprite);

        const spec_sprite = get_tile_specials_sprite(ptile);
        if (spec_sprite != null) sprite_array.push(spec_sprite);

        if (tile_has_extra(ptile, EXTRA_MINE)) {
          const tag = tileset_extra_id_graphic_tag(EXTRA_MINE);
          if (tag) sprite_array.push({ key: tag });
        }
        if (tile_has_extra(ptile, EXTRA_OIL_WELL)) {
          const tag = tileset_extra_id_graphic_tag(EXTRA_OIL_WELL);
          if (tag) sprite_array.push({ key: tag });
        }

        sprite_array.push(...fill_layer1_sprite_array(ptile, pcity));

        if (tile_has_extra(ptile, EXTRA_HUT)) {
          const tag = tileset_extra_id_graphic_tag(EXTRA_HUT);
          if (tag) sprite_array.push({ key: tag });
        }

        if (tile_has_extra(ptile, EXTRA_POLLUTION)) {
          const tag = tileset_extra_id_graphic_tag(EXTRA_POLLUTION);
          if (tag) sprite_array.push({ key: tag });
        }

        if (tile_has_extra(ptile, EXTRA_FALLOUT)) {
          const tag = tileset_extra_id_graphic_tag(EXTRA_FALLOUT);
          if (tag) sprite_array.push({ key: tag });
        }

        sprite_array.push(...get_border_line_sprites(ptile));
      }
      break;

    case LAYER_CITY1:
      if (pcity != null) {
        sprite_array.push(get_city_sprite(pcity));
        if (pcity.unhappy) {
          sprite_array.push({ key: 'city.disorder' });
        }
      }
      break;

    case LAYER_SPECIAL2:
      if (ptile != null) {
        sprite_array.push(...fill_layer2_sprite_array(ptile, pcity));
      }
      break;

    case LAYER_UNIT: {
      const do_draw_unit =
        punit != null &&
        (draw_units ||
          ptile == null ||
          (draw_focus_unit && unit_is_in_focus(punit)));

      if (do_draw_unit && active_city == null) {
        const stacked = ptile?.units != null && ptile.units.length > 1;
        const backdrop = false; /* !pcity;*/

        if (unit_is_in_focus(punit!)) {
          sprite_array.push(get_select_sprite());
        }

        sprite_array.push(...fill_unit_sprite_array(punit!, stacked, backdrop));
      }

      // Show explosion animation on current tile
      if (ptile != null && explosion_anim_map[ptile.index] != null) {
        const explode_step = explosion_anim_map[ptile.index];
        explosion_anim_map[ptile.index] = explode_step - 1;

        if (explode_step > 20) {
          sprite_array.push({
            key: 'explode.unit_0',
            offset_x: unit_offset_x,
            offset_y: unit_offset_y,
          });
        } else if (explode_step > 15) {
          sprite_array.push({
            key: 'explode.unit_1',
            offset_x: unit_offset_x,
            offset_y: unit_offset_y,
          });
        } else if (explode_step > 10) {
          sprite_array.push({
            key: 'explode.unit_2',
            offset_x: unit_offset_x,
            offset_y: unit_offset_y,
          });
        } else if (explode_step > 5) {
          sprite_array.push({
            key: 'explode.unit_3',
            offset_x: unit_offset_x,
            offset_y: unit_offset_y,
          });
        } else if (explode_step > 0) {
          sprite_array.push({
            key: 'explode.unit_4',
            offset_x: unit_offset_x,
            offset_y: unit_offset_y,
          });
        } else {
          delete explosion_anim_map[ptile.index];
        }
      }
      break;
    }

    case LAYER_FOG:
      sprite_array.push(...fill_fog_sprite_array(ptile, pedge, pcorner));
      break;

    case LAYER_SPECIAL3:
      if (ptile != null) {
        sprite_array.push(...fill_layer3_sprite_array(ptile, pcity));
      }
      break;

    case LAYER_TILELABEL:
      if (ptile != null && ptile.label != null && ptile.label.length > 0) {
        sprite_array.push(get_tile_label_text(ptile));
      }
      break;

    case LAYER_CITYBAR:
      if (pcity != null && show_citybar) {
        sprite_array.push(get_city_info_text(pcity));
      }

      if (
        active_city != null &&
        ptile != null &&
        ptile.worked != null &&
        active_city.id == ptile.worked &&
        active_city.output_food != null
      ) {
        const ctile = city_tile(active_city);
        const d = map_distance_vector(ctile, ptile);
        const idx = get_city_dxy_to_index(d[0], d[1], active_city);

        let food_output = active_city.output_food![idx];
        let shield_output = active_city.output_shield![idx];
        let trade_output = active_city.output_trade![idx];

        // The ruleset may use large values scaled down to get greater granularity
        food_output = Math.floor(food_output / game_info.granularity);
        shield_output = Math.floor(shield_output / game_info.granularity);
        trade_output = Math.floor(trade_output / game_info.granularity);

        sprite_array.push(get_city_food_output_sprite(food_output));
        sprite_array.push(get_city_shields_output_sprite(shield_output));
        sprite_array.push(get_city_trade_output_sprite(trade_output));
      } else if (active_city != null && ptile != null && ptile.worked != 0) {
        sprite_array.push(get_city_invalid_worked_sprite());
      }
      break;

    case LAYER_GOTO:
      if (ptile != null && ptile.goto_dir != null) {
        sprite_array.push(...fill_goto_line_sprite_array(ptile));
      }

      if (ptile != null && ptile.nuke > 0) {
        ptile.nuke = ptile.nuke - 1;
        sprite_array.push({
          key: 'explode.nuke',
          offset_x: -45,
          offset_y: -45,
        });
      }
      break;

    default:
      console.warn(`Unknown layer type: ${layer}`);
  }

  return sprite_array;
}

// Tileset tag resolution functions ported from tilespec.js

/**
 * Returns the tag name for an entity, preferring graphic_str over graphic_alt
 * Ported from tileset_ruleset_entity_tag_str_or_alt()
 */
export function tileset_ruleset_entity_tag_str_or_alt(
  entity: { graphic_str?: string; graphic_alt?: string; name?: string } | null,
  kind_name: string
): string | null {
  if (entity == null) {
    console.log('No ' + kind_name + ' to return tag for.');
    return null;
  }

  if (entity.graphic_str && tileset_has_tag(entity.graphic_str)) {
    return entity.graphic_str;
  }

  if (entity.graphic_alt && tileset_has_tag(entity.graphic_alt)) {
    return entity.graphic_alt;
  }

  console.log('No graphic for ' + kind_name + ' ' + entity.name);
  return null;
}

/**
 * Returns the tag name of the graphic showing the specified Extra on the map
 * Ported from tileset_extra_graphic_tag()
 */
export function tileset_extra_graphic_tag(extra: {
  graphic_str?: string;
  graphic_alt?: string;
  name?: string;
}): string | null {
  return tileset_ruleset_entity_tag_str_or_alt(extra, 'extra');
}

/**
 * Returns the tag name of the graphic showing the specified unit type
 * Ported from tileset_unit_type_graphic_tag()
 */
export function tileset_unit_type_graphic_tag(utype: {
  graphic_str?: string;
  graphic_alt?: string;
  name?: string;
}): string | null {
  if (utype.graphic_str && tileset_has_tag(utype.graphic_str + '_Idle')) {
    return utype.graphic_str + '_Idle';
  }

  if (utype.graphic_alt && tileset_has_tag(utype.graphic_alt + '_Idle')) {
    return utype.graphic_alt + '_Idle';
  }

  console.log('No graphic for unit ' + utype.name);
  return null;
}

/**
 * Returns the tag name of the graphic for the unit
 * Ported from tileset_unit_graphic_tag()
 */
export function tileset_unit_graphic_tag(punit: Unit): string | null {
  // Currently always uses the default "_Idle" sprite
  return tileset_unit_type_graphic_tag(unit_type(punit));
}

/**
 * Returns the tag name of the graphic showing the specified building
 * Ported from tileset_building_graphic_tag()
 */
export function tileset_building_graphic_tag(pimprovement: {
  graphic_str?: string;
  graphic_alt?: string;
  name?: string;
}): string | null {
  return tileset_ruleset_entity_tag_str_or_alt(pimprovement, 'building');
}

/**
 * Returns the tag name of the graphic showing the specified tech
 * Ported from tileset_tech_graphic_tag()
 */
export function tileset_tech_graphic_tag(ptech: {
  graphic_str?: string;
  graphic_alt?: string;
  name?: string;
}): string | null {
  return tileset_ruleset_entity_tag_str_or_alt(ptech, 'tech');
}

/**
 * Returns the tag name of the graphic showing the Extra specified by ID on the map
 * Ported from tileset_extra_id_graphic_tag()
 */
export function tileset_extra_id_graphic_tag(extra_id: number): string | null {
  return tileset_extra_graphic_tag(extras[extra_id]);
}

/**
 * Returns the tag name of the graphic showing that a unit is building the specified Extra
 * Ported from tileset_extra_activity_graphic_tag()
 */
export function tileset_extra_activity_graphic_tag(
  extra: {
    activity_gfx?: string;
    act_gfx_alt?: string;
    act_gfx_alt2?: string;
    name?: string;
  } | null
): string | null {
  if (extra == null) {
    console.log('No extra to return tag for.');
    return null;
  }

  if (extra.activity_gfx && tileset_has_tag(extra.activity_gfx)) {
    return extra.activity_gfx;
  }

  if (extra.act_gfx_alt && tileset_has_tag(extra.act_gfx_alt)) {
    return extra.act_gfx_alt;
  }

  if (extra.act_gfx_alt2 && tileset_has_tag(extra.act_gfx_alt2)) {
    return extra.act_gfx_alt2;
  }

  console.log('No activity graphic for extra ' + extra.name);
  return null;
}

/**
 * Returns the tag name of the graphic showing that a unit is building the Extra specified by ID
 * Ported from tileset_extra_id_activity_graphic_tag()
 */
export function tileset_extra_id_activity_graphic_tag(
  extra_id: number
): string | null {
  return tileset_extra_activity_graphic_tag(extras[extra_id]);
}

/**
 * Returns the tag name of the graphic showing that a unit is removing the specified Extra
 * Ported from tileset_extra_rmactivity_graphic_tag()
 */
export function tileset_extra_rmactivity_graphic_tag(
  extra: {
    rmact_gfx?: string;
    rmact_gfx_alt?: string;
    rmact_gfx_alt2?: string;
    name?: string;
  } | null
): string | null {
  if (extra == null) {
    console.log('No extra to return tag for.');
    return null;
  }

  if (extra.rmact_gfx && tileset_has_tag(extra.rmact_gfx)) {
    return extra.rmact_gfx;
  }

  if (extra.rmact_gfx_alt && tileset_has_tag(extra.rmact_gfx_alt)) {
    return extra.rmact_gfx_alt;
  }

  if (extra.rmact_gfx_alt2 && tileset_has_tag(extra.rmact_gfx_alt2)) {
    return extra.rmact_gfx_alt2;
  }

  console.log('No removal activity graphic for extra ' + extra.name);
  return null;
}

/**
 * Returns the tag name of the graphic showing that a unit is removing the Extra specified by ID
 * Ported from tileset_extra_id_rmactivity_graphic_tag()
 */
export function tileset_extra_id_rmactivity_graphic_tag(
  extra_id: number
): string | null {
  return tileset_extra_rmactivity_graphic_tag(extras[extra_id]);
}

/**
 * Returns the tileset name for a direction (used for sprites like roads, rivers)
 * Ported from dir_get_tileset_name()
 */
export function dir_get_tileset_name(dir: number): string {
  switch (dir) {
    case DIR8_NORTH:
      return 'n';
    case DIR8_NORTHEAST:
      return 'ne';
    case DIR8_EAST:
      return 'e';
    case DIR8_SOUTHEAST:
      return 'se';
    case DIR8_SOUTH:
      return 's';
    case DIR8_SOUTHWEST:
      return 'sw';
    case DIR8_WEST:
      return 'w';
    case DIR8_NORTHWEST:
      return 'nw';
  }

  return '';
}

// Helper functions referenced by fill_sprite_array - need to be ported
// These are placeholder stubs that need to be implemented

/* eslint-disable @typescript-eslint/no-unused-vars */
function tile_terrain_near(ptile: Tile): unknown {
  // TODO: Port from original tilespec.js
  return null;
}

function tile_terrain(ptile: Tile): Terrain | null {
  // TODO: Port from original tilespec.js
  return null;
}

function fill_terrain_sprite_layer(
  layer: number,
  ptile: Tile,
  pterrain: Terrain | null,
  tterrain_near: unknown
): SpriteDefinition[] {
  // TODO: Port from original tilespec.js
  return [];
}

function fill_irrigation_sprite_array(
  ptile: Tile,
  pcity: City | null
): SpriteDefinition[] {
  // TODO: Port from original tilespec.js
  return [];
}

function fill_path_sprite_array(
  ptile: Tile,
  pcity: City | null
): SpriteDefinition[] {
  // TODO: Port from original tilespec.js
  return [];
}

function get_tile_river_sprite(ptile: Tile): SpriteDefinition | null {
  // TODO: Port from original tilespec.js
  return null;
}

function get_tile_specials_sprite(ptile: Tile): SpriteDefinition | null {
  // TODO: Port from original tilespec.js
  return null;
}

function tile_has_extra(ptile: Tile, extra_id: number): boolean {
  // TODO: Port from original tilespec.js
  return false;
}

// tileset_extra_id_graphic_tag is now implemented above - removed duplicate stub

function fill_layer1_sprite_array(
  ptile: Tile,
  pcity: City | null
): SpriteDefinition[] {
  // TODO: Port from original tilespec.js
  return [];
}

function get_border_line_sprites(ptile: Tile): SpriteDefinition[] {
  // TODO: Port from original tilespec.js
  return [];
}

function get_city_sprite(pcity: City): SpriteDefinition {
  // TODO: Port from original tilespec.js
  return { key: 'city.generic' };
}

function fill_layer2_sprite_array(
  ptile: Tile,
  pcity: City | null
): SpriteDefinition[] {
  // TODO: Port from original tilespec.js
  return [];
}

function unit_is_in_focus(punit: Unit): boolean {
  // TODO: Port from original tilespec.js
  return false;
}

function get_select_sprite(): SpriteDefinition {
  // TODO: Port from original tilespec.js
  return { key: 'unit.select0' };
}

function fill_unit_sprite_array(
  punit: Unit,
  stacked: boolean,
  backdrop: boolean
): SpriteDefinition[] {
  // TODO: Port from original tilespec.js
  return [];
}

function fill_fog_sprite_array(
  ptile: Tile | null,
  pedge: Edge | null,
  pcorner: Corner | null
): SpriteDefinition[] {
  // TODO: Port from original tilespec.js
  return [];
}

function fill_layer3_sprite_array(
  ptile: Tile,
  pcity: City | null
): SpriteDefinition[] {
  // TODO: Port from original tilespec.js
  return [];
}

function get_tile_label_text(ptile: Tile): SpriteDefinition {
  // TODO: Port from original tilespec.js
  return { key: 'tilelabel', text: ptile.label };
}

function get_city_info_text(pcity: City): SpriteDefinition {
  // TODO: Port from original tilespec.js
  return { key: 'cityinfo', text: pcity.name };
}

function city_tile(pcity: City): Tile {
  // TODO: Port from original tilespec.js
  return {} as Tile;
}

function map_distance_vector(tile1: Tile, tile2: Tile): [number, number] {
  // TODO: Port from original tilespec.js
  return [0, 0];
}

function get_city_dxy_to_index(dx: number, dy: number, pcity: City): number {
  // TODO: Port from original tilespec.js
  return 0;
}

function get_city_food_output_sprite(food_output: number): SpriteDefinition {
  // TODO: Port from original tilespec.js
  return { key: `city.food_${food_output}` };
}

function get_city_shields_output_sprite(
  shield_output: number
): SpriteDefinition {
  // TODO: Port from original tilespec.js
  return { key: `city.shields_${shield_output}` };
}

function get_city_trade_output_sprite(trade_output: number): SpriteDefinition {
  // TODO: Port from original tilespec.js
  return { key: `city.trade_${trade_output}` };
}

function get_city_invalid_worked_sprite(): SpriteDefinition {
  // TODO: Port from original tilespec.js
  return { key: 'city.invalid_worked' };
}

function fill_goto_line_sprite_array(ptile: Tile): SpriteDefinition[] {
  // TODO: Port from original tilespec.js
  return [];
}
/* eslint-enable @typescript-eslint/no-unused-vars */

// Global variables referenced in fill_sprite_array
declare const draw_units: boolean;
declare const draw_focus_unit: boolean;
declare const active_city: City | null;
declare const unit_offset_x: number;
declare const unit_offset_y: number;
declare const show_citybar: boolean;
declare const game_info: { granularity: number };

// Global variables for tileset functions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const extras: any[]; // Array of extra definitions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function unit_type(punit: Unit): any; // Function to get unit type from unit

// Constants referenced in the function
const EXTRA_MINE = 1;
const EXTRA_OIL_WELL = 2;
const EXTRA_HUT = 3;
const EXTRA_POLLUTION = 4;
const EXTRA_FALLOUT = 5;

// Export placeholder for now - will be populated with all ported functions
export { LAYER_COUNT, terrain_match };
