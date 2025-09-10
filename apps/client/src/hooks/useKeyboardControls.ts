/**
 * Keyboard Controls Hook
 * Integrates KeyboardController with React and game state
 */

import { useEffect, useCallback } from 'react';
import { useGameStore } from '../store/gameStore';
import { gameClient } from '../services/GameClient';
import { keyboardController, type KeyModifiers } from '../services/KeyboardController';
import { ActionType } from '../types/shared/actions';

/**
 * Hook to handle keyboard controls integration
 */
export function useKeyboardControls() {
  const { focusedUnits, getPrimaryFocusedUnit, advanceUnitFocus, activeTab, clientState } =
    useGameStore();

  /**
   * Handle directional movement
   */
  const handleDirectionalMove = useCallback(
    async (direction: string) => {
      const unit = getPrimaryFocusedUnit();
      if (!unit) return;

      // Convert direction to coordinate offset
      const directionMap = {
        move_north: { dx: 0, dy: -1 },
        move_south: { dx: 0, dy: 1 },
        move_east: { dx: 1, dy: 0 },
        move_west: { dx: -1, dy: 0 },
        move_northeast: { dx: 1, dy: -1 },
        move_northwest: { dx: -1, dy: -1 },
        move_southeast: { dx: 1, dy: 1 },
        move_southwest: { dx: -1, dy: 1 },
      };

      const offset = directionMap[direction as keyof typeof directionMap];
      if (!offset) return;

      const newX = unit.x + offset.dx;
      const newY = unit.y + offset.dy;

      try {
        await gameClient.moveUnit(unit.id, newX, newY);
      } catch (error) {
        console.error(`Failed to move unit ${unit.id}:`, error);
      }
    },
    [getPrimaryFocusedUnit]
  );

  /**
   * Handle special keyboard actions (non-unit actions)
   */
  const handleSpecialAction = useCallback(
    (action: string, modifiers: KeyModifiers) => {
      console.log('Special action:', action, modifiers);

      switch (action) {
        case 'advance_focus': {
          advanceUnitFocus(modifiers.shift);
          break;
        }

        case 'goto': {
          // Activate goto mode for primary focused unit
          const primaryUnit = getPrimaryFocusedUnit();
          if (primaryUnit) {
            // Dispatch goto mode activation
            const event = new CustomEvent('activate-goto-mode', {
              detail: { unit: primaryUnit },
            });
            document.dispatchEvent(event);
          }
          break;
        }

        case 'action_select': {
          // Show action selection dialog
          const unit = getPrimaryFocusedUnit();
          if (unit) {
            const event = new CustomEvent('show-action-dialog', {
              detail: { unit },
            });
            document.dispatchEvent(event);
          }
          break;
        }

        // Movement actions
        case 'move_north':
        case 'move_south':
        case 'move_east':
        case 'move_west':
        case 'move_northeast':
        case 'move_northwest':
        case 'move_southeast':
        case 'move_southwest': {
          handleDirectionalMove(action);
          break;
        }

        default:
          console.warn('Unknown special action:', action);
      }
    },
    [getPrimaryFocusedUnit, advanceUnitFocus, handleDirectionalMove]
  );

  /**
   * Handle unit actions
   */
  const handleUnitAction = useCallback(
    async (action: ActionType, modifiers: KeyModifiers) => {
      console.log('Unit action:', action, modifiers);

      // Get focused units or primary unit
      const unitsToCommand = modifiers.shift
        ? focusedUnits
        : [getPrimaryFocusedUnit()?.id].filter(Boolean);

      if (unitsToCommand.length === 0) {
        console.log('No units focused for action:', action);
        return;
      }

      // Execute action for all focused units
      for (const unitId of unitsToCommand) {
        try {
          await gameClient.executeUnitAction(unitId!, action);
        } catch (error) {
          console.error(`Failed to execute ${action} for unit ${unitId}:`, error);
        }
      }
    },
    [focusedUnits, getPrimaryFocusedUnit]
  );

  /**
   * Set up event listeners for keyboard actions
   */
  useEffect(() => {
    const handleSpecialActionEvent = (event: CustomEvent) => {
      handleSpecialAction(event.detail.action, event.detail.modifiers);
    };

    const handleUnitActionEvent = (event: CustomEvent) => {
      handleUnitAction(event.detail.action, event.detail.modifiers);
    };

    document.addEventListener('keyboard-action', handleSpecialActionEvent as EventListener);
    document.addEventListener('keyboard-unit-action', handleUnitActionEvent as EventListener);

    return () => {
      document.removeEventListener('keyboard-action', handleSpecialActionEvent as EventListener);
      document.removeEventListener('keyboard-unit-action', handleUnitActionEvent as EventListener);
    };
  }, [handleSpecialAction, handleUnitAction]);

  /**
   * Activate/deactivate keyboard controller based on game state
   */
  useEffect(() => {
    const shouldActivate = clientState === 'running' && activeTab === 'map';

    if (shouldActivate && !keyboardController.isControllerActive()) {
      keyboardController.activate();
      console.log('Keyboard controls activated');
    } else if (!shouldActivate && keyboardController.isControllerActive()) {
      keyboardController.deactivate();
      console.log('Keyboard controls deactivated');
    }

    return () => {
      if (keyboardController.isControllerActive()) {
        keyboardController.deactivate();
      }
    };
  }, [clientState, activeTab]);

  return {
    keyboardController,
    isActive: keyboardController.isControllerActive(),
  };
}
