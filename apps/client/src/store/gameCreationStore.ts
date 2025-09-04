import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface GameCreationFormState {
  playerName: string;
  gameName: string;
  gameType: 'single' | 'multiplayer';
  maxPlayers: number;
  mapSize: string;
  selectedNation: string;
}

export interface TerrainSettings {
  generator: string;
  landmass: string;
  huts: number;
  temperature: number;
  wetness: number;
  rivers: number;
  resources: string;
  startpos?: number;
}

interface GameCreationStore {
  // Form state
  formData: GameCreationFormState;
  terrainSettings: TerrainSettings;

  // Hydration state
  _hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;

  // Actions
  updateFormData: (data: Partial<GameCreationFormState>) => void;
  updateTerrainSettings: (settings: Partial<TerrainSettings>) => void;
  resetFormData: () => void;
  resetTerrainSettings: () => void;
  resetAll: () => void;
}

const initialFormData: GameCreationFormState = {
  playerName: '',
  gameName: '',
  gameType: 'single',
  maxPlayers: 4,
  mapSize: 'standard',
  selectedNation: 'random',
};

const initialTerrainSettings: TerrainSettings = {
  generator: 'random',
  landmass: 'normal',
  huts: 15,
  temperature: 50,
  wetness: 50,
  rivers: 50,
  resources: 'normal',
  startpos: 0,
};

export const useGameCreationStore = create<GameCreationStore>()(
  persist(
    set => ({
      formData: initialFormData,
      terrainSettings: initialTerrainSettings,

      // Hydration state
      _hasHydrated: false,
      setHasHydrated: (state: boolean) => {
        set({ _hasHydrated: state });
      },

      updateFormData: (data: Partial<GameCreationFormState>) => {
        set(state => ({
          formData: { ...state.formData, ...data },
        }));
      },

      updateTerrainSettings: (settings: Partial<TerrainSettings>) => {
        set(state => ({
          terrainSettings: { ...state.terrainSettings, ...settings },
        }));
      },

      resetFormData: () => {
        set({ formData: initialFormData });
      },

      resetTerrainSettings: () => {
        set({ terrainSettings: initialTerrainSettings });
      },

      resetAll: () => {
        set({
          formData: initialFormData,
          terrainSettings: initialTerrainSettings,
        });
      },
    }),
    {
      name: 'game-creation-storage', // unique name for localStorage
      // Only persist form data, not terrain settings (they're quick to set)
      partialize: state => ({
        formData: state.formData,
      }),
      onRehydrateStorage: () => state => {
        if (state) {
          state.setHasHydrated(true);
        }
      },
    }
  )
);
