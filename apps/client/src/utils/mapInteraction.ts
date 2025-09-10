/**
 * Map Interaction Utilities
 * Handles mouse/touch interaction logic for unit selection and focus
 * @reference freeciv-web/javascript/control.js click events and unit selection
 */

import type { Unit } from '../types';

export interface MapClickResult {
  action: 'select' | 'focus' | 'goto' | 'context' | 'none';
  unitIds: string[];
  tilePos: { x: number; y: number };
  multiSelect: boolean;
}

export interface ClickOptions {
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  button: number; // 0=left, 2=right
  isGotoMode: boolean;
}

/**
 * Determine what action should be taken based on map click
 * @reference freeciv-web/javascript/control.js mouse click handling logic
 */
export function determineMapClickAction(
  tileX: number,
  tileY: number,
  unitsAtTile: Unit[],
  currentPlayerId: string,
  currentFocus: string[],
  options: ClickOptions
): MapClickResult {
  const result: MapClickResult = {
    action: 'none',
    unitIds: [],
    tilePos: { x: tileX, y: tileY },
    multiSelect: options.shiftKey,
  };

  // Right-click always shows context menu or cancels goto
  if (options.button === 2) {
    result.action = options.isGotoMode ? 'goto' : 'context';
    result.unitIds = unitsAtTile.filter(u => u.playerId === currentPlayerId).map(u => u.id);
    return result;
  }

  // Left-click in goto mode = execute goto
  if (options.isGotoMode && options.button === 0) {
    result.action = 'goto';
    return result;
  }

  // Find player's units at this tile
  const playerUnitsAtTile = unitsAtTile.filter(u => u.playerId === currentPlayerId);

  if (playerUnitsAtTile.length === 0) {
    // No units at tile - clear selection unless shift-clicking
    result.action = options.shiftKey ? 'none' : 'select';
    return result;
  }

  // Determine which unit to select based on current focus and click behavior
  const selectedUnit = determineUnitToSelect(playerUnitsAtTile, currentFocus, options.shiftKey);

  result.action = options.shiftKey ? 'focus' : 'select';
  result.unitIds = selectedUnit ? [selectedUnit.id] : [];

  return result;
}

/**
 * Determine which unit to select when clicking on a tile with multiple units
 * @reference freeciv-web/javascript/control.js unit cycling logic
 */
function determineUnitToSelect(
  unitsAtTile: Unit[],
  currentFocus: string[],
  isShiftClick: boolean
): Unit | null {
  if (unitsAtTile.length === 0) return null;
  if (unitsAtTile.length === 1) return unitsAtTile[0];

  // If shift-clicking, just return the first unit for multi-select
  if (isShiftClick) {
    return unitsAtTile[0];
  }

  // Find currently focused unit at this tile
  const focusedUnitAtTile = unitsAtTile.find(u => currentFocus.includes(u.id));

  if (focusedUnitAtTile) {
    // Cycle to next unit after the focused one
    const currentIndex = unitsAtTile.indexOf(focusedUnitAtTile);
    const nextIndex = (currentIndex + 1) % unitsAtTile.length;
    return unitsAtTile[nextIndex];
  }

  // No focused unit at tile - select first one
  return unitsAtTile[0];
}

/**
 * Get units at a specific tile position
 */
export function getUnitsAtTile(units: Record<string, Unit>, tileX: number, tileY: number): Unit[] {
  return Object.values(units).filter(
    unit => Math.floor(unit.x) === tileX && Math.floor(unit.y) === tileY
  );
}

/**
 * Check if click should be ignored (too close to previous click, etc.)
 * @reference freeciv-web/javascript/control.js GOTO_CLICK_COOLDOWN logic
 */
export function shouldIgnoreClick(
  lastClickTime: number,
  lastClickTile: { x: number; y: number } | null,
  currentTile: { x: number; y: number },
  cooldownMs: number = 475
): boolean {
  const now = Date.now();

  // Check cooldown period
  if (now - lastClickTime < cooldownMs) {
    return true;
  }

  // Check if clicking same tile too quickly
  if (
    lastClickTile &&
    lastClickTile.x === currentTile.x &&
    lastClickTile.y === currentTile.y &&
    now - lastClickTime < cooldownMs
  ) {
    return true;
  }

  return false;
}

/**
 * Calculate if drag distance exceeds threshold
 */
export function exceedsDragThreshold(
  startPos: { x: number; y: number },
  currentPos: { x: number; y: number },
  threshold: number = 5
): boolean {
  const distance = Math.sqrt(
    Math.pow(currentPos.x - startPos.x, 2) + Math.pow(currentPos.y - startPos.y, 2)
  );
  return distance > threshold;
}
