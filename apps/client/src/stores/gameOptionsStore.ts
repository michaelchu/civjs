/**
 * Game Options Store - Client-side game display options
 * Based on reference/freeciv-web options.js draw_borders functionality
 */

import { create } from 'zustand';
import type { BorderRenderOptions } from '../components/Canvas2D/renderers/BorderRenderer';

export interface GameOptions {
  // Border display options - ported from reference/freeciv-web/options.js:96
  drawBorders: boolean;
  borderWidth: number;
  borderAlpha: number;
  borderStyle: 'solid' | 'dashed';

  // Other rendering options for future expansion
  drawCities: boolean;
  drawUnits: boolean;
  drawTerrain: boolean;
  drawFogOfWar: boolean;
  drawResources: boolean;
}

interface GameOptionsState {
  options: GameOptions;
  updateOption: <K extends keyof GameOptions>(key: K, value: GameOptions[K]) => void;
  getBorderRenderOptions: () => BorderRenderOptions;
  resetToDefaults: () => void;
}

// Default options matching reference/freeciv-web defaults
const DEFAULT_OPTIONS: GameOptions = {
  drawBorders: true,
  borderWidth: 2,
  borderAlpha: 0.8,
  borderStyle: 'solid',
  drawCities: true,
  drawUnits: true,
  drawTerrain: true,
  drawFogOfWar: true,
  drawResources: true,
};

export const useGameOptionsStore = create<GameOptionsState>((set, get) => ({
  options: DEFAULT_OPTIONS,

  updateOption: <K extends keyof GameOptions>(key: K, value: GameOptions[K]) => {
    set(state => ({
      options: {
        ...state.options,
        [key]: value,
      },
    }));
  },

  getBorderRenderOptions: () => {
    const { options } = get();
    return {
      showBorders: options.drawBorders,
      borderWidth: options.borderWidth,
      borderAlpha: options.borderAlpha,
      borderStyle: options.borderStyle,
    };
  },

  resetToDefaults: () => {
    set({ options: DEFAULT_OPTIONS });
  },
}));

// Helper function to integrate with legacy freeciv-web global options
// This maintains compatibility while providing modern state management
export const syncWithFreecivWebOptions = () => {
  const globalOptions = (window as unknown as { client_options?: Record<string, unknown> })
    .client_options;
  if (globalOptions) {
    const store = useGameOptionsStore.getState();

    // Update our store with freeciv-web options if they exist
    const options = globalOptions as Record<string, unknown>;
    if (typeof options.draw_borders !== 'undefined') {
      store.updateOption('drawBorders', options.draw_borders as boolean);
    }
    if (typeof options.draw_cities !== 'undefined') {
      store.updateOption('drawCities', options.draw_cities as boolean);
    }
    if (typeof options.draw_units !== 'undefined') {
      store.updateOption('drawUnits', options.draw_units as boolean);
    }
    if (typeof options.draw_fog_of_war !== 'undefined') {
      store.updateOption('drawFogOfWar', options.draw_fog_of_war as boolean);
    }
    if (typeof options.draw_resources !== 'undefined') {
      store.updateOption('drawResources', options.draw_resources as boolean);
    }
  }
};

// Save options to localStorage for persistence
export const saveOptionsToStorage = () => {
  const { options } = useGameOptionsStore.getState();
  try {
    localStorage.setItem('civjs-game-options', JSON.stringify(options));
  } catch (error) {
    console.warn('Failed to save game options to localStorage:', error);
  }
};

// Load options from localStorage
export const loadOptionsFromStorage = () => {
  try {
    const stored = localStorage.getItem('civjs-game-options');
    if (stored) {
      const options = JSON.parse(stored) as GameOptions;
      useGameOptionsStore.setState({ options });
    }
  } catch (error) {
    console.warn('Failed to load game options from localStorage:', error);
  }
};
