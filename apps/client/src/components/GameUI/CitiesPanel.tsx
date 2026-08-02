import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Building2,
  CheckSquare2,
  ChevronDown,
  Coins,
  Columns3,
  Factory,
  Filter,
  FlaskConical,
  Gauge,
  Hammer,
  ListPlus,
  Search,
  Settings2,
  ShoppingCart,
  Sparkles,
  Trash2,
  Users,
  Wheat,
  X,
} from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { gameClient } from '../../services/GameClient';
import {
  loadUserPreferences,
  saveUserPreferences,
  type CityWorklistPreset,
} from '../../services/UserPreferences';
import type { City, CityBatchAction, CityBatchResult, ProductionOption } from '../../types';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/Table';
import { CityInfoOverlay } from './CityInfoOverlay';
import { BatchActionDialog, type BatchDialog } from './BatchActionDialog';

type ReportColumn =
  'status' | 'size' | 'growth' | 'resources' | 'economy' | 'units' | 'governor' | 'production';
type SortKey = 'name' | 'size' | 'growth' | 'food' | 'shields' | 'gold' | 'production';
type StatusFilter = 'all' | 'attention' | 'idle' | 'starving' | 'disorder' | 'governed';

const REPORT_COLUMNS: Array<{ id: ReportColumn; label: string }> = [
  { id: 'status', label: 'Status' },
  { id: 'size', label: 'Population' },
  { id: 'growth', label: 'Growth' },
  { id: 'resources', label: 'Resources' },
  { id: 'economy', label: 'Economy' },
  { id: 'units', label: 'Units' },
  { id: 'governor', label: 'Governor' },
  { id: 'production', label: 'Production' },
];

const defaultGovernor = {
  enabled: true,
  priority: 'balanced',
  autoManageSpecialists: true,
  autoManageTiles: true,
  autoManageProduction: false,
  preventStarvation: true,
  maintainHappiness: true,
};

/**
 * Sortable, filterable and batch-manageable empire report.
 * @reference reference/freeciv/client/cityrepdata.c
 * @reference reference/freeciv-web/javascript/city.js:4176-5077
 */
export const CitiesPanel: React.FC = () => {
  const cities = useGameStore(state => state.cities);
  const units = useGameStore(state => state.units);
  const currentPlayerId = useGameStore(state => state.currentPlayerId);
  const clientState = useGameStore(state => state.clientState);
  const rulesetName =
    (clientState as { config?: { ruleset?: string } } | null)?.config?.ruleset ?? 'civ2civ3';
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [productions, setProductions] = useState<ProductionOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [productionError, setProductionError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({
    key: 'name',
    descending: false,
  });
  const [visibleColumns, setVisibleColumns] = useState<Set<ReportColumn>>(() => {
    const saved =
      loadUserPreferences().cityReportColumns ?? REPORT_COLUMNS.map(column => column.id);
    return new Set(
      REPORT_COLUMNS.map(column => column.id).filter(column => saved.includes(column))
    );
  });
  const [batchDialog, setBatchDialog] = useState<BatchDialog>(null);
  const [batchProductionId, setBatchProductionId] = useState('');
  const [governorConfig, setGovernorConfig] = useState(defaultGovernor);
  const [sellBuildingId, setSellBuildingId] = useState('');
  const [worklistMode, setWorklistMode] = useState<'append' | 'replace'>('append');
  const [worklistDraft, setWorklistDraft] = useState<ProductionOption[]>([]);
  const [presetName, setPresetName] = useState('');
  const [presets, setPresets] = useState<CityWorklistPreset[]>(
    () => loadUserPreferences().cityWorklistPresets ?? []
  );
  const [batchRunning, setBatchRunning] = useState(false);

  const ownedCities = useMemo(
    () => Object.values(cities).filter(city => city.playerId === currentPlayerId),
    [cities, currentPlayerId]
  );
  const selectedCity = selectedCityId ? cities[selectedCityId] || null : null;
  const selectedCities = useMemo(
    () => ownedCities.filter(city => selectedIds.has(city.id)),
    [ownedCities, selectedIds]
  );
  const currentPlayer = useGameStore(state => state.players[currentPlayerId]);

  const summary = useMemo(
    () =>
      ownedCities.reduce(
        (totals, city) => ({
          population: totals.population + city.size,
          food: totals.food + city.surplus.food,
          shields: totals.shields + city.surplus.shields,
          gold: totals.gold + city.surplus.gold,
          science: totals.science + city.surplus.science,
          attention:
            totals.attention + Number(city.disorder || city.granaryTurns < 0 || !city.production),
        }),
        { population: 0, food: 0, shields: 0, gold: 0, science: 0, attention: 0 }
      ),
    [ownedCities]
  );

  const filteredCities = useMemo(() => {
    const lowerQuery = query.trim().toLowerCase();
    const matchesStatus = (city: City) => {
      switch (statusFilter) {
        case 'attention':
          return city.disorder || city.granaryTurns < 0 || !city.production;
        case 'idle':
          return !city.production;
        case 'starving':
          return city.granaryTurns < 0;
        case 'disorder':
          return city.disorder;
        case 'governed':
          return Boolean(city.governor?.isEnabled);
        default:
          return true;
      }
    };
    const value = (city: City): string | number => {
      switch (sort.key) {
        case 'size':
          return city.size;
        case 'growth':
          return city.granaryTurns;
        case 'food':
          return city.surplus.food;
        case 'shields':
          return city.surplus.shields;
        case 'gold':
          return city.surplus.gold;
        case 'production':
          return city.production?.turnsToComplete ?? Number.MAX_SAFE_INTEGER;
        default:
          return city.name.toLowerCase();
      }
    };
    return ownedCities
      .filter(
        city => (!lowerQuery || city.name.toLowerCase().includes(lowerQuery)) && matchesStatus(city)
      )
      .sort((left, right) => {
        const leftValue = value(left);
        const rightValue = value(right);
        const comparison =
          typeof leftValue === 'string'
            ? leftValue.localeCompare(String(rightValue))
            : leftValue - Number(rightValue);
        return sort.descending ? -comparison : comparison;
      });
  }, [ownedCities, query, sort, statusFilter]);

  const commonBuildings = useMemo(() => {
    const byId = new Map<string, string>();
    selectedCities.forEach(city =>
      city.buildings
        .filter(building => building.sellable)
        .forEach(building => byId.set(building.id, building.name))
    );
    return [...byId.entries()].sort((left, right) => left[1].localeCompare(right[1]));
  }, [selectedCities]);

  const loadProductions = async (city: City) => {
    setProductions([]);
    setLoading(true);
    setProductionError(null);
    try {
      const options = await gameClient.getAvailableProductions(city.id);
      setProductions(options);
      return options;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load production choices';
      setProductionError(message);
      return [];
    } finally {
      setLoading(false);
    }
  };

  const openCity = async (city: City) => {
    setSelectedCityId(city.id);
    setFeedback(null);
    await loadProductions(city);
  };

  const openBatchDialog = async (dialog: Exclude<BatchDialog, null>) => {
    setBatchDialog(dialog);
    setProductionError(null);
    if ((dialog === 'production' || dialog === 'worklist') && selectedCities[0]) {
      const options = await loadProductions(selectedCities[0]);
      const first = options.find(option => option.available);
      if (dialog === 'production') setBatchProductionId(first?.id ?? '');
    }
  };

  const updatePreferences = (
    columns: Set<ReportColumn> = visibleColumns,
    nextPresets: CityWorklistPreset[] = presets
  ) => {
    const preferences = loadUserPreferences();
    saveUserPreferences({
      ...preferences,
      cityReportColumns: ['name', ...columns],
      cityWorklistPresets: nextPresets,
    });
  };

  const toggleColumn = (column: ReportColumn) => {
    const next = new Set(visibleColumns);
    if (next.has(column)) next.delete(column);
    else next.add(column);
    setVisibleColumns(next);
    updatePreferences(next);
  };

  const runBatch = async (action: CityBatchAction) => {
    if (selectedIds.size === 0) return;
    setBatchRunning(true);
    try {
      const result = await gameClient.batchManageCities([...selectedIds], action);
      setFeedback(formatBatchResult(result));
      if (result.failed.length === 0) {
        setSelectedIds(new Set());
        setBatchDialog(null);
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Batch operation failed');
    } finally {
      setBatchRunning(false);
    }
  };

  const savePreset = () => {
    const name = presetName.trim();
    if (!name || worklistDraft.length === 0) return;
    const next = [
      ...presets,
      {
        id: crypto.randomUUID(),
        name,
        ruleset: rulesetName,
        items: worklistDraft.map(option => ({
          productionId: option.id,
          type: option.type,
        })),
      },
    ];
    setPresets(next);
    setPresetName('');
    updatePreferences(visibleColumns, next);
  };

  const toggleAllVisible = () => {
    const allSelected =
      filteredCities.length > 0 && filteredCities.every(city => selectedIds.has(city.id));
    const next = new Set(selectedIds);
    filteredCities.forEach(city => (allSelected ? next.delete(city.id) : next.add(city.id)));
    setSelectedIds(next);
  };

  const toggleCity = (cityId: string) => {
    const next = new Set(selectedIds);
    if (next.has(cityId)) next.delete(cityId);
    else next.add(cityId);
    setSelectedIds(next);
  };

  return (
    <section className="relative flex h-full min-h-0 flex-col overflow-hidden bg-slate-950 text-slate-100">
      <div className="border-b border-slate-800 bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950/60 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-indigo-300">
              <BarChart3 className="h-5 w-5" />
              <span className="text-xs font-semibold uppercase tracking-[0.18em]">
                Empire report
              </span>
            </div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">Cities</h2>
            <p className="mt-1 text-sm text-slate-400">
              Find pressure points, compare output, and manage cities together.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            <SummaryMetric icon={Building2} label="Cities" value={ownedCities.length} />
            <SummaryMetric icon={Users} label="Population" value={summary.population} />
            <SummaryMetric icon={Wheat} label="Food" value={signed(summary.food)} />
            <SummaryMetric icon={Hammer} label="Industry" value={summary.shields} />
            <SummaryMetric icon={Coins} label="Gold" value={signed(summary.gold)} />
            <SummaryMetric
              icon={AlertTriangle}
              label="Attention"
              value={summary.attention}
              warning={summary.attention > 0}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900/80 px-5 py-3">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <Input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search cities…"
            aria-label="Search cities"
            className="border-slate-700 bg-slate-950 pl-9 text-slate-100"
          />
        </div>
        <label className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
          <Filter className="h-4 w-4 text-slate-400" />
          <select
            value={statusFilter}
            onChange={event => setStatusFilter(event.target.value as StatusFilter)}
            className="bg-transparent text-slate-200 outline-none"
            aria-label="Filter cities by status"
          >
            <option value="all">All cities</option>
            <option value="attention">Needs attention</option>
            <option value="idle">Idle</option>
            <option value="starving">Starving</option>
            <option value="disorder">Disorder</option>
            <option value="governed">Governed</option>
          </select>
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="border-slate-700 bg-slate-950">
              <Columns3 className="mr-2 h-4 w-4" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {REPORT_COLUMNS.map(column => (
              <DropdownMenuItem key={column.id} onClick={() => toggleColumn(column.id)}>
                <span className="mr-2 w-4">{visibleColumns.has(column.id) ? '✓' : ''}</span>
                {column.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="ml-auto text-sm text-slate-400">
          {filteredCities.length} shown · {selectedIds.size} selected
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          className="mx-5 mt-3 flex items-center justify-between rounded-md border border-indigo-500/40 bg-indigo-950/60 px-4 py-2 text-sm text-indigo-100"
        >
          <span>{feedback}</span>
          <button onClick={() => setFeedback(null)} aria-label="Dismiss message">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-5 pb-24 pt-3">
        {ownedCities.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 text-slate-400">
            <Building2 className="mb-3 h-10 w-10 text-slate-600" />
            <p className="font-medium text-slate-300">Your empire has no cities yet</p>
            <p className="mt-1 text-sm">Found a city with Settlers to begin managing production.</p>
          </div>
        ) : (
          <Table className="min-w-[980px] border-slate-800 shadow-xl shadow-black/20">
            <TableHeader className="sticky top-0 z-20 bg-slate-900">
              <TableRow className="border-slate-800 hover:bg-slate-900">
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    checked={
                      filteredCities.length > 0 &&
                      filteredCities.every(city => selectedIds.has(city.id))
                    }
                    onChange={toggleAllVisible}
                    aria-label="Select all visible cities"
                    className="h-4 w-4 accent-indigo-500"
                  />
                </TableHead>
                <SortableHead label="City" sortKey="name" sort={sort} onSort={setSort} />
                {visibleColumns.has('status') && <TableHead>Status</TableHead>}
                {visibleColumns.has('size') && (
                  <SortableHead label="Size" sortKey="size" sort={sort} onSort={setSort} />
                )}
                {visibleColumns.has('growth') && (
                  <SortableHead label="Growth" sortKey="growth" sort={sort} onSort={setSort} />
                )}
                {visibleColumns.has('resources') && (
                  <SortableHead
                    label="Food / Prod / Trade"
                    sortKey="food"
                    sort={sort}
                    onSort={setSort}
                  />
                )}
                {visibleColumns.has('economy') && (
                  <SortableHead
                    label="Gold / Lux / Science"
                    sortKey="gold"
                    sort={sort}
                    onSort={setSort}
                  />
                )}
                {visibleColumns.has('units') && <TableHead>Units</TableHead>}
                {visibleColumns.has('governor') && <TableHead>Governor</TableHead>}
                {visibleColumns.has('production') && (
                  <SortableHead
                    label="Production"
                    sortKey="production"
                    sort={sort}
                    onSort={setSort}
                  />
                )}
                <TableHead className="w-24">{null}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCities.map(city => (
                <TableRow
                  key={city.id}
                  className={`border-slate-800 bg-slate-950/70 hover:bg-indigo-950/35 ${
                    selectedIds.has(city.id) ? 'bg-indigo-950/50' : ''
                  }`}
                >
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(city.id)}
                      onChange={() => toggleCity(city.id)}
                      aria-label={`Select ${city.name}`}
                      className="h-4 w-4 accent-indigo-500"
                    />
                  </TableCell>
                  <TableCell>
                    <button className="group text-left" onClick={() => void openCity(city)}>
                      <span className="font-semibold text-slate-100 group-hover:text-indigo-300">
                        {city.name}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        ({city.x}, {city.y})
                        {city.continentId !== undefined ? ` · Continent ${city.continentId}` : ''}
                      </span>
                    </button>
                  </TableCell>
                  {visibleColumns.has('status') && (
                    <TableCell>
                      <div className="flex max-w-40 flex-wrap gap-1">
                        {city.disorder && <Badge variant="destructive">Disorder</Badge>}
                        {city.granaryTurns < 0 && <Badge variant="destructive">Starving</Badge>}
                        {!city.production && (
                          <Badge className="border-amber-500/50 bg-amber-950 text-amber-200">
                            Idle
                          </Badge>
                        )}
                        {city.celebrating && (
                          <Badge className="border-emerald-500/50 bg-emerald-950 text-emerald-200">
                            Celebrating
                          </Badge>
                        )}
                        {!city.disorder &&
                          city.granaryTurns >= 0 &&
                          city.production &&
                          !city.celebrating && <span className="text-slate-500">Stable</span>}
                      </div>
                    </TableCell>
                  )}
                  {visibleColumns.has('size') && (
                    <TableCell>
                      <div className="text-lg font-semibold">{city.size}</div>
                      <div className="text-xs text-slate-500">
                        {city.actualPopulation?.toLocaleString() ?? '—'}
                      </div>
                    </TableCell>
                  )}
                  {visibleColumns.has('growth') && (
                    <TableCell>
                      <div className={city.granaryTurns < 0 ? 'text-rose-300' : 'text-slate-200'}>
                        {formatGrowth(city.granaryTurns)}
                      </div>
                      <div className="mt-1 h-1.5 w-20 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className={`h-full ${city.granaryTurns < 0 ? 'bg-rose-500' : 'bg-emerald-500'}`}
                          style={{
                            width: `${Math.min(100, (city.foodStock / Math.max(1, city.granarySize)) * 100)}%`,
                          }}
                        />
                      </div>
                    </TableCell>
                  )}
                  {visibleColumns.has('resources') && (
                    <TableCell>
                      <MetricTriplet
                        values={[city.surplus.food, city.surplus.shields, city.surplus.trade]}
                        icons={[Wheat, Hammer, Factory]}
                      />
                      {(city.waste.shields > 0 || city.waste.trade > 0) && (
                        <div className="mt-1 text-xs text-amber-300">
                          Waste {city.waste.shields} · Corruption {city.waste.trade}
                        </div>
                      )}
                    </TableCell>
                  )}
                  {visibleColumns.has('economy') && (
                    <TableCell>
                      <MetricTriplet
                        values={[city.surplus.gold, city.surplus.luxury, city.surplus.science]}
                        icons={[Coins, Sparkles, FlaskConical]}
                      />
                    </TableCell>
                  )}
                  {visibleColumns.has('units') && (
                    <TableCell>
                      <div className="text-sm">{city.presentUnits.length} present</div>
                      <div className="text-xs text-slate-500">
                        {city.supportedUnits.length} supported
                      </div>
                    </TableCell>
                  )}
                  {visibleColumns.has('governor') && (
                    <TableCell>
                      {city.governor?.isEnabled ? (
                        <Badge className="bg-cyan-950 text-cyan-200">
                          {city.governor.priority}
                        </Badge>
                      ) : (
                        <span className="text-slate-500">Manual</span>
                      )}
                    </TableCell>
                  )}
                  {visibleColumns.has('production') && (
                    <TableCell className="min-w-52">
                      {city.production ? (
                        <>
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate font-medium">
                              {city.production.name ?? city.production.target}
                            </span>
                            <span className="whitespace-nowrap text-xs text-slate-400">
                              {city.production.turnsToComplete}t
                            </span>
                          </div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-400"
                              style={{ width: `${city.production.percentComplete ?? 0}%` }}
                            />
                          </div>
                          <div className="mt-1 flex justify-between text-xs text-slate-500">
                            <span>
                              {city.production.progress}/{city.production.cost}
                            </span>
                            <span>{city.worklist.length} queued</span>
                          </div>
                        </>
                      ) : (
                        <button
                          className="flex items-center gap-2 font-medium text-amber-300 hover:text-amber-200"
                          onClick={() => void openCity(city)}
                        >
                          <AlertTriangle className="h-4 w-4" />
                          Choose production
                        </button>
                      )}
                    </TableCell>
                  )}
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => void openCity(city)}>
                      Manage
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {selectedIds.size > 0 && (
        <div className="absolute bottom-4 left-1/2 z-30 flex max-w-[calc(100%-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-xl border border-indigo-500/40 bg-slate-900/95 p-2 shadow-2xl shadow-black/50 backdrop-blur">
          <div className="flex items-center gap-2 px-2 text-sm font-semibold text-indigo-200">
            <CheckSquare2 className="h-4 w-4" />
            {selectedIds.size} selected
          </div>
          <Button size="sm" onClick={() => void openBatchDialog('production')}>
            <Hammer className="mr-1 h-4 w-4" /> Production
          </Button>
          <Button size="sm" variant="outline" onClick={() => void openBatchDialog('worklist')}>
            <ListPlus className="mr-1 h-4 w-4" /> Worklist
          </Button>
          <Button size="sm" variant="outline" onClick={() => void openBatchDialog('governor')}>
            <Settings2 className="mr-1 h-4 w-4" /> Governor
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={batchRunning}
            onClick={() => void runBatch({ action: 'optimize' })}
          >
            <Gauge className="mr-1 h-4 w-4" /> Optimize
          </Button>
          <Button size="sm" variant="outline" onClick={() => void openBatchDialog('buy')}>
            <ShoppingCart className="mr-1 h-4 w-4" /> Buy
          </Button>
          <Button size="sm" variant="outline" onClick={() => void openBatchDialog('sell')}>
            <Trash2 className="mr-1 h-4 w-4" /> Sell
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <BatchActionDialog
        kind={batchDialog}
        cityCount={selectedIds.size}
        productions={productions}
        loading={loading}
        error={productionError}
        batchRunning={batchRunning}
        productionId={batchProductionId}
        onProductionId={setBatchProductionId}
        governorConfig={governorConfig}
        onGovernorConfig={setGovernorConfig}
        commonBuildings={commonBuildings}
        sellBuildingId={sellBuildingId}
        onSellBuildingId={setSellBuildingId}
        worklistMode={worklistMode}
        onWorklistMode={setWorklistMode}
        worklistDraft={worklistDraft}
        onWorklistDraft={setWorklistDraft}
        presetName={presetName}
        onPresetName={setPresetName}
        presets={presets}
        onSavePreset={savePreset}
        onDeletePreset={presetId => {
          const next = presets.filter(preset => preset.id !== presetId);
          setPresets(next);
          updatePreferences(visibleColumns, next);
        }}
        onApplyPreset={preset => {
          setWorklistDraft(
            preset.items
              .map(item =>
                productions.find(
                  option => option.id === item.productionId && option.type === item.type
                )
              )
              .filter((option): option is ProductionOption => Boolean(option))
          );
        }}
        onClose={() => setBatchDialog(null)}
        onConfirm={() => {
          if (batchDialog === 'production') {
            const option = productions.find(item => item.id === batchProductionId);
            if (option)
              void runBatch({
                action: 'production',
                productionId: option.id,
                productionType: option.type,
              });
          } else if (batchDialog === 'worklist') {
            void runBatch({
              action: 'worklist',
              mode: worklistMode,
              items: worklistDraft.map(option => ({
                productionId: option.id,
                type: option.type,
              })),
            });
          } else if (batchDialog === 'governor') {
            void runBatch({ action: 'governor', config: governorConfig });
          } else if (batchDialog === 'buy') {
            void runBatch({ action: 'buy' });
          } else if (batchDialog === 'sell' && sellBuildingId) {
            void runBatch({ action: 'sellBuilding', buildingId: sellBuildingId });
          }
        }}
        totalBuyCost={selectedCities.reduce(
          (total, city) => total + (city.production?.buyCost ?? 0),
          0
        )}
        treasury={currentPlayer?.gold ?? 0}
      />

      <CityInfoOverlay
        city={selectedCity}
        isOpen={Boolean(selectedCity)}
        onClose={() => setSelectedCityId(null)}
        units={units}
        availableProductions={productions}
        isLoadingProductions={loading}
        productionError={productionError}
        onRetryProductions={() => selectedCity && void loadProductions(selectedCity)}
        onProductionChange={(cityId, productionId, type) =>
          void gameClient
            .changeProduction(cityId, productionId, type)
            .then(() => setFeedback('Production updated'))
            .catch(error => setFeedback(error instanceof Error ? error.message : 'Update failed'))
        }
        onQueueAdd={(cityId, productionId, type) =>
          gameClient.addCityWorklistItem(cityId, productionId, type)
        }
        onQueueRemove={(cityId, index) => gameClient.removeCityWorklistItem(cityId, index)}
        onQueueReorder={(cityId, fromIndex, toIndex) =>
          gameClient.reorderCityWorklist(cityId, fromIndex, toIndex)
        }
        onAssignCitizen={(cityId, x, y) => gameClient.assignCityCitizen(cityId, x, y)}
        onWorkerToSpecialist={(cityId, x, y, specialistType) =>
          gameClient.convertCityWorkerToSpecialist(cityId, x, y, specialistType)
        }
        onSpecialistToTile={(cityId, specialistType, x, y) =>
          gameClient.convertCitySpecialistToTile(cityId, specialistType, x, y)
        }
        onChangeSpecialist={(cityId, fromType, toType) =>
          gameClient.changeCitySpecialist(cityId, fromType, toType)
        }
        onRename={(cityId, name) => gameClient.renameCity(cityId, name)}
        onSellBuilding={(cityId, buildingId) => gameClient.sellCityBuilding(cityId, buildingId)}
        onDisband={cityId => gameClient.disbandCity(cityId)}
        onGovernorChange={(cityId, config) => gameClient.configureCityGovernor(cityId, config)}
        onOptimizeCitizens={cityId => gameClient.optimizeCityCitizens(cityId)}
        onBuyProduction={async cityId => {
          const result = await gameClient.buyCityProduction(cityId);
          setFeedback(
            `Spent ${result.goldSpent} gold${result.completed ? '; production completed' : ''}`
          );
        }}
        onSetRallyPoint={(cityId, rallyPoint) => gameClient.setCityRallyPoint(cityId, rallyPoint)}
      />
    </section>
  );
};

const SortableHead: React.FC<{
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; descending: boolean };
  onSort: (sort: { key: SortKey; descending: boolean }) => void;
}> = ({ label, sortKey, sort, onSort }) => (
  <TableHead>
    <button
      className="flex items-center gap-1 hover:text-indigo-300"
      onClick={() =>
        onSort({
          key: sortKey,
          descending: sort.key === sortKey ? !sort.descending : false,
        })
      }
    >
      {label}
      {sort.key === sortKey ? (
        sort.descending ? (
          <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUp className="h-3 w-3" />
        )
      ) : (
        <ChevronDown className="h-3 w-3 opacity-30" />
      )}
    </button>
  </TableHead>
);

const SummaryMetric: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  warning?: boolean;
}> = ({ icon: Icon, label, value, warning }) => (
  <div
    className={`min-w-20 rounded-lg border px-3 py-2 ${
      warning
        ? 'border-amber-500/40 bg-amber-950/60 text-amber-100'
        : 'border-slate-700 bg-slate-900/70'
    }`}
  >
    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-400">
      <Icon className="h-3 w-3" />
      {label}
    </div>
    <div className="mt-0.5 text-lg font-semibold">{value}</div>
  </div>
);

const MetricTriplet: React.FC<{
  values: number[];
  icons: Array<React.ComponentType<{ className?: string }>>;
}> = ({ values, icons }) => (
  <div className="flex gap-3">
    {values.map((value, index) => {
      const Icon = icons[index];
      return (
        <span
          key={index}
          className={`flex items-center gap-1 font-medium ${
            value < 0 ? 'text-rose-300' : value > 0 ? 'text-slate-100' : 'text-slate-500'
          }`}
        >
          <Icon className="h-3.5 w-3.5 text-slate-500" />
          {signed(value)}
        </span>
      );
    })}
  </div>
);

const signed = (value: number) => (value > 0 ? `+${value}` : String(value));
const formatGrowth = (turns: number) =>
  turns === 999 ? 'Stable' : turns < 0 ? `Famine ${Math.abs(turns)}t` : `${turns} turns`;
const formatBatchResult = (result: CityBatchResult) =>
  result.failed.length === 0
    ? `Updated ${result.succeeded.length} ${result.succeeded.length === 1 ? 'city' : 'cities'}`
    : `Updated ${result.succeeded.length}; ${result.failed.length} failed: ${result.failed
        .slice(0, 3)
        .map(item => item.reason)
        .join(', ')}`;
