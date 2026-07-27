import React, { useMemo, useState } from 'react';
import { Building2, Coins, FlaskConical, Hammer, Wheat } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { gameClient } from '../../services/GameClient';
import type { City, ProductionOption } from '../../types';
import { Button } from '../ui/button';
import { CityInfoOverlay } from './CityInfoOverlay';

/**
 * Discoverable city overview for the core play loop.
 * @reference reference/freeciv-web/javascript/city.js:277-990
 */
export const CitiesPanel: React.FC = () => {
  const cities = useGameStore(state => state.cities);
  const units = useGameStore(state => state.units);
  const currentPlayerId = useGameStore(state => state.currentPlayerId);
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const [productions, setProductions] = useState<ProductionOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const ownedCities = useMemo(
    () =>
      Object.values(cities)
        .filter(city => city.playerId === currentPlayerId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [cities, currentPlayerId]
  );
  const selectedCity = selectedCityId ? cities[selectedCityId] || null : null;

  const openCity = async (city: City) => {
    setSelectedCityId(city.id);
    setProductions([]);
    setLoading(true);
    setFeedback(null);
    try {
      setProductions(await gameClient.getAvailableProductions(city.id));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Failed to load production choices');
    } finally {
      setLoading(false);
    }
  };

  const changeProduction = async (
    cityId: string,
    productionId: string,
    type: 'unit' | 'building' | 'wonder'
  ) => {
    try {
      await gameClient.changeProduction(cityId, productionId, type);
      setFeedback('Production updated');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Failed to update production');
    }
  };

  return (
    <section className="h-full overflow-y-auto bg-gray-900 p-6 text-white">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Cities</h2>
          <p className="mt-1 text-sm text-gray-400">
            Review output, growth, happiness, trade routes, supported units, and production.
          </p>
        </div>
        <div className="rounded bg-gray-800 px-3 py-2 text-sm text-gray-300">
          {ownedCities.length} {ownedCities.length === 1 ? 'city' : 'cities'}
        </div>
      </div>

      {feedback && (
        <div role="status" className="mb-4 rounded border border-blue-700 bg-blue-950 p-3 text-sm">
          {feedback}
        </div>
      )}

      {ownedCities.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-700 p-10 text-center text-gray-400">
          Found a city with Settlers to begin managing your economy.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ownedCities.map(city => (
            <article key={city.id} className="rounded-lg border border-gray-700 bg-gray-800 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-amber-400" />
                  <h3 className="font-semibold">{city.name}</h3>
                </div>
                <span className="rounded bg-gray-700 px-2 py-1 text-xs">Size {city.size}</span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-sm">
                <CityMetric icon={Wheat} label="Food" value={city.surplus?.food} />
                <CityMetric icon={Hammer} label="Shields" value={city.surplus?.shields} />
                <CityMetric icon={Coins} label="Gold" value={city.surplus?.gold} />
                <CityMetric icon={FlaskConical} label="Science" value={city.surplus?.science} />
                <CityMetric label="Trade" value={city.prod?.trade} />
                <CityMetric label="Pollution" value={city.pollution} />
              </div>

              <div className="mt-4 text-sm text-gray-300">
                {city.production
                  ? `${city.production.target}: ${city.production.progress}/${city.production.cost} (${city.production.turnsToComplete} turns)`
                  : 'No production selected'}
              </div>

              <Button className="mt-4 w-full" onClick={() => void openCity(city)}>
                Manage city
              </Button>
            </article>
          ))}
        </div>
      )}

      <CityInfoOverlay
        city={selectedCity}
        isOpen={Boolean(selectedCity)}
        onClose={() => setSelectedCityId(null)}
        units={units}
        availableProductions={productions}
        isLoadingProductions={loading}
        onProductionChange={(cityId, productionId, type) =>
          void changeProduction(cityId, productionId, type)
        }
        onGovernorChange={(cityId, config) => gameClient.configureCityGovernor(cityId, config)}
        onOptimizeCitizens={cityId => gameClient.optimizeCityCitizens(cityId)}
        onBuyProduction={async cityId => {
          const result = await gameClient.buyCityProduction(cityId);
          setFeedback(
            `Spent ${result.goldSpent} gold${result.completed ? '; production completed' : ''}`
          );
        }}
      />
    </section>
  );
};

const CityMetric: React.FC<{
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value?: number;
}> = ({ icon: Icon, label, value }) => (
  <div className="rounded bg-gray-900 p-2">
    <div className="flex items-center gap-1 text-xs text-gray-400">
      {Icon && <Icon className="h-3 w-3" />}
      {label}
    </div>
    <div className={value !== undefined && value < 0 ? 'text-red-400' : 'text-gray-100'}>
      {value ?? '—'}
    </div>
  </div>
);
