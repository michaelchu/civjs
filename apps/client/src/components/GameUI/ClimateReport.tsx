/**
 * @module client/components/GameUI/ClimateReport
 * Defines the Climate Report client UI component.
 */
import React from 'react';
import { Droplets, Mountain, Waves, Wind } from 'lucide-react';
import type { Tile } from '../../types';
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { HudDialogContent } from './HudDialogContent';

interface ClimateReportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tiles: Record<string, Tile>;
  mapWidth: number;
  mapHeight: number;
}

const waterTerrains = new Set(['ocean', 'deep_ocean', 'coast', 'lake']);
const terrainGroups: Array<{ id: string; label: string; terrains: Set<string>; color: string }> = [
  { id: 'water', label: 'Water', terrains: waterTerrains, color: 'from-sky-400 to-blue-600' },
  {
    id: 'temperate',
    label: 'Temperate land',
    terrains: new Set(['grassland', 'plains', 'forest', 'jungle', 'swamp']),
    color: 'from-emerald-400 to-green-600',
  },
  {
    id: 'arid',
    label: 'Arid / dry',
    terrains: new Set(['desert', 'oasis', 'savanna']),
    color: 'from-amber-300 to-orange-500',
  },
  {
    id: 'cold',
    label: 'Cold / tundra',
    terrains: new Set(['tundra', 'arctic', 'snow']),
    color: 'from-cyan-200 to-indigo-400',
  },
  {
    id: 'highland',
    label: 'Highland',
    terrains: new Set(['hills', 'mountains']),
    color: 'from-slate-300 to-slate-600',
  },
];

const formatTerrain = (terrain: string): string =>
  terrain
    .split(/[_-]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

export const ClimateReport: React.FC<ClimateReportProps> = ({
  open,
  onOpenChange,
  tiles,
  mapWidth,
  mapHeight,
}) => {
  const knownTiles = Object.values(tiles).filter(tile => tile.known || tile.visible);
  const terrainCounts = knownTiles.reduce<Record<string, number>>((counts, tile) => {
    counts[tile.terrain] = (counts[tile.terrain] ?? 0) + 1;
    return counts;
  }, {});
  const total = knownTiles.length;
  const waterCount = knownTiles.filter(tile => waterTerrains.has(tile.terrain)).length;
  const riverCount = knownTiles.filter(
    tile =>
      (tile.riverMask ?? 0) !== 0 ||
      tile.improvements?.some(improvement => improvement.toLowerCase() === 'river')
  ).length;
  const elevations = knownTiles.map(tile => tile.elevation ?? 0);
  const averageElevation = elevations.length
    ? Math.round(elevations.reduce((sum, value) => sum + value, 0) / elevations.length)
    : 0;
  const minElevation = elevations.length ? Math.min(...elevations) : 0;
  const maxElevation = elevations.length ? Math.max(...elevations) : 0;
  const terrainRows = Object.entries(terrainCounts).sort(([, left], [, right]) => right - left);
  const mapArea = Math.max(mapWidth * mapHeight, 0);
  const coverage = mapArea > 0 ? Math.min((total / mapArea) * 100, 100) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <HudDialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Wind className="h-5 w-5 text-cyan-300" aria-hidden="true" />
            Climate and terrain
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            A map-derived view of known terrain and elevation. Seasonal climate telemetry is not
            currently available.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="grid gap-3 sm:grid-cols-4" aria-label="Climate summary">
            <SummaryCard
              icon={Waves}
              label="Known water"
              value={`${waterCount}`}
              detail={
                total
                  ? `${Math.round((waterCount / total) * 100)}% of known tiles`
                  : 'No known tiles'
              }
            />
            <SummaryCard
              icon={Droplets}
              label="River tiles"
              value={`${riverCount}`}
              detail={
                total
                  ? `${Math.round((riverCount / total) * 100)}% of known tiles`
                  : 'No known tiles'
              }
            />
            <SummaryCard
              icon={Mountain}
              label="Elevation"
              value={`${averageElevation}`}
              detail={`Range ${minElevation}–${maxElevation}`}
            />
            <SummaryCard
              icon={Wind}
              label="Map coverage"
              value={`${Math.round(coverage)}%`}
              detail={`${total} of ${mapArea || '—'} tiles known`}
            />
          </section>

          <section
            className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-4"
            aria-label="Climate telemetry status"
          >
            <div className="flex items-start gap-3">
              <Wind className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
              <div>
                <h3 className="text-sm font-semibold text-amber-100">
                  Climate telemetry unavailable
                </h3>
                <p className="mt-1 text-xs leading-5 text-amber-100/70">
                  Temperature, precipitation, seasonal changes, and historical climate trends are
                  not part of the current server snapshot. This report intentionally limits itself
                  to observable terrain signals.
                </p>
              </div>
            </div>
          </section>

          <section aria-labelledby="terrain-distribution-heading">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3
                id="terrain-distribution-heading"
                className="text-sm font-semibold text-slate-100"
              >
                Terrain distribution
              </h3>
              <span className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                Known tiles
              </span>
            </div>
            <div className="space-y-3 rounded-xl border border-white/10 bg-slate-950/50 p-4">
              {terrainGroups.map(group => {
                const count = Object.entries(terrainCounts)
                  .filter(([terrain]) => group.terrains.has(terrain))
                  .reduce((sum, [, value]) => sum + value, 0);
                const width = total
                  ? `${Math.max((count / total) * 100, count > 0 ? 3 : 0)}%`
                  : '0%';
                return (
                  <div
                    key={group.id}
                    className="grid grid-cols-[minmax(7rem,10rem)_1fr_4rem] items-center gap-3 text-xs"
                  >
                    <span className="text-slate-300">{group.label}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={`h-full rounded-full bg-gradient-to-r ${group.color}`}
                        style={{ width }}
                      />
                    </div>
                    <span className="text-right tabular-nums text-slate-300">
                      {count}{' '}
                      <span className="text-slate-600">
                        ({total ? Math.round((count / total) * 100) : 0}%)
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="terrain-breakdown-heading">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 id="terrain-breakdown-heading" className="text-sm font-semibold text-slate-100">
                Terrain breakdown
              </h3>
              <span className="text-[10px] text-slate-500">
                {terrainRows.length} terrain types observed
              </span>
            </div>
            {terrainRows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/15 bg-white/5 p-5 text-sm text-slate-400">
                Terrain data is not available yet.
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {terrainRows.map(([terrain, count]) => (
                  <div
                    key={terrain}
                    className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs"
                  >
                    <span className="text-slate-300">{formatTerrain(terrain)}</span>
                    <span className="font-semibold tabular-nums text-slate-100">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </HudDialogContent>
    </Dialog>
  );
};

const SummaryCard: React.FC<{
  icon: React.ElementType;
  label: string;
  value: string;
  detail: string;
}> = ({ icon: Icon, label, value, detail }) => (
  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-slate-500">
      <Icon className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
      {label}
    </div>
    <div className="mt-2 text-xl font-semibold tabular-nums text-slate-100">{value}</div>
    <div className="mt-1 text-[10px] text-slate-500">{detail}</div>
  </div>
);
