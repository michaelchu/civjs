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

// TypeScript conversion of Freeciv-web mapctrl.js

export let mouse_x: number;
export let mouse_y: number;
export let touch_start_x: number;
export let touch_start_y: number;

// Setter functions for external modules
export function set_touch_start_x(value: number): void {
  touch_start_x = value;
}

export function set_touch_start_y(value: number): void {
  touch_start_y = value;
}

export let map_select_setting_enabled = true;
export let map_select_check = false;
export let map_select_check_started = 0;
export let map_select_active = false;
export let map_select_x: number;
export let map_select_y: number;
export let mouse_touch_started_on_unit = false;

// External dependencies
declare let mapview_mouse_movement: boolean;
declare let goto_active: boolean;
declare let context_menu_active: boolean;
declare let keyboard_input: boolean;
declare function canvas_pos_to_tile(x: number, y: number): any;
declare function set_mouse_touch_started_on_unit(tile: any): void;
declare function check_mouse_drag_unit(tile: any): void;
declare function recenter_button_pressed(x: number, y: number): void;
declare function map_select_units(x: number, y: number): void;
declare function action_button_pressed(x: number, y: number, type: any): void;
declare function update_mouse_cursor(): void;
declare function popit(): boolean;
declare function is_right_mouse_selection_supported(): boolean;
declare function is_touch_device(): boolean;

/****************************************************************************
  Init 2D mapctrl
****************************************************************************/
export function mapctrl_init_2d(): void {
  // In React, we'll handle event binding differently
  // This is the original logic structure converted to TypeScript
  console.log('Initializing 2D map controls...');
}

/****************************************************************************
  Triggered when the mouse button is clicked UP on the mapview canvas.
****************************************************************************/
export function mapview_mouse_click(e: MouseEvent): void {
  let rightclick = false;
  let middleclick = false;

  if (e.which) {
    rightclick = e.which == 3;
    middleclick = e.which == 2;
  } else if ((e as any).button) {
    rightclick = (e as any).button == 2;
    middleclick = (e as any).button == 1 || (e as any).button == 4;
  }

  if (rightclick) {
    /* right click to recenter. */
    if (!map_select_active || !map_select_setting_enabled) {
      context_menu_active = true;
      recenter_button_pressed(mouse_x, mouse_y);
    } else {
      context_menu_active = false;
      map_select_units(mouse_x, mouse_y);
    }
    map_select_active = false;
    map_select_check = false;
  } else if (!middleclick) {
    /* Left mouse button*/
    action_button_pressed(mouse_x, mouse_y, 'SELECT_POPUP');
    mapview_mouse_movement = false;
    update_mouse_cursor();
  }
  keyboard_input = true;
}

/****************************************************************************
  Triggered when the mouse button is clicked DOWN on the mapview canvas.
****************************************************************************/
export function mapview_mouse_down(e: MouseEvent): void {
  let rightclick = false;
  let middleclick = false;

  if (e.which) {
    rightclick = e.which == 3;
    middleclick = e.which == 2;
  } else if ((e as any).button) {
    rightclick = (e as any).button == 2;
    middleclick = (e as any).button == 1 || (e as any).button == 4;
  }

  if (!rightclick && !middleclick) {
    /* Left mouse button is down */
    if (goto_active) return;
    set_mouse_touch_started_on_unit(canvas_pos_to_tile(mouse_x, mouse_y));
    check_mouse_drag_unit(canvas_pos_to_tile(mouse_x, mouse_y));
    if (!mouse_touch_started_on_unit) mapview_mouse_movement = true;
    touch_start_x = mouse_x;
    touch_start_y = mouse_y;
  } else if (middleclick || (e as any).altKey) {
    popit();
    return;
  } else if (
    rightclick &&
    !map_select_active &&
    is_right_mouse_selection_supported()
  ) {
    map_select_check = true;
    map_select_x = mouse_x;
    map_select_y = mouse_y;
    map_select_check_started = new Date().getTime();

    /* The context menu blocks the right click mouse up event on some
     * browsers. */
    context_menu_active = false;
  }
}

/****************************************************************************
  This function is triggered when beginning a touch event on a touch device,
  eg. finger down on screen.
****************************************************************************/
export function mapview_touch_start(e: TouchEvent): void {
  e.preventDefault();

  const canvas = e.target as HTMLCanvasElement;
  const rect = canvas.getBoundingClientRect();

  touch_start_x = e.touches[0].clientX - rect.left;
  touch_start_y = e.touches[0].clientY - rect.top;
  const ptile = canvas_pos_to_tile(touch_start_x, touch_start_y);
  set_mouse_touch_started_on_unit(ptile);
}

/****************************************************************************
  This function is triggered when ending a touch event on a touch device,
  eg finger up from screen.
****************************************************************************/
export function mapview_touch_end(e: TouchEvent): void {
  action_button_pressed(touch_start_x, touch_start_y, 'SELECT_POPUP');
}

/****************************************************************************
  This function is triggered on a touch move event on a touch device.
****************************************************************************/
export function mapview_touch_move(e: TouchEvent): void {
  const canvas = e.target as HTMLCanvasElement;
  const rect = canvas.getBoundingClientRect();

  mouse_x = e.touches[0].clientX - rect.left;
  mouse_y = e.touches[0].clientY - rect.top;

  const diff_x = (touch_start_x - mouse_x) * 2;
  const diff_y = (touch_start_y - mouse_y) * 2;

  touch_start_x = mouse_x;
  touch_start_y = mouse_y;

  if (!goto_active) {
    check_mouse_drag_unit(canvas_pos_to_tile(mouse_x, mouse_y));

    // Update mapview position - this will need to be connected to our mapview state
    // mapview['gui_x0'] += diff_x;
    // mapview['gui_y0'] += diff_y;
  }
}

/****************************************************************************
  Mouse move handler - updates mouse position
****************************************************************************/
export function update_mouse_position(
  e: MouseEvent,
  canvas: HTMLCanvasElement
): void {
  const rect = canvas.getBoundingClientRect();
  mouse_x = e.clientX - rect.left;
  mouse_y = e.clientY - rect.top;
}
