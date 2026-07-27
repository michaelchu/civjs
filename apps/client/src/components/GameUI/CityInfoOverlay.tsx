import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
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
} from 'lucide-react';
import type { City, Unit, ProductionOption } from '../../types';

interface CityInfoOverlayProps {
  city: City | null;
  isOpen: boolean;
  onClose: () => void;
  units?: Record<string, Unit>; // For displaying present/supported units
  availableProductions?: ProductionOption[]; // Real production data from server
  isLoadingProductions?: boolean; // Loading state for production data
  onProductionChange?: (
    cityId: string,
    productionId: string,
    type: 'unit' | 'building' | 'wonder'
  ) => void;
  onQueueAdd?: (cityId: string, productionId: string, type: 'unit' | 'building' | 'wonder') => void;
  onQueueRemove?: (cityId: string, index: number) => void;
  onQueueReorder?: (cityId: string, fromIndex: number, toIndex: number) => void;
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
  onProductionChange,
  onQueueAdd,
  onQueueRemove,
  onQueueReorder,
  onGovernorChange,
  onOptimizeCitizens,
  onBuyProduction,
}) => {
  const [activeTab, setActiveTab] = useState('main');
  const [governorEnabled, setGovernorEnabled] = useState(city?.governor?.isEnabled ?? false);
  const [governorPriority, setGovernorPriority] = useState(city?.governor?.priority ?? 'balanced');
  const [managementMessage, setManagementMessage] = useState<string | null>(null);

  useEffect(() => {
    setGovernorEnabled(city?.governor?.isEnabled ?? false);
    setGovernorPriority(city?.governor?.priority ?? 'balanced');
    setManagementMessage(null);
  }, [city?.id, city?.governor?.isEnabled, city?.governor?.priority]);

  if (!city) {
    return null;
  }

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

  const getResourceColor = (value: number | null | undefined) => {
    if (value === null || value === undefined) return 'text-gray-400';
    if (value > 0) return 'text-green-600';
    if (value < 0) return 'text-red-600';
    return 'text-gray-600';
  };

  const getResourceBgColor = (value: number | null | undefined) => {
    if (value === null || value === undefined) return 'bg-gray-50 border-gray-300';
    if (value > 0) return 'bg-green-50 border-green-200';
    if (value < 0) return 'bg-red-50 border-red-200';
    return 'bg-gray-50 border-gray-200';
  };

  const formatResourceValue = (value: number | null | undefined, showSign = true) => {
    if (value === null || value === undefined) return '--';
    const sign = showSign && value > 0 ? '+' : '';
    return `${sign}${value}`;
  };

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
    if (cityData.celebrating) return { text: 'Celebrating', color: 'text-green-600', icon: Heart };
    if (cityData.disorder) return { text: 'Disorder', color: 'text-red-600', icon: Frown };
    return { text: 'Peace', color: 'text-blue-600', icon: Smile };
  };

  const presentUnits = cityData.presentUnits?.map(id => units[id]).filter(Boolean) || [];
  const supportedUnits = cityData.supportedUnits?.map(id => units[id]).filter(Boolean) || [];
  const stateInfo = getCityStateInfo();
  const StateIcon = stateInfo.icon;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-4xl w-full h-[580px] max-h-[85vh] min-h-[500px] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Building2 className="h-6 w-6" />
            {city.name} ({city.size})
          </DialogTitle>
          <DialogDescription>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                Position ({city.x}, {city.y})
              </div>
              <div className="flex items-center gap-1">
                <Users className="h-4 w-4" />
                Population: {city.actualPopulation ? city.actualPopulation.toLocaleString() : '--'}
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
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="main" className="flex items-center gap-2">
              <Home className="h-4 w-4" />
              Main
            </TabsTrigger>
            <TabsTrigger value="production" className="flex items-center gap-2">
              <Package2 className="h-4 w-4" />
              Production
            </TabsTrigger>
            <TabsTrigger value="happiness" className="flex items-center gap-2">
              <Heart className="h-4 w-4" />
              Happiness
            </TabsTrigger>
            <TabsTrigger value="management" className="flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              Manage
            </TabsTrigger>
          </TabsList>

          <TabsContent value="main" className="space-y-4 flex-1 overflow-y-auto min-h-0 p-1">
            {/* Population Status */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 border rounded-lg bg-blue-50">
                <h3 className="font-medium text-blue-800 mb-2 flex items-center gap-2">
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
                      {city.foodStock || '--'}/{city.granarySize || '--'}
                    </span>
                  </div>
                  <div className="text-xs text-blue-600">{formatGrowthText()}</div>
                </div>
              </div>

              {/* Current Production */}
              {city.production && (
                <div className="p-4 border rounded-lg bg-purple-50">
                  <h3 className="font-medium text-purple-800 mb-2 flex items-center gap-2">
                    <Hammer className="h-4 w-4" />
                    Production
                  </h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{city.production.target}</span>
                      <Badge variant="secondary" className="capitalize text-xs">
                        {city.production.type}
                      </Badge>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                        style={{
                          width: `${city.production.percentComplete || 0}%`,
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-purple-600">
                      <span>
                        {city.production.progress}/{city.production.cost}
                      </span>
                      <span>{city.production.turnsToComplete} turns</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Resource Breakdown */}
            <div>
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Resource Output & Surplus
              </h3>
              <div className="grid grid-cols-3 gap-3 mb-4">
                {/* Food */}
                <div
                  className={`flex flex-col items-center p-3 rounded-lg border ${getResourceBgColor(cityData.surplus?.food)}`}
                >
                  <Wheat className="h-5 w-5 mb-1" />
                  <div
                    className={`text-lg font-semibold ${getResourceColor(cityData.surplus?.food)}`}
                  >
                    {formatResourceValue(cityData.surplus?.food)}
                  </div>
                  <div className="text-xs text-center">
                    <div>Food</div>
                    {cityData.prod?.food !== cityData.surplus?.food &&
                      cityData.prod?.food !== undefined && (
                        <div className="text-gray-500">({cityData.prod.food} base)</div>
                      )}
                  </div>
                </div>

                {/* Shields */}
                <div
                  className={`flex flex-col items-center p-3 rounded-lg border ${getResourceBgColor(cityData.surplus?.shields)}`}
                >
                  <Shield className="h-5 w-5 mb-1" />
                  <div
                    className={`text-lg font-semibold ${getResourceColor(cityData.surplus?.shields)}`}
                  >
                    {formatResourceValue(cityData.surplus?.shields)}
                  </div>
                  <div className="text-xs text-center">
                    <div>Shields</div>
                    {cityData.prod?.shields !== cityData.surplus?.shields &&
                      cityData.prod?.shields !== undefined && (
                        <div className="text-gray-500">({cityData.prod.shields} base)</div>
                      )}
                  </div>
                </div>

                {/* Trade */}
                <div
                  className={`flex flex-col items-center p-3 rounded-lg border ${getResourceBgColor(cityData.surplus?.trade)}`}
                >
                  <Truck className="h-5 w-5 mb-1" />
                  <div
                    className={`text-lg font-semibold ${getResourceColor(cityData.surplus?.trade)}`}
                  >
                    {formatResourceValue(cityData.surplus?.trade)}
                  </div>
                  <div className="text-xs text-center">
                    <div>Trade</div>
                    {cityData.prod?.trade !== cityData.surplus?.trade &&
                      cityData.prod?.trade !== undefined && (
                        <div className="text-gray-500">({cityData.prod.trade} base)</div>
                      )}
                  </div>
                </div>
              </div>

              {/* Economic Output */}
              <div className="grid grid-cols-3 gap-3">
                <div
                  className={`flex flex-col items-center p-3 rounded-lg border ${getResourceBgColor(cityData.surplus?.gold)}`}
                >
                  <Coins className="h-5 w-5 mb-1" />
                  <div
                    className={`text-lg font-semibold ${getResourceColor(cityData.surplus?.gold)}`}
                  >
                    {formatResourceValue(cityData.surplus?.gold)}
                  </div>
                  <div className="text-xs">Gold</div>
                </div>
                <div
                  className={`flex flex-col items-center p-3 rounded-lg border ${getResourceBgColor(cityData.surplus?.luxury)}`}
                >
                  <Zap className="h-5 w-5 mb-1" />
                  <div
                    className={`text-lg font-semibold ${getResourceColor(cityData.surplus?.luxury)}`}
                  >
                    {formatResourceValue(cityData.surplus?.luxury)}
                  </div>
                  <div className="text-xs">Luxury</div>
                </div>
                <div
                  className={`flex flex-col items-center p-3 rounded-lg border ${getResourceBgColor(cityData.surplus?.science)}`}
                >
                  <FlaskConical className="h-5 w-5 mb-1" />
                  <div
                    className={`text-lg font-semibold ${getResourceColor(cityData.surplus?.science)}`}
                  >
                    {formatResourceValue(cityData.surplus?.science)}
                  </div>
                  <div className="text-xs">Science</div>
                </div>
              </div>

              {/* Waste/Corruption */}
              {cityData.waste && (cityData.waste.shields > 0 || cityData.waste.trade > 0) && (
                <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                  <h4 className="text-sm font-medium text-orange-800 mb-2">Waste & Corruption</h4>
                  <div className="flex gap-4 text-sm">
                    {cityData.waste.shields > 0 && (
                      <div>
                        Shield waste:{' '}
                        <span className="font-semibold text-red-600">{cityData.waste.shields}</span>
                      </div>
                    )}
                    {cityData.waste.trade > 0 && (
                      <div>
                        Trade corruption:{' '}
                        <span className="font-semibold text-red-600">{cityData.waste.trade}</span>
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
                      className="flex items-center justify-between p-3 bg-gray-50 rounded border hover:bg-gray-100 transition-colors"
                    >
                      <span className="text-sm font-medium">{building.name}</span>
                      {building.upkeep > 0 && (
                        <div className="flex items-center gap-1 text-xs text-red-600">
                          <Coins className="h-3 w-3" />
                          {building.upkeep}
                        </div>
                      )}
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
                            className="flex items-center justify-between p-2 bg-green-50 rounded border text-sm"
                          >
                            <span>{unit.unitTypeId}</span>
                            <div className="flex items-center gap-2 text-xs text-green-600">
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
                            className="flex items-center justify-between p-2 bg-blue-50 rounded border text-sm"
                          >
                            <span>{unit.unitTypeId}</span>
                            <div className="flex items-center gap-2 text-xs text-blue-600">
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
            {city.production && (
              <div className="p-4 border rounded-lg bg-purple-50">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-purple-800 flex items-center gap-2">
                    <Hammer className="h-4 w-4" />
                    Current Production
                  </h3>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        disabled={isLoadingProductions}
                      >
                        {isLoadingProductions ? 'Loading...' : 'Change'}{' '}
                        <ChevronDown className="h-3 w-3 ml-1" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuLabel>Select Production</DropdownMenuLabel>
                      <DropdownMenuSeparator />

                      {isLoadingProductions ? (
                        <DropdownMenuItem disabled>
                          <span className="text-sm text-muted-foreground">
                            Loading production options...
                          </span>
                        </DropdownMenuItem>
                      ) : (
                        <>
                          <DropdownMenuLabel className="text-xs text-muted-foreground">
                            Units
                          </DropdownMenuLabel>
                          {availableProductions
                            .filter(p => p.type === 'unit')
                            .map(option => (
                              <DropdownMenuItem
                                key={option.id}
                                onClick={() =>
                                  onProductionChange?.(city.id, option.id, option.type)
                                }
                                className="flex items-center justify-between"
                                disabled={!option.available}
                              >
                                <div>
                                  <div className="font-medium">{option.name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {option.description}
                                  </div>
                                </div>
                                <span className="text-xs">{option.cost} shields</span>
                              </DropdownMenuItem>
                            ))}

                          <DropdownMenuSeparator />
                          <DropdownMenuLabel className="text-xs text-muted-foreground">
                            Buildings
                          </DropdownMenuLabel>
                          {availableProductions
                            .filter(p => p.type === 'building')
                            .map(option => (
                              <DropdownMenuItem
                                key={option.id}
                                onClick={() =>
                                  onProductionChange?.(city.id, option.id, option.type)
                                }
                                className="flex items-center justify-between"
                                disabled={!option.available}
                              >
                                <div>
                                  <div className="font-medium">{option.name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {option.description}
                                  </div>
                                </div>
                                <span className="text-xs">{option.cost} shields</span>
                              </DropdownMenuItem>
                            ))}

                          <DropdownMenuSeparator />
                          <DropdownMenuLabel className="text-xs text-muted-foreground">
                            Wonders
                          </DropdownMenuLabel>
                          {availableProductions
                            .filter(p => p.type === 'wonder')
                            .map(option => (
                              <DropdownMenuItem
                                key={option.id}
                                onClick={() =>
                                  onProductionChange?.(city.id, option.id, option.type)
                                }
                                className="flex items-center justify-between"
                                disabled={!option.available}
                              >
                                <div>
                                  <div className="font-medium">{option.name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {option.description}
                                  </div>
                                </div>
                                <span className="text-xs">{option.cost} shields</span>
                              </DropdownMenuItem>
                            ))}
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{city.production.target}</span>
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
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div
                        className="bg-purple-600 h-3 rounded-full transition-all duration-300"
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
                </div>
              </div>
            )}

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
                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuLabel>Add to Production Queue</DropdownMenuLabel>
                      <DropdownMenuSeparator />

                      {isLoadingProductions ? (
                        <DropdownMenuItem disabled>
                          <span className="text-sm text-muted-foreground">
                            Loading production options...
                          </span>
                        </DropdownMenuItem>
                      ) : (
                        <>
                          <DropdownMenuLabel className="text-xs text-muted-foreground">
                            Units
                          </DropdownMenuLabel>
                          {availableProductions
                            .filter(p => p.type === 'unit')
                            .map(option => (
                              <DropdownMenuItem
                                key={option.id}
                                onClick={() => onQueueAdd?.(city.id, option.id, option.type)}
                                className="flex items-center justify-between"
                                disabled={!option.available}
                              >
                                <div>
                                  <div className="font-medium">{option.name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {option.description}
                                  </div>
                                </div>
                                <span className="text-xs">{option.cost} shields</span>
                              </DropdownMenuItem>
                            ))}

                          <DropdownMenuSeparator />
                          <DropdownMenuLabel className="text-xs text-muted-foreground">
                            Buildings
                          </DropdownMenuLabel>
                          {availableProductions
                            .filter(p => p.type === 'building')
                            .map(option => (
                              <DropdownMenuItem
                                key={option.id}
                                onClick={() => onQueueAdd?.(city.id, option.id, option.type)}
                                className="flex items-center justify-between"
                                disabled={!option.available}
                              >
                                <div>
                                  <div className="font-medium">{option.name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {option.description}
                                  </div>
                                </div>
                                <span className="text-xs">{option.cost} shields</span>
                              </DropdownMenuItem>
                            ))}

                          <DropdownMenuSeparator />
                          <DropdownMenuLabel className="text-xs text-muted-foreground">
                            Wonders
                          </DropdownMenuLabel>
                          {availableProductions
                            .filter(p => p.type === 'wonder')
                            .map(option => (
                              <DropdownMenuItem
                                key={option.id}
                                onClick={() => onQueueAdd?.(city.id, option.id, option.type)}
                                className="flex items-center justify-between"
                                disabled={!option.available}
                              >
                                <div>
                                  <div className="font-medium">{option.name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {option.description}
                                  </div>
                                </div>
                                <span className="text-xs">{option.cost} shields</span>
                              </DropdownMenuItem>
                            ))}
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
                          className="flex items-center justify-between p-3 bg-gray-50 rounded border hover:bg-gray-100 transition-colors group"
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
                            <span className="text-xs bg-gray-200 rounded-full w-6 h-6 flex items-center justify-center font-medium">
                              {index + 1}
                            </span>
                            <div>
                              <span className="font-medium">{item.target}</span>
                              <div className="text-xs text-gray-500">{item.cost} shields</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="capitalize text-xs">
                              {item.type}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => onQueueRemove?.(city.id, index)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500">
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
                        className="flex items-center justify-between p-3 bg-yellow-50 rounded border"
                      >
                        <div>
                          <span className="font-medium">Partner City</span>
                          <div className="text-xs text-gray-600">{route.goods}</div>
                        </div>
                        <div className="text-right">
                          <span className="font-semibold text-yellow-600">+{route.value}</span>
                          <div className="text-xs text-gray-600">trade/turn</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="happiness" className="space-y-4 flex-1 overflow-y-auto min-h-0 p-1">
            {/* Citizens Overview */}
            {cityData.citizens && (
              <div>
                <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Citizens
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-3">
                    {/* Happy Citizens */}
                    <div className="flex items-center justify-between p-3 bg-green-50 rounded border">
                      <div className="flex items-center gap-2">
                        <Heart className="h-4 w-4 text-green-600" />
                        <span className="text-sm font-medium">Happy</span>
                      </div>
                      <span className="font-semibold text-green-600">
                        {cityData.citizens.happy}
                      </span>
                    </div>

                    {/* Content Citizens */}
                    <div className="flex items-center justify-between p-3 bg-blue-50 rounded border">
                      <div className="flex items-center gap-2">
                        <Smile className="h-4 w-4 text-blue-600" />
                        <span className="text-sm font-medium">Content</span>
                      </div>
                      <span className="font-semibold text-blue-600">
                        {cityData.citizens.content}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {/* Unhappy Citizens */}
                    <div className="flex items-center justify-between p-3 bg-orange-50 rounded border">
                      <div className="flex items-center gap-2">
                        <Frown className="h-4 w-4 text-orange-600" />
                        <span className="text-sm font-medium">Unhappy</span>
                      </div>
                      <span className="font-semibold text-orange-600">
                        {cityData.citizens.unhappy}
                      </span>
                    </div>

                    {/* Angry Citizens */}
                    <div className="flex items-center justify-between p-3 bg-red-50 rounded border">
                      <div className="flex items-center gap-2">
                        <Frown className="h-4 w-4 text-red-600" />
                        <span className="text-sm font-medium">Angry</span>
                      </div>
                      <span className="font-semibold text-red-600">{cityData.citizens.angry}</span>
                    </div>
                  </div>
                </div>

                {/* Specialists */}
                {cityData.citizens.specialists &&
                  Object.keys(cityData.citizens.specialists).length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-sm font-medium mb-2">Specialists</h4>
                      <div className="grid grid-cols-3 gap-2">
                        {Object.entries(cityData.citizens.specialists).map(([type, count]) => (
                          <div
                            key={type}
                            className="flex items-center justify-between p-2 bg-purple-50 rounded border text-sm"
                          >
                            <span className="capitalize">{type}</span>
                            <span className="font-semibold text-purple-600">{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            )}

            {/* City Status */}
            <div className="p-4 border rounded-lg bg-gray-50">
              <h3 className="font-medium mb-3 flex items-center gap-2">
                <StateIcon className={`h-4 w-4 ${stateInfo.color}`} />
                City Status
              </h3>
              <div className="space-y-2 text-sm">
                <div className={`font-medium ${stateInfo.color}`}>{stateInfo.text}</div>
                {cityData.pollution > 0 && (
                  <div className="text-orange-600">Pollution: {cityData.pollution}</div>
                )}
                {cityData.rallyPoint && (
                  <div className="text-blue-600">
                    Rally Point: ({cityData.rallyPoint.x}, {cityData.rallyPoint.y})
                    {cityData.rallyPoint.persistent && ' (Persistent)'}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="management" className="space-y-4 flex-1 overflow-y-auto min-h-0 p-1">
            {managementMessage && (
              <div role="status" className="rounded border bg-gray-50 p-3 text-sm text-gray-700">
                {managementMessage}
              </div>
            )}

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
                    className="mt-1 w-full rounded border bg-background p-2"
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
      </DialogContent>
    </Dialog>
  );
};
