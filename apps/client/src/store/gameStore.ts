import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { GameState, ClientState, GameTab, MapViewport } from '../types';

interface GameStore extends GameState {
  // Client state
  clientState: ClientState;
  currentGameId: string | null;
  activeTab: GameTab;
  viewport: MapViewport;
  selectedUnitId: string | null;
  selectedCityId: string | null;

  // Actions
  setClientState: (state: ClientState) => void;
  setActiveTab: (tab: GameTab) => void;
  updateGameState: (partialState: Partial<GameState>) => void;
  setViewport: (viewport: Partial<MapViewport>) => void;
  selectUnit: (unitId: string | null) => void;
  selectCity: (cityId: string | null) => void;

  // Computed getters
  getCurrentPlayer: () => ReturnType<typeof getCurrentPlayer>;
  getSelectedUnit: () => ReturnType<typeof getSelectedUnit>;
  getSelectedCity: () => ReturnType<typeof getSelectedCity>;
}

// Helper functions for computed values
const getCurrentPlayer = (state: GameStore) => {
  return state.players[state.currentPlayerId] || null;
};

const getSelectedUnit = (state: GameStore) => {
  return state.selectedUnitId
    ? state.units[state.selectedUnitId] || null
    : null;
};

const getSelectedCity = (state: GameStore) => {
  return state.selectedCityId
    ? state.cities[state.selectedCityId] || null
    : null;
};

export const useGameStore = create<GameStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial game state
    turn: 0,
    phase: 'movement',
    players: {},
    currentPlayerId: '',
    map: (() => {
      // Create dummy map data for testing isometric rendering
      const dummyTiles: Record<string, any> = {};
      const terrains = ['grassland', 'plains', 'desert', 'forest', 'hills', 'mountains', 'ocean'];
      
      for (let x = 0; x < 20; x++) {
        for (let y = 0; y < 15; y++) {
          const terrain = terrains[Math.floor(Math.random() * terrains.length)];
          dummyTiles[`${x},${y}`] = {
            x, y, terrain,
            visible: true,
            known: true,
            units: [],
            city: undefined
          };
        }
      }
      
      console.log('🎯 DUMMY MAP INITIALIZED:', Object.keys(dummyTiles).length, 'tiles');
      
      return {
        width: 20,
        height: 15,
        tiles: dummyTiles,
      };
    })(),
    units: {},
    cities: {},
    technologies: {},

    // Initial client state
    clientState: 'initial',
    currentGameId: null,
    activeTab: 'map',
    viewport: {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      zoom: 1,
    },
    selectedUnitId: null,
    selectedCityId: null,

    // Actions
    setClientState: (state: ClientState) => {
      set({ clientState: state });
    },

    setActiveTab: (tab: GameTab) => {
      set({ activeTab: tab });
    },

    updateGameState: (partialState: Partial<GameState>) => {
      set(partialState);
    },

    setViewport: (viewport: Partial<MapViewport>) => {
      set(state => ({
        viewport: { ...state.viewport, ...viewport },
      }));
    },

    selectUnit: (unitId: string | null) => {
      set({ selectedUnitId: unitId });
    },

    selectCity: (cityId: string | null) => {
      set({ selectedCityId: cityId });
    },

    // Computed getters
    getCurrentPlayer: () => getCurrentPlayer(get()),
    getSelectedUnit: () => getSelectedUnit(get()),
    getSelectedCity: () => getSelectedCity(get()),
  }))
);
