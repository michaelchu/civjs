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
  MATCH_SAME,
  CELL_WHOLE,
  CELL_CORNER,
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
/**
 * Returns neighboring terrain information for terrain matching
 * Ported from original tilespec.js tile_terrain_near()
 */
function tile_terrain_near(ptile: Tile): { [dir: number]: Terrain | null } {
  const tterrain_near: { [dir: number]: Terrain | null } = {};

  // For each cardinal direction, get the neighboring tile's terrain
  for (let i = 0; i < num_cardinal_tileset_dirs; i++) {
    const dir = cardinal_tileset_dirs[i];
    const neighbor_tile = map_get_tile_from_dir(ptile, dir);
    if (neighbor_tile != null) {
      tterrain_near[dir] = tile_terrain(neighbor_tile);
    } else {
      // Edge of map or unknown neighbor - use current tile's terrain
      tterrain_near[dir] = tile_terrain(ptile);
    }
  }

  return tterrain_near;
}

/**
 * Returns the terrain type of the given tile
 * Ported from original tilespec.js tile_terrain()
 */
function tile_terrain(ptile: Tile): Terrain | null {
  if (ptile == null || ptile.terrain == null) {
    return null;
  }
  return ptile.terrain;
}

/**
 * Fill sprite array for terrain layer
 * Ported from original tilespec.js fill_terrain_sprite_layer()
 */
function fill_terrain_sprite_layer(
  layer_num: number,
  ptile: Tile,
  pterrain: Terrain | null,
  tterrain_near: { [dir: number]: Terrain | null }
): SpriteDefinition[] {
  if (pterrain == null) {
    return [];
  }

  // FIXME: handle blending and darkness
  return fill_terrain_sprite_array(layer_num, ptile, pterrain, tterrain_near);
}

/**
 * Helper function for fill_terrain_sprite_layer
 * Ported from original tilespec.js fill_terrain_sprite_array()
 */
function fill_terrain_sprite_array(
  layer_num: number,
  ptile: Tile,
  pterrain: Terrain,
  tterrain_near: { [dir: number]: Terrain | null }
): SpriteDefinition[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphic_str = (pterrain as any).graphic_str || pterrain.graphic;
  const layer_key = `l${layer_num}.${graphic_str}`;

  if (tile_types_setup[layer_key] == null) {
    // console.log("missing " + layer_key);
    return [];
  }

  const dlp = tile_types_setup[layer_key];

  switch (dlp.sprite_type) {
    case CELL_WHOLE: {
      switch (dlp.match_style) {
        case MATCH_NONE: {
          const result_sprites: SpriteDefinition[] = [];
          if (dlp.dither === true) {
            for (let i = 0; i < num_cardinal_tileset_dirs; i++) {
              const dir = cardinal_tileset_dirs[i];
              const neighbor_terrain = tterrain_near[dir];
              if (neighbor_terrain == null) continue;

              const neighbor_graphic =
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (neighbor_terrain as any).graphic_str ||
                neighbor_terrain.graphic;
              if (ts_tiles[neighbor_graphic] == null) continue;

              const near_dlp =
                tile_types_setup[`l${layer_num}.${neighbor_graphic}`];
              const terrain_near =
                near_dlp?.dither === true ? neighbor_graphic : graphic_str;
              const dither_tile = `${i}${graphic_str}_${terrain_near}`;
              const x = dither_offset_x[i];
              const y = dither_offset_y[i];

              result_sprites.push({
                key: dither_tile,
                offset_x: x,
                offset_y: y,
              });
            }
            return result_sprites;
          } else {
            return [{ key: `t.l${layer_num}.${graphic_str}1` }];
          }
        }

        case MATCH_SAME: {
          let tileno = 0;
          const this_match_type =
            ts_tiles[graphic_str]?.[`layer${layer_num}_match_type`];

          for (let i = 0; i < num_cardinal_tileset_dirs; i++) {
            const dir = cardinal_tileset_dirs[i];
            const neighbor_terrain = tterrain_near[dir];
            if (neighbor_terrain == null) continue;

            const neighbor_graphic =
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (neighbor_terrain as any).graphic_str || neighbor_terrain.graphic;
            if (ts_tiles[neighbor_graphic] == null) continue;

            const that =
              ts_tiles[neighbor_graphic]?.[`layer${layer_num}_match_type`];
            if (that == this_match_type) {
              tileno |= 1 << i;
            }
          }

          const gfx_key = `t.l${layer_num}.${graphic_str}_${cardinal_index_str(tileno)}`;
          const sprite_info = tileset[gfx_key];
          if (sprite_info) {
            const y = tileset_tile_height - sprite_info[3];
            return [{ key: gfx_key, offset_x: 0, offset_y: y }];
          }
          return [];
        }
      }
      break;
    }

    case CELL_CORNER: {
      // Corner-based terrain matching - more complex algorithm
      // This is used for more sophisticated terrain blending
      const W = normal_tile_width;
      const H = normal_tile_height;
      const iso_offsets = [
        [W / 4, 0],
        [W / 4, H / 2],
        [W / 2, H / 4],
        [0, H / 4],
      ];

      const layer_config = tile_types_setup[layer_key];
      const this_match_index = layer_config?.match_index?.[0] ?? -1;
      const result_sprites: SpriteDefinition[] = [];

      // For corner-based matching, we need to process each corner of the tile
      // This is a simplified version - the full algorithm is quite complex
      for (let dir = 0; dir < 4; dir++) {
        const corner_key = `t.l${layer_num}.${graphic_str}_cell_${dir}_0_0_0`;
        if (tileset[corner_key]) {
          result_sprites.push({
            key: corner_key,
            offset_x: iso_offsets[dir][0],
            offset_y: iso_offsets[dir][1],
          });
        }
      }

      return result_sprites;
    }
  }

  return [];
}

/**
 * Fill sprite array for irrigation and farmland
 * Ported from original tilespec.js fill_irrigation_sprite_array()
 */
function fill_irrigation_sprite_array(
  ptile: Tile,
  pcity: City | null
): SpriteDefinition[] {
  const result_sprites: SpriteDefinition[] = [];

  // We don't draw the irrigation if there's a city (it just gets overdrawn
  // anyway, and ends up looking bad).
  if (tile_has_extra(ptile, EXTRA_IRRIGATION) && pcity == null) {
    if (tile_has_extra(ptile, EXTRA_FARMLAND)) {
      const tag = tileset_extra_id_graphic_tag(EXTRA_FARMLAND);
      if (tag) {
        result_sprites.push({ key: tag });
      }
    } else {
      const tag = tileset_extra_id_graphic_tag(EXTRA_IRRIGATION);
      if (tag) {
        result_sprites.push({ key: tag });
      }
    }
  }

  return result_sprites;
}

/**
 * Fill sprite array for roads, rails, and maglev paths
 * Ported from original tilespec.js fill_path_sprite_array()
 */
function fill_path_sprite_array(
  ptile: Tile,
  pcity: City | null
): SpriteDefinition[] {
  const rs_maglev = typeof EXTRA_MAGLEV !== 'undefined';
  const road = tile_has_extra(ptile, EXTRA_ROAD);
  const rail = tile_has_extra(ptile, EXTRA_RAIL);
  const maglev = rs_maglev && tile_has_extra(ptile, EXTRA_MAGLEV);
  const road_near: boolean[] = [];
  const rail_near: boolean[] = [];
  const maglev_near: boolean[] = [];
  const draw_rail: boolean[] = [];
  const draw_road: boolean[] = [];
  const draw_maglev: boolean[] = [];
  const result_sprites: SpriteDefinition[] = [];
  let draw_single_road: boolean;
  let draw_single_rail: boolean;
  let draw_single_maglev: boolean;

  if (pcity != null) {
    draw_single_road = draw_single_rail = draw_single_maglev = false;
  } else if (maglev) {
    draw_single_road = draw_single_rail = false;
    draw_single_maglev = maglev;
  } else {
    draw_single_road = road && rail === false;
    draw_single_rail = rail;
    draw_single_maglev = false;
  }

  for (let dir = 0; dir < 8; dir++) {
    // Check if there is adjacent road/rail/maglev
    const tile1 = mapstep(ptile, dir);
    if (tile1 != null && tile_get_known(tile1) !== TILE_UNKNOWN) {
      road_near[dir] = tile_has_extra(tile1, EXTRA_ROAD);
      rail_near[dir] = tile_has_extra(tile1, EXTRA_RAIL);
      maglev_near[dir] = rs_maglev && tile_has_extra(tile1, EXTRA_MAGLEV);

      // Draw path if there is a connection from this tile to the
      // adjacent tile. But don't draw path if there is also an extra
      // hiding it.
      draw_maglev[dir] = maglev && maglev_near[dir];
      draw_rail[dir] = rail && rail_near[dir] && !draw_maglev[dir];
      draw_road[dir] =
        road && road_near[dir] && !draw_rail[dir] && !draw_maglev[dir];

      // Don't draw an isolated road/rail/maglev if there's any connection.
      if (draw_maglev[dir]) {
        draw_single_maglev = draw_single_rail = draw_single_road = false;
      } else {
        draw_single_rail = draw_single_rail && !draw_rail[dir];
        draw_single_road =
          draw_single_road && !draw_rail[dir] && !draw_road[dir];
      }
    }
  }

  // First raw roads under rails
  if (road) {
    for (let i = 0; i < 8; i++) {
      if (draw_road[i]) {
        result_sprites.push({ key: 'road.road_' + dir_get_tileset_name(i) });
      }
    }
  }

  // Then draw rails over roads
  if (rail) {
    for (let i = 0; i < 8; i++) {
      if (draw_rail[i]) {
        result_sprites.push({ key: 'road.rail_' + dir_get_tileset_name(i) });
      }
    }
  }

  // Then draw maglevs over rails
  if (maglev) {
    for (let i = 0; i < 8; i++) {
      if (draw_maglev[i]) {
        result_sprites.push({ key: 'road.maglev_' + dir_get_tileset_name(i) });
      }
    }
  }

  // Draw isolated path separately
  if (draw_single_maglev) {
    result_sprites.push({ key: 'road.maglev_isolated' });
  } else if (draw_single_rail) {
    result_sprites.push({ key: 'road.rail_isolated' });
  } else if (draw_single_road) {
    result_sprites.push({ key: 'road.road_isolated' });
  }

  return result_sprites;
}

/**
 * Get river sprite for a tile based on neighboring rivers and coasts
 * Ported from original tilespec.js get_tile_river_sprite()
 */
function get_tile_river_sprite(ptile: Tile): SpriteDefinition | null {
  if (ptile == null) {
    return null;
  }

  if (tile_has_extra(ptile, EXTRA_RIVER)) {
    let river_str = '';
    for (let i = 0; i < num_cardinal_tileset_dirs; i++) {
      const dir = cardinal_tileset_dirs[i];
      const checktile = mapstep(ptile, dir);
      if (
        checktile &&
        (tile_has_extra(checktile, EXTRA_RIVER) || is_ocean_tile(checktile))
      ) {
        river_str = river_str + dir_get_tileset_name(dir) + '1';
      } else {
        river_str = river_str + dir_get_tileset_name(dir) + '0';
      }
    }
    return { key: 'road.river_s_' + river_str };
  }

  const pterrain = tile_terrain(ptile);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (pterrain && (pterrain as any).graphic_str === 'coast') {
    for (let i = 0; i < num_cardinal_tileset_dirs; i++) {
      const dir = cardinal_tileset_dirs[i];
      const checktile = mapstep(ptile, dir);
      if (checktile != null && tile_has_extra(checktile, EXTRA_RIVER)) {
        return { key: 'road.river_outlet_' + dir_get_tileset_name(dir) };
      }
    }
  }

  return null;
}

/**
 * Get special resource sprite for a tile
 * Ported from original tilespec.js get_tile_specials_sprite()
 */
function get_tile_specials_sprite(ptile: Tile): SpriteDefinition | null {
  const extra_id = tile_resource(ptile);

  if (extra_id !== null) {
    const extra = extras[extra_id];
    if (extra != null) {
      return { key: extra['graphic_str'] };
    }
  }
  return null;
}

/**
 * Check if tile has a specific extra (improvement, resource, etc.)
 * Ported from original tilespec.js tile_has_extra()
 */
function tile_has_extra(ptile: Tile, extra_id: number): boolean {
  if (ptile == null || ptile.extras == null) {
    return false;
  }

  // Check if any of the tile's extras matches the requested extra_id
  return ptile.extras.some(extra => extra.id === extra_id);
}

// tileset_extra_id_graphic_tag is now implemented above - removed duplicate stub

/**
 * Fill sprite array for layer 1 (bases, improvements)
 * Simplified implementation - full version needs porting from original
 */
function fill_layer1_sprite_array(
  ptile: Tile,
  pcity: City | null
): SpriteDefinition[] {
  const result_sprites: SpriteDefinition[] = [];

  // We don't draw the bases if there's a city
  if (pcity == null) {
    if (tile_has_extra(ptile, EXTRA_FORTRESS)) {
      result_sprites.push({
        key: 'base.fortress_bg',
        offset_y: -normal_tile_height / 2,
      });
    }
  }

  return result_sprites;
}

/**
 * Get border line sprites for national boundaries
 * Simplified implementation - full version needs complex boundary logic
 */
function get_border_line_sprites(ptile: Tile): SpriteDefinition[] {
  const result_sprites: SpriteDefinition[] = [];

  // This would need complex logic to determine border lines
  // For now, return empty array
  // TODO: Implement full border detection logic
  void ptile;

  return result_sprites;
}

/**
 * Get the appropriate city sprite based on size and style
 * Ported from original tilespec.js get_city_sprite()
 */
function get_city_sprite(pcity: City): SpriteDefinition {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let style_id = (pcity as any).style || 0;
  if (style_id === -1) style_id = 0; // Sometimes a player has no city_style
  const city_rule = city_rules[style_id];

  let size = 0;
  if (pcity.size >= 4 && pcity.size <= 7) {
    size = 1;
  } else if (pcity.size >= 8 && pcity.size <= 11) {
    size = 2;
  } else if (pcity.size >= 12 && pcity.size <= 15) {
    size = 3;
  } else if (pcity.size >= 16) {
    size = 4;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const city_walls = (pcity as any).walls ? 'wall' : 'city';

  let tag = city_rule.graphic + '_' + city_walls + '_' + size;
  if (tileset_has_tag(tag) === false) {
    tag = city_rule.graphic_alt + '_' + city_walls + '_' + size;
  }

  return { key: tag, offset_x: 0, offset_y: -unit_offset_y };
}

/**
 * Fill sprite array for layer 2 (more bases and improvements)
 * Simplified implementation - full version needs porting from original
 */
function fill_layer2_sprite_array(
  ptile: Tile,
  pcity: City | null
): SpriteDefinition[] {
  const result_sprites: SpriteDefinition[] = [];

  // We don't draw the bases if there's a city
  if (pcity == null) {
    if (tile_has_extra(ptile, EXTRA_AIRBASE)) {
      result_sprites.push({
        key: 'base.airbase_mg',
        offset_y: -normal_tile_height / 2,
      });
    }
    if (tile_has_extra(ptile, EXTRA_RUINS)) {
      result_sprites.push({
        key: 'extra.ruins_mg',
        offset_y: -normal_tile_height / 2,
      });
    }
  }

  return result_sprites;
}

/**
 * Check if unit is currently in focus/selected
 * This function is likely defined in the game client
 */
function unit_is_in_focus(punit: Unit): boolean {
  // This is typically managed by the game state
  // For now, return false as a placeholder
  return get_focus_unit()?.id === punit.id;
}

/**
 * Get animated selection sprite for focused units
 * Ported from original tilespec.js get_select_sprite()
 */
function get_select_sprite(): SpriteDefinition {
  // Update selected unit sprite 6 times a second
  const current_select_sprite =
    Math.floor((new Date().getTime() * 6) / 1000) % max_select_sprite;
  return { key: 'unit.select' + current_select_sprite };
}

/**
 * Fill sprite array for unit rendering with all unit elements
 * Ported from original tilespec.js fill_unit_sprite_array()
 */
function fill_unit_sprite_array(
  punit: Unit,
  stacked: boolean,
  backdrop: boolean
): SpriteDefinition[] {
  // Suppress unused parameter warning
  void backdrop;

  const unit_offset = get_unit_anim_offset(punit);
  const result: SpriteDefinition[] = [
    get_unit_nation_flag_sprite(punit),
    {
      key: tileset_unit_graphic_tag(punit) || 'unit.fallback',
      offset_x: unit_offset.x + unit_offset_x,
      offset_y: unit_offset.y - unit_offset_y,
    },
  ];

  const activities = get_unit_activity_sprite(punit);
  if (activities != null) {
    activities.offset_x = (activities.offset_x || 0) + unit_offset.x;
    activities.offset_y = (activities.offset_y || 0) + unit_offset.y;
    result.push(activities);
  }

  const agent = get_unit_agent_sprite(punit);
  if (agent != null) {
    agent.offset_x = (agent.offset_x || 0) + unit_offset.x;
    agent.offset_y = (agent.offset_y || 0) + unit_offset.y;
    result.push(agent);
  }

  if (should_ask_server_for_actions(punit)) {
    result.push({
      key: 'unit.action_decision_want',
      offset_x: unit_activity_offset_x + unit_offset.x,
      offset_y: -unit_activity_offset_y + unit_offset.y,
    });
  }

  const hp_sprite = get_unit_hp_sprite(punit);
  if (hp_sprite) result.push(hp_sprite);

  if (stacked) {
    const stack_sprite = get_unit_stack_sprite();
    if (stack_sprite) result.push(stack_sprite);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((punit as any).veteran > 0) {
    const veteran_sprite = get_unit_veteran_sprite(punit);
    if (veteran_sprite) result.push(veteran_sprite);
  }

  return result;
}

/**
 * Fill sprite array for fog of war rendering
 * Ported from original tilespec.js fill_fog_sprite_array()
 */
function fill_fog_sprite_array(
  ptile: Tile | null,
  pedge: Edge | null,
  pcorner: Corner | null
): SpriteDefinition[] {
  // Suppress unused parameter warnings
  void ptile;
  void pedge;

  let tileno = 0;

  if (pcorner == null) return [];

  for (let i = 3; i >= 0; i--) {
    const unknown = 0;
    const fogged = 1;
    const known = 2;
    let value = -1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((pcorner as any).tile[i] == null) {
      value = unknown;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      switch (tile_get_known((pcorner as any).tile[i])) {
        case TILE_KNOWN_SEEN:
          value = known;
          break;
        case TILE_KNOWN_UNSEEN:
          value = fogged;
          break;
        case TILE_UNKNOWN:
          value = unknown;
          break;
      }
    }
    tileno = tileno * 3 + value;
  }

  if (tileno >= 80) return [];

  return [{ key: fullfog[tileno] }];
}

/**
 * Fill sprite array for layer 3 (foreground elements)
 * Simplified implementation - full version needs porting from original
 */
function fill_layer3_sprite_array(
  ptile: Tile,
  pcity: City | null
): SpriteDefinition[] {
  const result_sprites: SpriteDefinition[] = [];

  // We don't draw the bases if there's a city
  if (pcity == null) {
    if (tile_has_extra(ptile, EXTRA_FORTRESS)) {
      result_sprites.push({
        key: 'base.fortress_fg',
        offset_y: -normal_tile_height / 2,
      });
    }
  }

  return result_sprites;
}

function get_tile_label_text(ptile: Tile): SpriteDefinition {
  // TODO: Port from original tilespec.js
  return { key: 'tilelabel', text: ptile.label };
}

function get_city_info_text(pcity: City): SpriteDefinition {
  // TODO: Port from original tilespec.js
  return { key: 'cityinfo', text: pcity.name };
}

/**
 * Get the tile that the city is located on
 * This function is likely defined in the game logic
 */
function city_tile(pcity: City): Tile {
  // This should return the actual tile the city is on
  // For now, return a stub that gets the tile by city.tile ID
  return tiles[pcity.tile] as Tile;
}

/**
 * Calculate the distance vector between two tiles
 * This function is likely defined in the map logic
 */
function map_distance_vector(tile1: Tile, tile2: Tile): [number, number] {
  // Simple Euclidean distance calculation
  const dx = tile2.x - tile1.x;
  const dy = tile2.y - tile1.y;
  return [dx, dy];
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

/**
 * Fill sprite array for goto path lines
 * Simplified implementation - shows path direction
 */
function fill_goto_line_sprite_array(ptile: Tile): SpriteDefinition[] {
  const result_sprites: SpriteDefinition[] = [];

  if (ptile.goto_dir != null) {
    result_sprites.push({
      key: 'goto.path_' + dir_get_tileset_name(ptile.goto_dir),
      offset_x: 0,
      offset_y: 0,
    });
  }

  return result_sprites;
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

// Terrain matching variables
const num_cardinal_tileset_dirs = 4;
const cardinal_tileset_dirs = [DIR8_NORTH, DIR8_EAST, DIR8_SOUTH, DIR8_WEST];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const tile_types_setup: any; // Tileset terrain configuration
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const ts_tiles: any; // Terrain sprite definitions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const tileset: any; // Main tileset configuration
declare const dither_offset_x: number[];
declare const dither_offset_y: number[];
declare const normal_tile_width: number;
declare const normal_tile_height: number;

// Helper functions for terrain matching
declare function map_get_tile_from_dir(ptile: Tile, dir: number): Tile | null;
declare function cardinal_index_str(tileno: number): string;
declare function mapstep(ptile: Tile, dir: number): Tile | null;
declare function is_ocean_tile(ptile: Tile): boolean;
declare function tile_resource(ptile: Tile): number | null;
declare function tile_get_known(ptile: Tile): number;
declare const TILE_UNKNOWN: number;

// Unit selection variables
const max_select_sprite = 4;

// Unit rendering helper functions
declare function get_focus_unit(): Unit | null;
declare function get_unit_anim_offset(punit: Unit): { x: number; y: number };
declare function get_unit_nation_flag_sprite(punit: Unit): SpriteDefinition;
declare function get_unit_activity_sprite(punit: Unit): SpriteDefinition | null;
declare function get_unit_agent_sprite(punit: Unit): SpriteDefinition | null;
declare function should_ask_server_for_actions(punit: Unit): boolean;
declare function get_unit_hp_sprite(punit: Unit): SpriteDefinition | null;
declare function get_unit_stack_sprite(): SpriteDefinition | null;
declare function get_unit_veteran_sprite(punit: Unit): SpriteDefinition | null;

// Unit rendering offset constants
declare const unit_activity_offset_x: number;
declare const unit_activity_offset_y: number;

// Fog of war constants and variables
declare const TILE_KNOWN_SEEN: number;
declare const TILE_KNOWN_UNSEEN: number;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const fullfog: any[];

// City rendering variables
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const city_rules: any[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const tiles: any; // Tile lookup by ID

// Constants referenced in the function
const EXTRA_MINE = 1;
const EXTRA_OIL_WELL = 2;
const EXTRA_HUT = 3;
const EXTRA_POLLUTION = 4;
const EXTRA_FALLOUT = 5;
const EXTRA_RIVER = 6;
const EXTRA_ROAD = 7;
const EXTRA_RAIL = 8;
const EXTRA_IRRIGATION = 9;
const EXTRA_FARMLAND = 10;
const EXTRA_FORTRESS = 11;
const EXTRA_AIRBASE = 12;
const EXTRA_BUOY = 13; // eslint-disable-line @typescript-eslint/no-unused-vars
const EXTRA_RUINS = 14;
const EXTRA_MAGLEV = 15;

// Terrain sprite constants are imported from constants.ts

// Additional tileset constants
declare const tileset_tile_width: number; // eslint-disable-line @typescript-eslint/no-unused-vars
declare const tileset_tile_height: number;

// Export placeholder for now - will be populated with all ported functions
export { LAYER_COUNT, terrain_match };
