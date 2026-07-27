import React, { useEffect, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { gameClient } from '../../services/GameClient';
import { Button } from '../ui/button';
import {
  loadUserPreferences,
  saveUserPreferences,
  type UserPreferences,
} from '../../services/UserPreferences';

type TaxRates = { tax: number; luxury: number; science: number };
type HostControls = { isHost: boolean; paused: boolean; turnTimeLimit: number };

export const GameOptionsPanel: React.FC = () => {
  const { map, turn, year, currentGameId } = useGameStore();
  const [rates, setRates] = useState<TaxRates>({ tax: 50, luxury: 20, science: 30 });
  const [feedback, setFeedback] = useState<string | null>(null);
  const [debugFeedback, setDebugFeedback] = useState<string | null>(null);
  const [hostControls, setHostControls] = useState<HostControls | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences>(loadUserPreferences);
  const total = rates.tax + rates.luxury + rates.science;

  useEffect(() => {
    saveUserPreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const requested = preferences.disableFogOfWar;
    void gameClient
      .setDebugVisibility(requested)
      .then(() => setDebugFeedback(null))
      .catch(error => {
        setDebugFeedback(
          error instanceof Error ? error.message : 'Failed to update debug visibility'
        );
        if (requested) {
          setPreferences(current => ({ ...current, disableFogOfWar: false }));
        }
      });
  }, [preferences.disableFogOfWar]);

  useEffect(() => {
    void gameClient
      .getTaxRates()
      .then(setRates)
      .catch(error =>
        setFeedback(error instanceof Error ? error.message : 'Failed to load tax rates')
      );
    void gameClient
      .getHostControls()
      .then(setHostControls)
      .catch(() => undefined);
  }, []);

  return (
    <section className="h-full overflow-y-auto bg-gray-900 p-6 text-white">
      <h2 className="text-2xl font-bold">Settings</h2>
      <p className="mt-1 text-sm text-gray-400">
        Configure this browser and inspect the current game's fixed settings.
      </p>

      {import.meta.env.DEV && (
        <div className="mt-6 max-w-3xl rounded-lg border border-amber-700/70 bg-gray-800 p-5">
          <h3 className="font-semibold">Map display</h3>
          <p className="mt-1 text-sm text-gray-400">
            Debug display preferences are stored only in this browser.
          </p>
          <label className="mt-4 flex items-start gap-3 text-sm text-gray-200">
            <input
              className="mt-0.5"
              type="checkbox"
              checked={preferences.disableFogOfWar}
              onChange={event =>
                setPreferences(current => ({
                  ...current,
                  disableFogOfWar: event.target.checked,
                }))
              }
            />
            <span>
              Disable fog of war (debug)
              <span className="mt-1 block text-xs text-amber-300">
                Reveals the complete terrain, units, cities, and borders.
              </span>
            </span>
          </label>
          {debugFeedback && (
            <p role="alert" className="mt-3 text-sm text-red-400">
              {debugFeedback}
            </p>
          )}
        </div>
      )}

      <h3 className="mt-6 font-semibold">Game information</h3>
      <dl className="mt-6 grid max-w-3xl gap-3 sm:grid-cols-2">
        <Info label="Game ID" value={currentGameId || '—'} />
        <Info label="Turn" value={String(turn)} />
        <Info label="Year" value={year === undefined ? '—' : String(year)} />
        <Info label="Map size" value={`${map.width} × ${map.height}`} />
      </dl>

      <div className="mt-8 max-w-3xl rounded-lg border border-gray-700 bg-gray-800 p-5">
        <h3 className="font-semibold">Trade allocation</h3>
        <p className="mt-1 text-sm text-gray-400">
          Divide city trade among taxes, luxuries, and science. The total must equal 100%.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {(['tax', 'luxury', 'science'] as const).map(rate => (
            <label key={rate} className="text-sm capitalize text-gray-300">
              {rate}
              <input
                className="mt-1 w-full rounded border border-gray-600 bg-gray-900 p-2"
                type="number"
                min={0}
                max={100}
                step={10}
                value={rates[rate]}
                onChange={event =>
                  setRates(current => ({
                    ...current,
                    [rate]: Number(event.target.value),
                  }))
                }
              />
            </label>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button
            disabled={total !== 100}
            onClick={() => {
              void gameClient
                .setTaxRates(rates)
                .then(savedRates => {
                  setRates(savedRates);
                  setFeedback('Trade allocation saved');
                })
                .catch(error =>
                  setFeedback(
                    error instanceof Error ? error.message : 'Failed to save trade allocation'
                  )
                );
            }}
          >
            Save allocation
          </Button>
          <span className={total === 100 ? 'text-sm text-green-400' : 'text-sm text-red-400'}>
            Total: {total}%
          </span>
        </div>
        {feedback && (
          <div role="status" className="mt-3 rounded bg-gray-900 p-3 text-sm text-gray-200">
            {feedback}
          </div>
        )}
      </div>

      <div className="mt-8 max-w-3xl rounded-lg border border-gray-700 bg-gray-800 p-5">
        <h3 className="font-semibold">Multiplayer policy</h3>
        <p className="mt-1 text-sm text-gray-400">
          Turns resolve simultaneously when every human is done or the authoritative timer expires.
          Disconnecting players keep their turn until that timeout.
        </p>
        {hostControls?.isHost && (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-sm text-gray-300">
              Turn timer (seconds)
              <input
                className="mt-1 block w-40 rounded border border-gray-600 bg-gray-900 p-2"
                type="number"
                min={10}
                max={3600}
                value={hostControls.turnTimeLimit}
                onChange={event =>
                  setHostControls(current =>
                    current ? { ...current, turnTimeLimit: Number(event.target.value) } : current
                  )
                }
              />
            </label>
            <Button
              onClick={() => {
                void gameClient
                  .setTurnTimeLimit(hostControls.turnTimeLimit)
                  .then(() => setFeedback('Turn timer updated'))
                  .catch(error =>
                    setFeedback(error instanceof Error ? error.message : 'Failed to update timer')
                  );
              }}
            >
              Save timer
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const paused = !hostControls.paused;
                void gameClient
                  .setGamePaused(paused)
                  .then(() => {
                    setHostControls(current => (current ? { ...current, paused } : current));
                    setFeedback(paused ? 'Game paused' : 'Game resumed');
                  })
                  .catch(error =>
                    setFeedback(
                      error instanceof Error ? error.message : 'Failed to update game state'
                    )
                  );
              }}
            >
              {hostControls.paused ? 'Resume game' : 'Pause game'}
            </Button>
          </div>
        )}
      </div>

      <div className="mt-8 max-w-3xl rounded-lg border border-gray-700 bg-gray-800 p-5">
        <h3 className="font-semibold">Accessibility and sound</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-3 text-sm text-gray-200">
            <input
              type="checkbox"
              checked={preferences.reducedMotion}
              onChange={event =>
                setPreferences(current => ({
                  ...current,
                  reducedMotion: event.target.checked,
                }))
              }
            />
            Reduce interface motion
          </label>
          <label className="flex items-center gap-3 text-sm text-gray-200">
            <input
              type="checkbox"
              checked={preferences.muted}
              onChange={event =>
                setPreferences(current => ({ ...current, muted: event.target.checked }))
              }
            />
            Mute game sounds
          </label>
          <label className="text-sm text-gray-200 sm:col-span-2">
            Sound volume: {Math.round(preferences.volume * 100)}%
            <input
              className="mt-2 block w-full"
              type="range"
              min={0}
              max={100}
              value={Math.round(preferences.volume * 100)}
              disabled={preferences.muted}
              onChange={event =>
                setPreferences(current => ({
                  ...current,
                  volume: Number(event.target.value) / 100,
                }))
              }
            />
          </label>
        </div>
      </div>

      <div className="mt-8 max-w-3xl rounded-lg border border-gray-700 bg-gray-800 p-5">
        <h3 className="font-semibold">Core controls</h3>
        <ul className="mt-3 grid gap-2 text-sm text-gray-300 sm:grid-cols-2">
          <li>Left click: select or focus</li>
          <li>Right click / long press: actions</li>
          <li>Arrow keys: move focused unit</li>
          <li>G: choose a Go To destination</li>
          <li>F1–F6: switch game screens</li>
          <li>Escape: cancel targeting</li>
        </ul>
      </div>
    </section>
  );
};

const Info: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
    <dt className="text-xs uppercase tracking-wide text-gray-400">{label}</dt>
    <dd className="mt-1 break-all font-medium">{value}</dd>
  </div>
);
