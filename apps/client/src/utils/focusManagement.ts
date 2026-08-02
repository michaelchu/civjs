/**
 * @module client/utils/focusManagement
 * Focus Management Utilities
 * Handles multi-unit selection and focus advancement logic
 * @reference freeciv-web/javascript/control.js advance_unit_focus(), set_unit_focus()
 */

import type { Unit } from '../types';

export interface FocusState {
  focusedUnits: string[];
  urgentFocusQueue: string[];
  lastFocusedUnit: string | null;
}

export interface FocusCandidate {
  unit: Unit;
  priority: number;
  reason: 'urgent' | 'has_moves' | 'idle' | 'same_type';
}

/**
 * Find the best unit to focus on next
 * @reference freeciv-web/javascript/control.js find_best_focus_candidate()
 */
export function findBestFocusCandidate(
  units: Record<string, Unit>,
  currentPlayerId: string,
  acceptCurrent: boolean = false,
  sameType: boolean = false,
  currentFocus?: string[]
): Unit | null {
  const playerUnits = Object.values(units).filter(u => u.playerId === currentPlayerId);
  const candidates: FocusCandidate[] = [];

  for (const unit of playerUnits) {
    // Skip if unit is already in focus and we don't accept current
    if (!acceptCurrent && currentFocus?.includes(unit.id)) {
      continue;
    }

    // Filter by same type if requested
    if (sameType && currentFocus?.length) {
      const focusedUnit = units[currentFocus[0]];
      if (focusedUnit && unit.unitTypeId !== focusedUnit.unitTypeId) {
        continue;
      }
    }

    const priority = calculateUnitPriority(unit);
    if (priority > 0) {
      candidates.push({
        unit,
        priority,
        reason: getPriorityReason(unit, priority),
      });
    }
  }

  // Sort by priority (highest first)
  candidates.sort((a, b) => b.priority - a.priority);

  return candidates.length > 0 ? candidates[0].unit : null;
}

/**
 * Calculate unit priority for focus selection
 * Higher priority = more likely to be selected
 */
function calculateUnitPriority(unit: Unit): number {
  let priority = 0;

  // Units with movement left get highest priority
  if (unit.movesLeft > 0) {
    priority += 100;
  }

  // All units get base priority for focus cycling
  priority += 25;

  // Damaged units get slight priority boost for attention
  if (unit.hp < 100) {
    priority += 5;
  }

  return priority;
}

/**
 * Determine why a unit has a certain priority
 */
function getPriorityReason(_unit: Unit, priority: number): FocusCandidate['reason'] {
  if (priority >= 100) return 'has_moves';
  if (priority >= 50) return 'idle';
  return 'same_type';
}

/**
 * Add unit to focus list with proper validation
 * @reference freeciv-web/javascript/control.js click_unit_in_panel()
 */
export function addUnitToFocus(
  currentFocus: string[],
  unitId: string,
  multiSelect: boolean = false
): string[] {
  if (!multiSelect) {
    // Single selection - replace focus
    return [unitId];
  }

  // Multi-selection - toggle unit in focus
  const index = currentFocus.indexOf(unitId);
  if (index === -1) {
    // Add to focus
    return [...currentFocus, unitId];
  } else {
    // Remove from focus
    return currentFocus.filter(id => id !== unitId);
  }
}

/**
 * Remove unit from focus when it's destroyed or becomes invalid
 * @reference freeciv-web/javascript/control.js control_unit_killed()
 */
export function removeUnitFromFocus(
  currentFocus: string[],
  urgentQueue: string[],
  unitId: string
): { focus: string[]; urgentQueue: string[] } {
  return {
    focus: currentFocus.filter(id => id !== unitId),
    urgentQueue: urgentQueue.filter(id => id !== unitId),
  };
}

/**
 * Add unit to urgent focus queue
 * @reference freeciv-web/javascript/control.js unit_focus_urgent()
 */
export function addToUrgentFocus(urgentQueue: string[], unitId: string): string[] {
  if (!urgentQueue.includes(unitId)) {
    return [...urgentQueue, unitId];
  }
  return urgentQueue;
}

/**
 * Get units that should have visual focus indicators
 */
export function getVisuallyFocusedUnits(
  units: Record<string, Unit>,
  focusedUnits: string[]
): Unit[] {
  return focusedUnits.map(id => units[id]).filter(Boolean);
}

/**
 * Check if a unit can be focused (belongs to current player, exists, etc.)
 */
export function canFocusUnit(unit: Unit | undefined, currentPlayerId: string): boolean {
  return !!(unit && unit.playerId === currentPlayerId);
}
