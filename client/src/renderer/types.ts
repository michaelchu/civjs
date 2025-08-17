/**
 * TypeScript type definitions for Freeciv-web globals
 * This replaces the original JavaScript global variables with typed equivalents
 */

// Global game state that would normally be managed by Freeciv-web
export interface FreecivGlobals {
  mapview_mouse_movement: boolean;
  goto_active: boolean;
  context_menu_active: boolean;
  keyboard_input: boolean;
  tiles: Record<number, any>;
  current_focus: any[];
  client: {
    conn: {
      playing: any;
    };
  };
}

// Create a global state object for Freeciv compatibility
export const freecivGlobals: FreecivGlobals = {
  mapview_mouse_movement: false,
  goto_active: false,
  context_menu_active: false,
  keyboard_input: true,
  tiles: {},
  current_focus: [],
  client: {
    conn: {
      playing: null,
    },
  },
};

// Mock implementations of Freeciv functions we don't need in React
export function init_game_unit_panel(): void {
  // UI handled by React
}

export function init_chatbox(): void {
  // UI handled by React
}

export function center_tile_mapcanvas(ptile: any): void {
  // Will be handled by our renderer
  console.log('center_tile_mapcanvas called with:', ptile);
}

export function set_mouse_touch_started_on_unit(tile: any): void {
  // Handle unit selection
  console.log('set_mouse_touch_started_on_unit:', tile);
}

export function check_mouse_drag_unit(tile: any): void {
  // Handle unit dragging
  console.log('check_mouse_drag_unit:', tile);
}

// Global callback for action button handling
export let actionButtonCallback:
  | ((x: number, y: number, type: any) => void)
  | null = null;

export function setActionButtonCallback(
  callback: (x: number, y: number, type: any) => void
): void {
  actionButtonCallback = callback;
}

export function action_button_pressed(x: number, y: number, type: any): void {
  // Handle tile clicks
  console.log('action_button_pressed:', x, y, type);

  // Call the registered callback if set
  if (actionButtonCallback) {
    actionButtonCallback(x, y, type);
  }
}

export function update_mouse_cursor(): void {
  // Handle cursor updates
}

export function popit(): boolean {
  // Handle middle click
  return false;
}

export function is_right_mouse_selection_supported(): boolean {
  return true;
}

export function is_touch_device(): boolean {
  return 'ontouchstart' in window;
}

export function get_tileset_file_extention(): string {
  return '.png';
}

export function preload_check(): void {
  // Handle sprite loading completion
}

export function setup_window_size(): void {
  // Window sizing handled by React
}

// Canvas position to tile conversion
export function canvas_pos_to_tile(x: number, y: number): any {
  // This will be implemented by our coordinate conversion
  return { x: Math.floor(x / 96), y: Math.floor(y / 48) };
}

export function map_select_units(x: number, y: number): void {
  // Handle unit selection rectangle
  console.log('map_select_units:', x, y);
}

export function recenter_button_pressed(x: number, y: number): void {
  // Handle map recentering
  console.log('recenter_button_pressed:', x, y);
}
