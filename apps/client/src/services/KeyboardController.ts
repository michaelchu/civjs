/**
 * @module client/services/KeyboardController
 * Keyboard Controller Service
 * Handles global keyboard events and maps them to unit actions
 * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/control.js map_handle_key(), global_keyboard_listener()
 */

import { ActionType } from '../types/shared/actions';

export interface KeyModifiers {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

export interface KeyBinding {
  action: ActionType | 'special';
  specialAction?: string;
  requiresTarget?: boolean;
  description: string;
}

/**
 * Keyboard Controller for handling global game hotkeys
 * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/control.js keyboard handling system
 */
export class KeyboardController {
  private isActive = false;
  private keyBindings: Map<string, KeyBinding> = new Map();

  constructor() {
    this.initializeKeyBindings();
  }

  /**
   * Initialize key bindings from freeciv-web control.js
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/control.js map_handle_key() switch cases
   */
  private initializeKeyBindings(): void {
    // Basic unit actions
    this.keyBindings.set('f', {
      action: ActionType.FORTIFY,
      description: 'Fortify unit',
    });

    this.keyBindings.set('g', {
      action: 'special',
      specialAction: 'goto',
      description: 'Goto mode',
    });

    this.keyBindings.set('b', {
      action: ActionType.FOUND_CITY,
      description: 'Build city (or buy if over city)',
    });

    this.keyBindings.set('s', {
      action: ActionType.SENTRY,
      description: 'Sentry/Sleep unit',
    });

    this.keyBindings.set('p', {
      action: ActionType.PATROL,
      description: 'Patrol unit',
    });

    this.keyBindings.set('h', {
      action: ActionType.CHANGE_HOME_CITY,
      description: 'Set home city',
    });

    // Worker actions
    this.keyBindings.set('r', {
      action: ActionType.BUILD_ROAD,
      description: 'Build road',
    });

    this.keyBindings.set('shift+r', {
      action: ActionType.BUILD_RAILROAD,
      description: 'Build railroad',
    });

    this.keyBindings.set('i', {
      action: ActionType.BUILD_IRRIGATION,
      description: 'Build irrigation',
    });

    this.keyBindings.set('m', {
      action: ActionType.BUILD_MINE,
      description: 'Build mine',
    });

    this.keyBindings.set('shift+f', {
      action: ActionType.BUILD_FORTRESS,
      description: 'Build fortress',
    });

    this.keyBindings.set('o', {
      action: ActionType.TRANSFORM_TERRAIN,
      description: 'Transform terrain',
    });

    this.keyBindings.set('shift+o', {
      action: ActionType.CLEAN_POLLUTION,
      description: 'Clean pollution',
    });

    this.keyBindings.set('shift+p', {
      action: ActionType.PILLAGE,
      description: 'Pillage',
    });

    // Military actions
    this.keyBindings.set('shift+d', {
      action: ActionType.DISBAND_UNIT,
      description: 'Disband unit',
    });

    this.keyBindings.set('u', {
      action: ActionType.UPGRADE_UNIT,
      description: 'Upgrade unit',
    });

    // Automation
    this.keyBindings.set('x', {
      action: ActionType.AUTO_EXPLORE,
      description: 'Auto explore',
    });

    this.keyBindings.set('a', {
      action: ActionType.AUTO_SETTLER,
      description: 'Auto worker',
    });

    // Special actions
    this.keyBindings.set('w', {
      action: ActionType.WAIT,
      description: 'Wait/skip turn',
    });

    this.keyBindings.set('k', {
      action: ActionType.WAIT,
      description: 'Wait/skip turn',
    });

    this.keyBindings.set(' ', {
      action: 'special',
      specialAction: 'advance_focus',
      description: 'Advance unit focus',
    });

    this.keyBindings.set('d', {
      action: 'special',
      specialAction: 'action_select',
      requiresTarget: true,
      description: 'Action selection mode',
    });

    // Movement keys (arrow keys and numpad)
    this.keyBindings.set('ArrowUp', {
      action: 'special',
      specialAction: 'move_north',
      description: 'Move north',
    });

    this.keyBindings.set('ArrowDown', {
      action: 'special',
      specialAction: 'move_south',
      description: 'Move south',
    });

    this.keyBindings.set('ArrowLeft', {
      action: 'special',
      specialAction: 'move_west',
      description: 'Move west',
    });

    this.keyBindings.set('ArrowRight', {
      action: 'special',
      specialAction: 'move_east',
      description: 'Move east',
    });

    // Numpad movement (8-directional)
    this.keyBindings.set('Numpad8', {
      action: 'special',
      specialAction: 'move_north',
      description: 'Move north',
    });

    this.keyBindings.set('Numpad2', {
      action: 'special',
      specialAction: 'move_south',
      description: 'Move south',
    });

    this.keyBindings.set('Numpad4', {
      action: 'special',
      specialAction: 'move_west',
      description: 'Move west',
    });

    this.keyBindings.set('Numpad6', {
      action: 'special',
      specialAction: 'move_east',
      description: 'Move east',
    });

    this.keyBindings.set('Numpad7', {
      action: 'special',
      specialAction: 'move_northwest',
      description: 'Move northwest',
    });

    this.keyBindings.set('Numpad9', {
      action: 'special',
      specialAction: 'move_northeast',
      description: 'Move northeast',
    });

    this.keyBindings.set('Numpad1', {
      action: 'special',
      specialAction: 'move_southwest',
      description: 'Move southwest',
    });

    this.keyBindings.set('Numpad3', {
      action: 'special',
      specialAction: 'move_southeast',
      description: 'Move southeast',
    });
  }

  /**
   * Activate keyboard handling
   */
  activate(): void {
    if (!this.isActive) {
      document.addEventListener('keydown', this.handleKeyDown);
      this.isActive = true;
    }
  }

  /**
   * Deactivate keyboard handling
   */
  deactivate(): void {
    if (this.isActive) {
      document.removeEventListener('keydown', this.handleKeyDown);
      this.isActive = false;
    }
  }

  /**
   * Handle keydown events
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/control.js global_keyboard_listener()
   */
  private handleKeyDown = (event: KeyboardEvent): void => {
    // Skip if not in game state or if typing in input field
    if (this.shouldIgnoreEvent(event)) {
      return;
    }

    const modifiers: KeyModifiers = {
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
    };

    // Build key string including modifiers
    const keyString = this.buildKeyString(event.key, modifiers);

    // Look up key binding
    const binding = this.keyBindings.get(keyString) || this.keyBindings.get(event.key);

    // Debug logging for key events
    console.log('KeyboardController - Key pressed:', {
      key: event.key,
      keyString,
      binding: binding
        ? {
            action: binding.action,
            specialAction: binding.specialAction,
            description: binding.description,
          }
        : null,
      modifiers,
    });

    if (binding) {
      event.preventDefault();
      this.executeKeyBinding(binding, modifiers);
    }
  };

  /**
   * Check if keyboard event should be ignored
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/control.js global_keyboard_listener() input checks
   */
  private shouldIgnoreEvent(event: KeyboardEvent): boolean {
    // Ignore if meta key is pressed (OS/browser shortcuts)
    if (event.metaKey) {
      return true;
    }

    // Ignore if typing in input field
    const target = event.target as HTMLElement;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return true;
    }

    // Ignore if not on map tab (would check active tab here)
    // For now, assume we're always on map tab during game

    return false;
  }

  /**
   * Build key string with modifiers
   */
  private buildKeyString(key: string, modifiers: KeyModifiers): string {
    const parts: string[] = [];

    if (modifiers.ctrl) parts.push('ctrl');
    if (modifiers.alt) parts.push('alt');
    if (modifiers.shift) parts.push('shift');

    parts.push(key.toLowerCase());

    return parts.join('+');
  }

  /**
   * Execute a key binding
   */
  private executeKeyBinding(binding: KeyBinding, modifiers: KeyModifiers): void {
    if (binding.action === 'special') {
      this.executeSpecialAction(binding.specialAction!, modifiers);
    } else {
      this.executeUnitAction(binding.action, modifiers);
    }
  }

  /**
   * Execute special actions (non-unit actions)
   */
  private executeSpecialAction(action: string, modifiers: KeyModifiers): void {
    // Dispatch custom events for special actions
    const event = new CustomEvent('keyboard-action', {
      detail: { action, modifiers },
    });
    document.dispatchEvent(event);
  }

  /**
   * Execute unit actions
   */
  private executeUnitAction(action: ActionType, modifiers: KeyModifiers): void {
    console.log('KeyboardController - Dispatching unit action:', action, modifiers);

    // Dispatch custom events for unit actions
    const event = new CustomEvent('keyboard-unit-action', {
      detail: { action, modifiers },
    });
    document.dispatchEvent(event);
  }

  /**
   * Get all available key bindings for help/display
   */
  getKeyBindings(): Map<string, KeyBinding> {
    return new Map(this.keyBindings);
  }

  /**
   * Check if controller is active
   */
  isControllerActive(): boolean {
    return this.isActive;
  }
}

export const keyboardController = new KeyboardController();
