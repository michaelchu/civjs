export interface UserPreferences {
  muted: boolean;
  volume: number;
  reducedMotion: boolean;
  disableFogOfWar: boolean;
  cityReportColumns?: string[];
  cityWorklistPresets?: CityWorklistPreset[];
}

export interface CityWorklistPreset {
  id: string;
  name: string;
  ruleset: string;
  items: Array<{
    productionId: string;
    type: 'unit' | 'building' | 'wonder';
  }>;
}

const STORAGE_KEY = 'civjs:user-preferences:v2';
const LEGACY_STORAGE_KEY = 'civjs:user-preferences:v1';
export const USER_PREFERENCES_CHANGED_EVENT = 'civjs-user-preferences-changed';
const defaults: UserPreferences = {
  muted: false,
  volume: 0.5,
  reducedMotion: false,
  disableFogOfWar: false,
  cityReportColumns: ['name', 'status', 'size', 'growth', 'resources', 'economy', 'production'],
  cityWorklistPresets: [],
};

export const loadUserPreferences = (): UserPreferences => {
  try {
    const stored = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY) || '{}'
    );
    return {
      muted: typeof stored.muted === 'boolean' ? stored.muted : defaults.muted,
      volume:
        typeof stored.volume === 'number'
          ? Math.max(0, Math.min(1, stored.volume))
          : defaults.volume,
      reducedMotion:
        typeof stored.reducedMotion === 'boolean' ? stored.reducedMotion : defaults.reducedMotion,
      disableFogOfWar:
        typeof stored.disableFogOfWar === 'boolean'
          ? stored.disableFogOfWar
          : defaults.disableFogOfWar,
      cityReportColumns: Array.isArray(stored.cityReportColumns)
        ? stored.cityReportColumns.filter((value: unknown) => typeof value === 'string')
        : defaults.cityReportColumns,
      cityWorklistPresets: Array.isArray(stored.cityWorklistPresets)
        ? stored.cityWorklistPresets.filter(
            (preset: unknown) =>
              Boolean(preset) &&
              typeof preset === 'object' &&
              typeof (preset as CityWorklistPreset).id === 'string' &&
              typeof (preset as CityWorklistPreset).name === 'string' &&
              Array.isArray((preset as CityWorklistPreset).items)
          )
        : defaults.cityWorklistPresets,
    };
  } catch {
    return defaults;
  }
};

export const saveUserPreferences = (preferences: UserPreferences): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  document.documentElement.classList.toggle('reduce-motion', preferences.reducedMotion);
  document.dispatchEvent(
    new CustomEvent<UserPreferences>(USER_PREFERENCES_CHANGED_EVENT, {
      detail: preferences,
    })
  );
};

export const playEndGameSound = (): void => {
  const preferences = loadUserPreferences();
  if (preferences.muted || preferences.volume === 0) return;
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 523.25;
    gain.gain.value = preferences.volume * 0.08;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.18);
    oscillator.addEventListener('ended', () => void context.close());
  } catch {
    // Sound is optional and may be blocked by browser autoplay policy.
  }
};
