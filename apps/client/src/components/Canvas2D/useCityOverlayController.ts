/**
 * @module client/components/Canvas2D/useCityOverlayController
 * Provides the useCityOverlayController canvas hook.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { gameClient } from '../../services/GameClient';
import type { City, ProductionOption } from '../../types';

interface CityOverlayState {
  isOpen: boolean;
  city: City | null;
}

interface ProductionState {
  availableProductions: ProductionOption[];
  isLoading: boolean;
  cityId: string | null;
  error: string | null;
}

const EMPTY_PRODUCTION: ProductionState = {
  availableProductions: [],
  isLoading: false,
  cityId: null,
  error: null,
};

export function useCityOverlayController(
  cities: Record<string, City>,
  selectCity: (cityId: string | null) => void
) {
  const [overlay, setOverlay] = useState<CityOverlayState>({ isOpen: false, city: null });
  const [production, setProduction] = useState<ProductionState>(EMPTY_PRODUCTION);
  const requestVersion = useRef(0);

  const open = useCallback(
    async (city: City) => {
      const version = ++requestVersion.current;
      selectCity(city.id);
      setOverlay({ isOpen: true, city });
      setProduction({
        availableProductions: [],
        isLoading: true,
        cityId: city.id,
        error: null,
      });
      try {
        const availableProductions = await gameClient.getAvailableProductions(city.id);
        if (version !== requestVersion.current) return;
        setProduction({ availableProductions, isLoading: false, cityId: city.id, error: null });
      } catch (error) {
        if (version !== requestVersion.current) return;
        setProduction({
          availableProductions: [],
          isLoading: false,
          cityId: city.id,
          error: error instanceof Error ? error.message : 'Failed to load production choices',
        });
      }
    },
    [selectCity]
  );

  const close = useCallback(() => {
    requestVersion.current++;
    selectCity(null);
    setOverlay({ isOpen: false, city: null });
    setProduction(EMPTY_PRODUCTION);
  }, [selectCity]);

  useEffect(() => {
    const handleShowCityInfo = (event: Event) => {
      const detail = (event as CustomEvent<{ city?: City; cityId?: string }>).detail;
      const city = detail?.city ?? (detail?.cityId ? cities[detail.cityId] : undefined);
      if (city) void open(city);
    };
    document.addEventListener('show-city-info', handleShowCityInfo);
    return () => document.removeEventListener('show-city-info', handleShowCityInfo);
  }, [cities, open]);

  const currentCity = overlay.city ? (cities[overlay.city.id] ?? overlay.city) : null;
  return {
    overlay: { ...overlay, city: currentCity },
    production,
    open,
    close,
    retry: () => currentCity && void open(currentCity),
  };
}
