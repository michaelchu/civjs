import React from 'react';
import { BarChart3, Coins, FlaskConical, Map, Shield, Users } from 'lucide-react';
import type { City, Player, Tile, Unit } from '../../types';
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/Table';
import { HudDialogContent } from './HudDialogContent';

type Metric = 'population' | 'cities' | 'units' | 'territory';

interface DemographicsReportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  players: Record<string, Player>;
  cities: Record<string, City>;
  units: Record<string, Unit>;
  tiles: Record<string, Tile>;
  technologies: Record<string, { discovered: boolean }>;
  currentPlayerId: string;
}

interface DemographicRow {
  player: Player;
  population: number;
  cities: number;
  units: number;
  territory: number;
  science: number;
  gold: number;
  technologies: number | null;
}

const metricLabels: Record<Metric, string> = {
  population: 'Population',
  cities: 'Cities',
  units: 'Units',
  territory: 'Territory',
};

const metricIcons: Record<Metric, React.ElementType> = {
  population: Users,
  cities: Map,
  units: Shield,
  territory: BarChart3,
};

const formatNation = (nation: string): string =>
  nation
    .split(/[_-]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

const rowMetric = (row: DemographicRow, metric: Metric): number => row[metric];

export const DemographicsReport: React.FC<DemographicsReportProps> = ({
  open,
  onOpenChange,
  players,
  cities,
  units,
  tiles,
  technologies,
  currentPlayerId,
}) => {
  const [metric, setMetric] = React.useState<Metric>('population');

  const rows = React.useMemo<DemographicRow[]>(() => {
    const activePlayers = Object.values(players).filter(player => player.isActive);
    return activePlayers.map(player => {
      const playerCities = Object.values(cities).filter(city => city.playerId === player.id);
      const population = playerCities.reduce(
        (total, city) => total + (city.actualPopulation ?? city.size),
        0
      );
      return {
        player,
        population,
        cities: playerCities.length,
        units: Object.values(units).filter(unit => unit.playerId === player.id).length,
        territory: Object.values(tiles).filter(
          tile => tile.owner === player.id && (tile.known || tile.visible)
        ).length,
        science: player.sciencePerTurn ?? 0,
        gold: player.goldPerTurn ?? 0,
        technologies:
          player.id === currentPlayerId
            ? Object.values(technologies).filter(technology => technology.discovered).length
            : null,
      };
    });
  }, [cities, currentPlayerId, players, technologies, tiles, units]);

  const maxMetric = Math.max(...rows.map(row => rowMetric(row, metric)), 1);
  const MetricIcon = metricIcons[metric];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <HudDialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <BarChart3 className="h-5 w-5 text-cyan-300" aria-hidden="true" />
            Demographics
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Compare visible empire scale and economy. Territory and unit counts reflect information
            currently known to you.
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-slate-400">
            Demographic data is not available yet.
          </div>
        ) : (
          <div className="space-y-5">
            <div
              className="grid grid-cols-2 gap-2 sm:grid-cols-4"
              role="group"
              aria-label="Demographic metric"
            >
              {(Object.keys(metricLabels) as Metric[]).map(candidate => {
                const Icon = metricIcons[candidate];
                return (
                  <button
                    key={candidate}
                    type="button"
                    onClick={() => setMetric(candidate)}
                    aria-pressed={metric === candidate}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 ${
                      metric === candidate
                        ? 'border-cyan-300/35 bg-cyan-300/15 text-cyan-100'
                        : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {metricLabels[candidate]}
                  </button>
                );
              })}
            </div>

            <section
              aria-labelledby="demographic-bars-heading"
              className="rounded-xl border border-white/10 bg-slate-950/50 p-4"
            >
              <div className="mb-4 flex items-center gap-2">
                <MetricIcon className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                <h3 id="demographic-bars-heading" className="text-sm font-semibold text-slate-100">
                  {metricLabels[metric]} comparison
                </h3>
              </div>
              <div className="space-y-3">
                {[...rows]
                  .sort((left, right) => rowMetric(right, metric) - rowMetric(left, metric))
                  .map(row => {
                    const value = rowMetric(row, metric);
                    const width = `${Math.max((value / maxMetric) * 100, value > 0 ? 4 : 0)}%`;
                    return (
                      <div
                        key={row.player.id}
                        className="grid grid-cols-[minmax(6rem,9rem)_1fr_3rem] items-center gap-3 text-xs"
                      >
                        <span className="truncate text-slate-300">
                          {formatNation(row.player.nation)}
                        </span>
                        <div className="h-2 overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-400 transition-all"
                            style={{ width }}
                          />
                        </div>
                        <span className="text-right font-semibold tabular-nums text-slate-100">
                          {value}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </section>

            <section aria-labelledby="demographic-table-heading">
              <div className="mb-2 flex items-center gap-2">
                <Users className="h-4 w-4 text-violet-300" aria-hidden="true" />
                <h3 id="demographic-table-heading" className="text-sm font-semibold text-slate-100">
                  Empire comparison
                </h3>
              </div>
              <Table className="border-white/10">
                <TableHeader className="bg-slate-800">
                  <TableRow className="border-white/10 hover:bg-slate-800">
                    <TableHead className="text-slate-300">Civilization</TableHead>
                    <TableHead className="text-right text-slate-300">Population</TableHead>
                    <TableHead className="text-right text-slate-300">Cities</TableHead>
                    <TableHead className="text-right text-slate-300">Units</TableHead>
                    <TableHead className="text-right text-slate-300">Territory</TableHead>
                    <TableHead className="text-right text-slate-300">
                      <span className="inline-flex items-center gap-1">
                        <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" /> Science
                      </span>
                    </TableHead>
                    <TableHead className="text-right text-slate-300">
                      <span className="inline-flex items-center gap-1">
                        <Coins className="h-3.5 w-3.5" aria-hidden="true" /> Gold
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(row => (
                    <TableRow
                      key={row.player.id}
                      className={
                        row.player.id === currentPlayerId ? 'bg-cyan-400/10' : 'border-white/10'
                      }
                    >
                      <TableCell className="font-medium text-slate-100">
                        {formatNation(row.player.nation)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-300">
                        {row.population}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-300">
                        {row.cities}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-300">
                        {row.units}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-300">
                        {row.territory || '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-300">
                        {row.science >= 0 ? `+${row.science}` : row.science}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-300">
                        {row.gold >= 0 ? `+${row.gold}` : row.gold}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="mt-2 text-[10px] text-slate-500">
                Technology counts are intentionally limited to your researched catalogue; per-nation
                technology intelligence is not currently exposed by the backend.
              </p>
            </section>
          </div>
        )}
      </HudDialogContent>
    </Dialog>
  );
};
