/**
 * @module client/components/GameUI/CityInfoOverlay
 * Defines the City Info Overlay client UI component.
 */
import React, { useEffect, useState } from 'react';
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import {
  Building2,
  Users,
  Wheat,
  Shield,
  Hammer,
  MapPin,
  Heart,
  Frown,
  Smile,
  Zap,
  Coins,
  FlaskConical,
  Truck,
  Clock,
  BarChart3,
  Package2,
  Sword,
  Home,
  Plus,
  Trash2,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  Settings2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import type { City, Unit, ProductionOption } from '../../types';
import { HudDialogContent } from './HudDialogContent';
import { CityResourceCard } from './CityResourceCard';
import { CityHappinessTab } from './CityHappinessTab';

const SPECIALIST_IDS: Record<string, number> = {
  scientist: 0,
  taxman: 1,
  entertainer: 2,
};

interface CityInfoOverlayProps {
  city: City | null;
  isOpen: boolean;
  onClose: () => void;
  units?: Record<string, Unit>; // For displaying present/supported units
  availableProductions?: ProductionOption[]; // Real production data from server
  isLoadingProductions?: boolean; // Loading state for production data
  productionError?: string | null;
  onRetryProductions?: () => void;
  onProductionChange?: (
    cityId: string,
    productionId: string,
    type: 'unit' | 'building' | 'wonder'
  ) => void;
  onQueueAdd?: (cityId: string, productionId: string, type: 'unit' | 'building' | 'wonder') => void;
  onQueueRemove?: (cityId: string, index: number) => void;
  onQueueReorder?: (cityId: string, fromIndex: number, toIndex: number) => void;
  onAssignCitizen?: (cityId: string, x: number, y: number) => Promise<void>;
  onWorkerToSpecialist?: (
    cityId: string,
    x: number,
    y: number,
    specialistType: number
  ) => Promise<void>;
  onSpecialistToTile?: (
    cityId: string,
    specialistType: number,
    x: number,
    y: number
  ) => Promise<void>;
  onChangeSpecialist?: (cityId: string, fromType: number, toType: number) => Promise<void>;
  onRename?: (cityId: string, name: string) => Promise<void>;
  onSellBuilding?: (
    cityId: string,
    buildingId: string
  ) => Promise<{ goldReceived: number; remainingGold?: number }>;
  onDisband?: (cityId: string) => Promise<void>;
  onGovernorChange?: (
    cityId: string,
    config: {
      enabled: boolean;
      priority: string;
      autoManageSpecialists: boolean;
      autoManageTiles: boolean;
      autoManageProduction: boolean;
      preventStarvation: boolean;
      maintainHappiness: boolean;
    }
  ) => Promise<void>;
  onOptimizeCitizens?: (cityId: string) => Promise<void>;
  onBuyProduction?: (cityId: string) => Promise<void>;
  onSetRallyPoint?: (
    cityId: string,
    rallyPoint: { x: number; y: number; persistent: boolean } | null
  ) => Promise<void>;
}

/**
 * CityInfoOverlay displays comprehensive city information with tabbed interface.
 *
 * Based on freeciv-web's show_city_dialog functionality:
 * @reference freeciv-web/javascript/city.js:277-990
 * - Tabbed interface (Main, Production, Happy)
 * - Detailed resource breakdown with surplus/deficit indicators
 * - Population details (grain storage, growth time)
 * - Buildings with upkeep costs
 * - Units (present and supported)
 * - Citizens/specialists visualization
 *
 * Modern implementation with beautiful styling while maintaining game functionality.
 */
export const CityInfoOverlay: React.FC<CityInfoOverlayProps> = ({
  city,
  isOpen,
  onClose,
  units = {},
  availableProductions = [],
  isLoadingProductions = false,
  productionError = null,
  onRetryProductions,
  onProductionChange,
  onQueueAdd,
  onQueueRemove,
  onQueueReorder,
  onAssignCitizen,
  onWorkerToSpecialist,
  onSpecialistToTile,
  onChangeSpecialist,
  onRename,
  onSellBuilding,
  onDisband,
  onGovernorChange,
  onOptimizeCitizens,
  onBuyProduction,
  onSetRallyPoint,
}) => {
  const [activeTab, setActiveTab] = useState('main');
  const [governorEnabled, setGovernorEnabled] = useState(city?.governor?.isEnabled ?? false);
  const [governorPriority, setGovernorPriority] = useState(city?.governor?.priority ?? 'balanced');
  const [managementMessage, setManagementMessage] = useState<string | null>(null);
  const [cityName, setCityName] = useState(city?.name ?? '');
  const [confirmDisband, setConfirmDisband] = useState(false);
  const [rallyX, setRallyX] = useState('');
  const [rallyY, setRallyY] = useState('');
  const [rallyPersistent, setRallyPersistent] = useState(false);

  useEffect(() => {
    setGovernorEnabled(city?.governor?.isEnabled ?? false);
    setGovernorPriority(city?.governor?.priority ?? 'balanced');
    setManagementMessage(null);
    setCityName(city?.name ?? '');
    setConfirmDisband(false);
    setRallyX(city?.rallyPoint ? String(city.rallyPoint.x) : '');
    setRallyY(city?.rallyPoint ? String(city.rallyPoint.y) : '');
    setRallyPersistent(city?.rallyPoint?.persistent ?? false);
  }, [
    city?.id,
    city?.name,
    city?.governor?.isEnabled,
    city?.governor?.priority,
    city?.rallyPoint,
    city?.rallyPoint?.x,
    city?.rallyPoint?.y,
    city?.rallyPoint?.persistent,
  ]);

  if (!city) {
    return null;
  }

  const productionGroups = [
    {
      label: 'Units',
      options: availableProductions.filter(option => option.available && option.type === 'unit'),
    },
    {
      label: 'Buildings',
      options: availableProductions.filter(
        option => option.available && option.type === 'building' && !option.conversion
      ),
    },
    {
      label: 'Wonders',
      options: availableProductions.filter(option => option.available && option.type === 'wonder'),
    },
  ].filter(group => group.options.length > 0);
  const conversionOptions = availableProductions.filter(
    option => option.available && option.conversion
  );
  const shieldsPerTurn = Math.max(1, city.surplus?.shields ?? 0);

  const getProductionTurns = (option: ProductionOption) => Math.ceil(option.cost / shieldsPerTurn);

  const renderProductionItem = (
    option: ProductionOption,
    onSelect: (option: ProductionOption) => void
  ) => (
    <DropdownMenuItem
      key={option.id}
      onClick={() => onSelect(option)}
      className="flex items-center justify-between text-slate-100 hover:bg-slate-800 hover:text-white focus:bg-slate-800 focus:text-white"
    >
      <div>
        <div className="font-medium">{option.name}</div>
        <div className="text-xs text-slate-400">{option.description}</div>
      </div>
      {!option.conversion && (
        <span className="text-xs">
          {getProductionTurns(option)} {getProductionTurns(option) === 1 ? 'turn' : 'turns'}
        </span>
      )}
    </DropdownMenuItem>
  );

  const renderProductionGroups = (
    onSelect: (option: ProductionOption) => void
  ): React.ReactNode[] =>
    productionGroups.flatMap((group, groupIndex) => [
      ...(groupIndex > 0 ? [<DropdownMenuSeparator key={`${group.label}-separator`} />] : []),
      <React.Fragment key={group.label}>
        <DropdownMenuLabel className="text-xs text-slate-400">{group.label}</DropdownMenuLabel>
        {group.options.map(option => renderProductionItem(option, onSelect))}
      </React.Fragment>,
    ]);

  const renderConversionOptions = (onSelect: (option: ProductionOption) => void) =>
    conversionOptions.length > 0 ? (
      <>
        {productionGroups.length > 0 && <DropdownMenuSeparator />}
        {conversionOptions.map(option => renderProductionItem(option, onSelect))}
      </>
    ) : null;

  // Helper functions for data access - server data only, no calculations
  const getCityData = () => {
    // Server must provide all production and surplus data
    const prod = city.prod || null;
    const surplus = city.surplus || null;
    const citizens = city.citizens || null;
    const waste = city.waste || null;

    // Buildings should come from server with proper structure
    const buildings = Array.isArray(city.buildings) ? city.buildings : [];

    // Server-provided values only - no fallbacks
    const granarySize = city.granarySize;
    const foodStock = city.foodStock;
    const granaryTurns = city.granaryTurns;

    return {
      prod,
      surplus,
      citizens,
      waste,
      buildings,
      foodStock,
      granarySize,
      granaryTurns,
      celebrating: city.celebrating || false,
      disorder: city.disorder || false,
      pollution: city.pollution || 0,
      presentUnits: city.presentUnits || [],
      supportedUnits: city.supportedUnits || [],
      worklist: city.worklist || [],
      tradeRoutes: city.tradeRoutes || [],
      rallyPoint: city.rallyPoint,
    };
  };

  const cityData = getCityData();

  const formatGrowthText = () => {
    if (cityData.granaryTurns === undefined || cityData.granaryTurns === null) return '--';
    if (cityData.granaryTurns >= 999) return 'No growth';
    if (cityData.granaryTurns < 0) {
      // Server should provide negative values correctly formatted
      return `Starves in ${-cityData.granaryTurns} turns`;
    }
    if (cityData.granaryTurns === 0) return 'Blocked';
    return `Growth in ${cityData.granaryTurns} turns`;
  };

  const getCityStateInfo = () => {
    if (cityData.celebrating)
      return { text: 'Celebrating', color: 'text-emerald-300', icon: Heart };
    if (cityData.disorder) return { text: 'Disorder', color: 'text-rose-300', icon: Frown };
    return { text: 'Peace', color: 'text-cyan-300', icon: Smile };
  };

  const presentUnits = cityData.presentUnits?.map(id => units[id]).filter(Boolean) || [];
  const supportedUnits = cityData.supportedUnits?.map(id => units[id]).filter(Boolean) || [];
  const isWealthProduction = city.production?.target === 'capitalization';
  const stateInfo = getCityStateInfo();
  const StateIcon = stateInfo.icon;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <HudDialogContent className="h-[580px] min-h-[500px] max-h-[85vh] max-w-4xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Building2 className="h-6 w-6" />
            {city.name} ({city.size})
          </DialogTitle>
          <DialogDescription asChild>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                Position ({city.x}, {city.y})
              </div>
              <div className="flex items-center gap-1">
                <Users className="h-4 w-4" />
                Size: {city.size}
              </div>
              <div className={`flex items-center gap-1 ${stateInfo.color}`}>
                <StateIcon className="h-4 w-4" />
                {stateInfo.text}
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="w-full flex flex-col flex-1 min-h-0"
        >
          <TabsList className="grid w-full grid-cols-4 bg-slate-800/80 text-slate-400">
            <TabsTrigger
              value="main"
              className="flex items-center gap-2 text-slate-400 data-[state=active]:bg-slate-700 data-[state=active]:text-white"
            >
              <Home className="h-4 w-4" />
              Main
            </TabsTrigger>
            <TabsTrigger
              value="production"
              className="flex items-center gap-2 text-slate-400 data-[state=active]:bg-slate-700 data-[state=active]:text-white"
            >
              <Package2 className="h-4 w-4" />
              Production
            </TabsTrigger>
            <TabsTrigger
              value="happiness"
              className="flex items-center gap-2 text-slate-400 data-[state=active]:bg-slate-700 data-[state=active]:text-white"
            >
              <Heart className="h-4 w-4" />
              Happiness
            </TabsTrigger>
            <TabsTrigger
              value="management"
              className="flex items-center gap-2 text-slate-400 data-[state=active]:bg-slate-700 data-[state=active]:text-white"
            >
              <Settings2 className="h-4 w-4" />
              Manage
            </TabsTrigger>
          </TabsList>

          <TabsContent value="main" className="space-y-4 flex-1 overflow-y-auto min-h-0 p-1">
            {/* Population Status */}
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border border-cyan-700/50 bg-cyan-950/30 p-4">
                <h3 className="mb-2 flex items-center gap-2 font-medium text-cyan-200">
                  <Users className="h-4 w-4" />
                  Population
                </h3>
                <div className="space-y-1 text-sm">
                  <div>
                    Size: <span className="font-semibold">{city.size}</span>
                  </div>
                  <div>
                    Granary:{' '}
                    <span className="font-semibold">
                      {city.foodStock ?? '--'}/{city.granarySize ?? '--'}
                    </span>
                  </div>
                  <div className="text-xs text-cyan-300">{formatGrowthText()}</div>
                </div>
              </div>

              {/* Current Production */}
              {city.production && (
                <div className="rounded-lg border border-indigo-700/50 bg-indigo-950/30 p-4">
                  <h3 className="mb-2 flex items-center gap-2 font-medium text-indigo-200">
                    <Hammer className="h-4 w-4" />
                    Production
                  </h3>
                  <div className="space-y-2">
                    {isWealthProduction ? (
                      <div className="rounded-md border border-indigo-700/50 bg-slate-900/70 p-3 text-sm text-indigo-200">
                        <div className="font-medium text-white">Wealth</div>
                        Converts this city&apos;s shield production to gold each turn.
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm">
                            {city.production.name ?? city.production.target}
                          </span>
                          <Badge variant="secondary" className="capitalize text-xs">
                            {city.production.type}
                          </Badge>
                        </div>
                        <div className="h-2 w-full rounded-full bg-slate-700">
                          <div
                            className="h-2 rounded-full bg-indigo-400 transition-all duration-300"
                            style={{
                              width: `${city.production.percentComplete || 0}%`,
                            }}
                          />
                        </div>
                        <div className="flex justify-between text-xs text-indigo-300">
                          <span>
                            {city.production.progress}/{city.production.cost}
                          </span>
                          <span>{city.production.turnsToComplete} turns</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Resource Breakdown */}
            <div>
              <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
                <BarChart3 className="h-4 w-4" />
                Resource Output & Surplus
              </h3>
              <div className="mb-4 grid grid-cols-3 gap-3">
                <CityResourceCard
                  label="Food"
                  value={cityData.surplus?.food}
                  baseValue={cityData.prod?.food}
                  icon={Wheat}
                />
                <CityResourceCard
                  label="Shields"
                  value={cityData.surplus?.shields}
                  baseValue={cityData.prod?.shields}
                  icon={Shield}
                />
                <CityResourceCard
                  label="Trade"
                  value={cityData.surplus?.trade}
                  baseValue={cityData.prod?.trade}
                  icon={Truck}
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <CityResourceCard label="Gold" value={cityData.surplus?.gold} icon={Coins} />
                <CityResourceCard label="Luxury" value={cityData.surplus?.luxury} icon={Zap} />
                <CityResourceCard
                  label="Science"
                  value={cityData.surplus?.science}
                  icon={FlaskConical}
                />
              </div>

              {/* Waste/Corruption */}
              {cityData.waste && (cityData.waste.shields > 0 || cityData.waste.trade > 0) && (
                <div className="mt-3 rounded-lg border border-amber-700/50 bg-amber-950/30 p-3">
                  <h4 className="mb-2 text-sm font-medium text-amber-200">Waste & Corruption</h4>
                  <div className="flex gap-4 text-sm">
                    {cityData.waste.shields > 0 && (
                      <div>
                        Shield waste:{' '}
                        <span className="font-semibold text-rose-300">
                          {cityData.waste.shields}
                        </span>
                      </div>
                    )}
                    {cityData.waste.trade > 0 && (
                      <div>
                        Trade corruption:{' '}
                        <span className="font-semibold text-rose-300">{cityData.waste.trade}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <Separator />

            {/* Buildings Section */}
            {cityData.buildings && cityData.buildings.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Buildings ({cityData.buildings.length})
                </h3>
                <div className="space-y-2 h-36 overflow-y-auto">
                  {cityData.buildings.map((building, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between rounded border border-slate-700 bg-slate-800/60 p-3 transition-colors hover:bg-slate-800"
                    >
                      <span className="text-sm font-medium">{building.name}</span>
                      <div className="flex items-center gap-2">
                        {building.upkeep > 0 && (
                          <div className="flex items-center gap-1 text-xs text-rose-300">
                            <Coins className="h-3 w-3" />
                            {building.upkeep}
                          </div>
                        )}
                        {onSellBuilding && building.sellable && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              void onSellBuilding(city.id, building.id)
                                .then(result =>
                                  setManagementMessage(
                                    `Sold ${building.name} for ${result.goldReceived} gold`
                                  )
                                )
                                .catch(error =>
                                  setManagementMessage(
                                    error instanceof Error ? error.message : 'Building sale failed'
                                  )
                                );
                            }}
                          >
                            Sell
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Units Section */}
            {(presentUnits.length > 0 || supportedUnits.length > 0) && (
              <>
                <Separator />
                <div className="grid grid-cols-2 gap-4">
                  {/* Present Units */}
                  {presentUnits.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                        <Home className="h-4 w-4" />
                        Present Units ({presentUnits.length})
                      </h3>
                      <div className="space-y-2 h-28 overflow-y-auto">
                        {presentUnits.map(unit => (
                          <div
                            key={unit.id}
                            className="flex items-center justify-between rounded border border-emerald-700/50 bg-emerald-950/30 p-2 text-sm"
                          >
                            <span>{unit.unitTypeId}</span>
                            <div className="flex items-center gap-2 text-xs text-emerald-300">
                              <span>HP: {unit.hp}</span>
                              <span>Moves: {unit.movesLeft}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Supported Units */}
                  {supportedUnits.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                        <Sword className="h-4 w-4" />
                        Supported Units ({supportedUnits.length})
                      </h3>
                      <div className="space-y-2 h-28 overflow-y-auto">
                        {supportedUnits.map(unit => (
                          <div
                            key={unit.id}
                            className="flex items-center justify-between rounded border border-cyan-700/50 bg-cyan-950/30 p-2 text-sm"
                          >
                            <span>{unit.unitTypeId}</span>
                            <div className="flex items-center gap-2 text-xs text-cyan-300">
                              <span>HP: {unit.hp}</span>
                              <span>Vet: {unit.veteranLevel}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="production" className="space-y-4 flex-1 overflow-y-auto min-h-0 p-1">
            {/* Current Production */}
            <div className="rounded-lg border border-indigo-700/50 bg-indigo-950/30 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="flex items-center gap-2 font-medium text-indigo-200">
                  <Hammer className="h-4 w-4" />
                  Current Production
                </h3>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={isLoadingProductions || Boolean(productionError)}
                    >
                      {isLoadingProductions ? 'Loading...' : 'Change'}{' '}
                      <ChevronDown className="h-3 w-3 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="max-h-[min(32rem,var(--radix-dropdown-menu-content-available-height))] w-72 overscroll-contain overflow-y-auto"
                  >
                    <DropdownMenuLabel className="text-slate-200">
                      Select Production
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />

                    {isLoadingProductions ? (
                      <DropdownMenuItem disabled>
                        <span className="text-sm text-slate-400">
                          Loading production options...
                        </span>
                      </DropdownMenuItem>
                    ) : (
                      <>
                        {renderProductionGroups(option =>
                          onProductionChange?.(city.id, option.id, option.type)
                        )}
                        {renderConversionOptions(option =>
                          onProductionChange?.(city.id, option.id, option.type)
                        )}
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {productionError ? (
                <div className="flex items-center justify-between gap-3 rounded-md border border-amber-700/50 bg-amber-950/40 p-3 text-sm text-amber-200">
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {productionError}
                  </span>
                  {onRetryProductions && (
                    <Button variant="outline" size="sm" onClick={onRetryProductions}>
                      <RefreshCw className="mr-1 h-3 w-3" />
                      Retry
                    </Button>
                  )}
                </div>
              ) : !isLoadingProductions && availableProductions.length === 0 ? (
                <div className="rounded-md border border-dashed border-indigo-700/60 p-4 text-sm text-indigo-200">
                  No production choices were returned for this city.
                </div>
              ) : city.production ? (
                <div className="space-y-3">
                  {city.production.conversion || city.production.target === 'capitalization' ? (
                    <div className="rounded-md border border-indigo-700/50 bg-slate-900/70 p-4">
                      <div className="font-medium text-white">Wealth</div>
                      <p className="mt-1 text-sm text-indigo-200">
                        Converts this city&apos;s shield production to gold each turn.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          {city.production.name ?? city.production.target}
                        </span>
                        <Badge variant="secondary" className="capitalize">
                          {city.production.type}
                        </Badge>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>Progress:</span>
                          <span>
                            {city.production.progress} / {city.production.cost}
                          </span>
                        </div>
                        <div className="h-3 w-full rounded-full bg-slate-700">
                          <div
                            className="h-3 rounded-full bg-indigo-400 transition-all duration-300"
                            style={{
                              width: `${city.production.percentComplete || 0}%`,
                            }}
                          />
                        </div>
                        <div className="flex justify-between text-sm">
                          <span>
                            Shields per turn:{' '}
                            <span className="font-semibold">{cityData.surplus.shields}</span>
                          </span>
                          <span>
                            Turns remaining:{' '}
                            <span className="font-semibold">{city.production.turnsToComplete}</span>
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="rounded-md border border-indigo-700/50 bg-slate-900/70 p-4">
                  <div className="font-medium text-white">This city is idle</div>
                  <p className="mt-1 text-sm text-indigo-200">
                    Choose a unit or building with the Change menu to start production.
                  </p>
                </div>
              )}
            </div>

            {/* Production queues are hidden until the server exposes authoritative queue actions. */}
            {onQueueAdd && onQueueRemove && onQueueReorder && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Production Queue ({cityData.worklist.length})
                  </h3>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        disabled={isLoadingProductions}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        {isLoadingProductions ? 'Loading...' : 'Add to Queue'}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="max-h-[min(32rem,var(--radix-dropdown-menu-content-available-height))] w-72 overscroll-contain overflow-y-auto"
                    >
                      <DropdownMenuLabel className="text-slate-200">
                        Add to Production Queue
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />

                      {isLoadingProductions ? (
                        <DropdownMenuItem disabled>
                          <span className="text-sm text-slate-400">
                            Loading production options...
                          </span>
                        </DropdownMenuItem>
                      ) : (
                        <>
                          {renderProductionGroups(option =>
                            onQueueAdd?.(city.id, option.id, option.type)
                          )}
                          {renderConversionOptions(option =>
                            onQueueAdd?.(city.id, option.id, option.type)
                          )}
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Queue Items */}
                <div className="h-44 overflow-hidden">
                  {cityData.worklist.length > 0 ? (
                    <div className="space-y-2 h-full overflow-y-auto">
                      {cityData.worklist.map((item, index) => (
                        <div
                          key={index}
                          className="group flex items-center justify-between rounded border border-slate-700 bg-slate-800/60 p-3 transition-colors hover:bg-slate-800"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex flex-col gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() =>
                                  onQueueReorder?.(city.id, index, Math.max(0, index - 1))
                                }
                                disabled={index === 0}
                              >
                                <ArrowUp className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() =>
                                  onQueueReorder?.(
                                    city.id,
                                    index,
                                    Math.min(cityData.worklist.length - 1, index + 1)
                                  )
                                }
                                disabled={index === cityData.worklist.length - 1}
                              >
                                <ArrowDown className="h-3 w-3" />
                              </Button>
                            </div>
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-xs font-medium">
                              {index + 1}
                            </span>
                            <div>
                              <span className="font-medium">{item.target}</span>
                              <div className="text-xs text-slate-500">{item.cost} shields</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="capitalize text-xs">
                              {item.type}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-rose-300 opacity-0 transition-opacity hover:text-rose-200 group-hover:opacity-100"
                              onClick={() => onQueueRemove?.(city.id, index)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center text-slate-500">
                      <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No items in production queue</p>
                      <p className="text-xs text-muted-foreground">
                        Add items to queue using the button above
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Trade Routes */}
            {cityData.tradeRoutes && cityData.tradeRoutes.length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                    <Truck className="h-4 w-4" />
                    Trade Routes ({cityData.tradeRoutes.length})
                  </h3>
                  <div className="space-y-2">
                    {cityData.tradeRoutes.map((route, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between rounded border border-amber-700/50 bg-amber-950/30 p-3"
                      >
                        <div>
                          <span className="font-medium">Partner City</span>
                          <div className="text-xs text-slate-500">{route.goods}</div>
                        </div>
                        <div className="text-right">
                          <span className="font-semibold text-amber-300">+{route.value}</span>
                          <div className="text-xs text-slate-500">trade/turn</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          <CityHappinessTab city={city} />

          <TabsContent value="management" className="space-y-4 flex-1 overflow-y-auto min-h-0 p-1">
            {managementMessage && (
              <div
                role="status"
                className="rounded border border-indigo-700/50 bg-indigo-950/30 p-3 text-sm text-indigo-200"
              >
                {managementMessage}
              </div>
            )}

            <div className="rounded-lg border p-4">
              <h3 className="mb-3 font-medium">City administration</h3>
              <div className="flex gap-2">
                <input
                  aria-label="City name"
                  className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white"
                  value={cityName}
                  maxLength={100}
                  onChange={event => setCityName(event.target.value)}
                />
                <Button
                  variant="outline"
                  disabled={!onRename || !cityName.trim() || cityName.trim() === city.name}
                  onClick={() => {
                    void onRename?.(city.id, cityName.trim())
                      .then(() => setManagementMessage('City renamed'))
                      .catch(error =>
                        setManagementMessage(
                          error instanceof Error ? error.message : 'City rename failed'
                        )
                      );
                  }}
                >
                  Rename
                </Button>
              </div>
              {onDisband && (
                <div className="mt-4 border-t pt-4">
                  {!confirmDisband ? (
                    <Button variant="outline" onClick={() => setConfirmDisband(true)}>
                      Disband city
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-rose-300">
                        Permanently disband {city.name}?
                      </span>
                      <Button
                        onClick={() => {
                          void onDisband(city.id)
                            .then(() => {
                              setManagementMessage('City disbanded');
                              onClose();
                            })
                            .catch(error => {
                              setConfirmDisband(false);
                              setManagementMessage(
                                error instanceof Error ? error.message : 'City disband failed'
                              );
                            });
                        }}
                      >
                        Confirm
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirmDisband(false)}>
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-lg border p-4">
              <h3 className="mb-1 font-medium">Rally point</h3>
              <p className="mb-3 text-xs text-muted-foreground">
                Newly produced units will receive a Go To order to this tile.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label="Rally point X"
                  className="w-20 rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white"
                  inputMode="numeric"
                  placeholder="X"
                  value={rallyX}
                  onChange={event => setRallyX(event.target.value)}
                />
                <input
                  aria-label="Rally point Y"
                  className="w-20 rounded border border-slate-700 bg-slate-950 p-2 text-sm text-white"
                  inputMode="numeric"
                  placeholder="Y"
                  value={rallyY}
                  onChange={event => setRallyY(event.target.value)}
                />
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={rallyPersistent}
                    onChange={event => setRallyPersistent(event.target.checked)}
                  />
                  Persistent
                </label>
                <Button
                  variant="outline"
                  disabled={
                    !onSetRallyPoint ||
                    !Number.isInteger(Number(rallyX)) ||
                    !Number.isInteger(Number(rallyY))
                  }
                  onClick={() => {
                    void onSetRallyPoint?.(city.id, {
                      x: Number(rallyX),
                      y: Number(rallyY),
                      persistent: rallyPersistent,
                    })
                      .then(() => setManagementMessage('Rally point saved'))
                      .catch(error =>
                        setManagementMessage(
                          error instanceof Error ? error.message : 'Rally point update failed'
                        )
                      );
                  }}
                >
                  Set
                </Button>
                {cityData.rallyPoint && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      void onSetRallyPoint?.(city.id, null)
                        .then(() => {
                          setRallyX('');
                          setRallyY('');
                          setManagementMessage('Rally point cleared');
                        })
                        .catch(error =>
                          setManagementMessage(
                            error instanceof Error ? error.message : 'Rally point update failed'
                          )
                        );
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <h3 className="mb-1 font-medium">Worked tiles</h3>
              <p className="mb-3 text-xs text-muted-foreground">
                Move citizens between workable tiles and specialist jobs.
              </p>
              <div className="grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">
                {(city.workableTiles ?? []).map(tile => {
                  const availableSpecialist = Object.entries(city.citizens.specialists).find(
                    ([name, count]) => (SPECIALIST_IDS[name] ?? -1) >= 0 && count > 0
                  );
                  return (
                    <div
                      key={`${tile.x},${tile.y}`}
                      className="flex items-center justify-between rounded border border-slate-700 bg-slate-800/60 p-2 text-xs"
                    >
                      <div>
                        <div className="font-medium">
                          ({tile.x}, {tile.y}) {tile.isCenter ? 'Center' : ''}
                        </div>
                        <div className="text-slate-500">
                          {tile.outputs.food} food · {tile.outputs.shields} shields ·{' '}
                          {tile.outputs.trade} trade
                        </div>
                      </div>
                      {!tile.isCenter && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={
                            tile.isBlocked ||
                            (tile.isWorked ? !onWorkerToSpecialist : !onAssignCitizen)
                          }
                          onClick={() => {
                            const action = tile.isWorked
                              ? onWorkerToSpecialist?.(city.id, tile.x, tile.y, 0)
                              : availableSpecialist
                                ? onSpecialistToTile?.(
                                    city.id,
                                    SPECIALIST_IDS[availableSpecialist[0]],
                                    tile.x,
                                    tile.y
                                  )
                                : onAssignCitizen?.(city.id, tile.x, tile.y);
                            void action
                              ?.then(() =>
                                setManagementMessage(
                                  tile.isWorked
                                    ? 'Worker became a scientist'
                                    : 'Citizen assigned to tile'
                                )
                              )
                              .catch(error =>
                                setManagementMessage(
                                  error instanceof Error
                                    ? error.message
                                    : 'Citizen assignment failed'
                                )
                              );
                          }}
                        >
                          {tile.isWorked ? 'Make scientist' : 'Work tile'}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
              {Object.entries(city.citizens.specialists).some(
                ([name, count]) => SPECIALIST_IDS[name] !== undefined && count > 0
              ) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(city.citizens.specialists)
                    .filter(([name, count]) => SPECIALIST_IDS[name] !== undefined && count > 0)
                    .map(([name, count]) => {
                      const fromType = SPECIALIST_IDS[name];
                      const toType = (fromType + 1) % 3;
                      return (
                        <Button
                          key={name}
                          variant="outline"
                          size="sm"
                          disabled={!onChangeSpecialist}
                          onClick={() => {
                            void onChangeSpecialist?.(city.id, fromType, toType)
                              .then(() => setManagementMessage('Specialist job changed'))
                              .catch(error =>
                                setManagementMessage(
                                  error instanceof Error
                                    ? error.message
                                    : 'Specialist change failed'
                                )
                              );
                          }}
                        >
                          {name} ({count}) → {['scientist', 'taxman', 'entertainer'][toType]}
                        </Button>
                      );
                    })}
                </div>
              )}
            </div>

            <div className="rounded-lg border p-4">
              <h3 className="mb-3 font-medium">Citizen governor</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={governorEnabled}
                    onChange={event => setGovernorEnabled(event.target.checked)}
                  />
                  Enable automatic management
                </label>
                <label className="text-sm">
                  Priority
                  <select
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-white"
                    value={governorPriority}
                    onChange={event => setGovernorPriority(event.target.value)}
                  >
                    {['balanced', 'food', 'shields', 'trade', 'science', 'gold', 'luxury'].map(
                      priority => (
                        <option key={priority} value={priority}>
                          {priority[0].toUpperCase() + priority.slice(1)}
                        </option>
                      )
                    )}
                  </select>
                </label>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    void onGovernorChange?.(city.id, {
                      enabled: governorEnabled,
                      priority: governorPriority,
                      autoManageSpecialists: true,
                      autoManageTiles: true,
                      autoManageProduction: false,
                      preventStarvation: true,
                      maintainHappiness: true,
                    })
                      .then(() => setManagementMessage('Governor settings saved'))
                      .catch(error =>
                        setManagementMessage(
                          error instanceof Error ? error.message : 'Governor update failed'
                        )
                      );
                  }}
                  disabled={!onGovernorChange}
                >
                  Save governor
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    void onOptimizeCitizens?.(city.id)
                      .then(() => setManagementMessage('Citizen assignments optimized'))
                      .catch(error =>
                        setManagementMessage(
                          error instanceof Error ? error.message : 'Optimization failed'
                        )
                      );
                  }}
                  disabled={!onOptimizeCitizens}
                >
                  Optimize citizens now
                </Button>
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <h3 className="font-medium">Rush production</h3>
              <p className="my-2 text-sm text-muted-foreground">
                Spend treasury gold to finish some or all of the current production.
              </p>
              <Button
                onClick={() => {
                  void onBuyProduction?.(city.id)
                    .then(() => setManagementMessage('Production purchase completed'))
                    .catch(error =>
                      setManagementMessage(
                        error instanceof Error ? error.message : 'Production purchase failed'
                      )
                    );
                }}
                disabled={!onBuyProduction || !city.production}
              >
                Buy production
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </HudDialogContent>
    </Dialog>
  );
};
