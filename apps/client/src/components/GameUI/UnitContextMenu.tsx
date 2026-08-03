/**
 * @module client/components/GameUI/UnitContextMenu
 * Defines the Unit Context Menu client UI component.
 */
import React from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuShortcut,
} from '../ui/dropdown-menu';
import {
  MapPin,
  Shield,
  Eye,
  Clock,
  Home,
  Hammer,
  Route,
  Mountain,
  Pickaxe,
  Zap,
  SkipForward,
  Trash2,
  HandCoins,
  Plane,
  Crosshair,
  Compass,
  Bot,
  Building2,
  Info,
} from 'lucide-react';
import type { City, Tile, Unit } from '../../types';
import { ActionType } from '../../types/shared/actions';

type UnitMenuCity = Pick<City, 'id' | 'playerId' | 'buildings' | 'airlift'>;
type UnitMenuTile = Pick<Tile, 'improvements' | 'owner'>;

interface UnitContextMenuProps {
  unit: Unit | null;
  position: { x: number; y: number } | null;
  city?: UnitMenuCity;
  tile?: UnitMenuTile;
  onClose: () => void;
  onActionSelect: (action: ActionType, targetX?: number, targetY?: number) => void;
  onShowCity?: () => void;
  onShowTileInfo?: () => void;
  onSelectAllOnTile?: () => void;
  onSelectSameType?: () => void;
}

interface UnitActionInfo {
  action: ActionType;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  hotkey?: string;
  disabled?: boolean;
  submenu?: UnitActionInfo[];
}

interface UnitActionSeparator {
  separator: true;
}

type UnitMenuItem = UnitActionInfo | UnitActionSeparator;

export const UnitContextMenu: React.FC<UnitContextMenuProps> = ({
  unit,
  position,
  city,
  tile,
  onClose,
  onActionSelect,
  onShowCity,
  onShowTileInfo,
  onSelectAllOnTile,
  onSelectSameType,
}) => {
  if (!unit || !position) {
    return null;
  }

  // Determine available actions based on unit type and capabilities
  const getAvailableActions = (unit: Unit): UnitMenuItem[] => {
    const actions: UnitMenuItem[] = [];
    const unitActions = new Set(unit.capabilities?.unitActions ?? []);

    // Basic movement actions - available to all units
    actions.push(
      {
        action: ActionType.GOTO,
        name: 'Go To',
        icon: MapPin,
        hotkey: 'G',
      },
      {
        action: ActionType.PATROL,
        name: 'Patrol',
        icon: Route,
        hotkey: 'P',
      },
      {
        action: ActionType.WAIT,
        name: 'Wait',
        icon: Clock,
        hotkey: 'W',
      },
      {
        action: ActionType.SKIP_TURN,
        name: 'Skip Turn',
        icon: SkipForward,
        hotkey: 'Space',
      }
    );

    // Military unit actions
    if (unit.capabilities?.canFortify) {
      actions.push(
        { separator: true },
        {
          action: ActionType.FORTIFY,
          name: 'Fortify',
          icon: Shield,
          hotkey: 'F',
        },
        {
          action: ActionType.SENTRY,
          name: 'Sentry',
          icon: Eye,
          hotkey: 'S',
        }
      );
    }

    // Settler actions. The reference only exposes Found City off a city tile;
    // the unit-type capability alone is not enough.
    // @reference reference/freeciv-web/javascript/control.js:1578-1589
    if (unit.capabilities?.canFoundCity && !city) {
      actions.push(
        { separator: true },
        {
          action: ActionType.FOUND_CITY,
          name: 'Found City',
          icon: Home,
          hotkey: 'B',
        }
      );
    }

    // Worker actions. Only units with the ruleset's Workers flag can perform
    // terrain activities; Settlers are dedicated city-founding units here.
    if (unit.capabilities?.canBuildImprovements) {
      // Build submenu for workers
      // This list is the server's contextual projection of the reference's
      // tile/tech checks. Do not fail open when it is absent, or a stale unit
      // snapshot can expose tech-gated orders such as Railroad or Airbase.
      const availableWorkerActions = new Set(unit.capabilities?.availableWorkerActions ?? []);
      const actionIsAvailable = (action: ActionType): boolean => availableWorkerActions.has(action);
      const buildActions: UnitActionInfo[] = [
        ...(actionIsAvailable(ActionType.BUILD_ROAD)
          ? [
              {
                action: ActionType.BUILD_ROAD,
                name: 'Build Road',
                icon: Route,
                hotkey: 'R',
              },
            ]
          : []),
        ...(actionIsAvailable(ActionType.BUILD_RAILROAD)
          ? [{ action: ActionType.BUILD_RAILROAD, name: 'Build Railroad', icon: Route }]
          : []),
        ...(actionIsAvailable(ActionType.BUILD_IRRIGATION)
          ? [
              {
                action: ActionType.BUILD_IRRIGATION,
                name: 'Build Irrigation',
                icon: Zap,
                hotkey: 'I',
              },
            ]
          : []),
        ...(actionIsAvailable(ActionType.BUILD_MINE)
          ? [{ action: ActionType.BUILD_MINE, name: 'Build Mine', icon: Pickaxe, hotkey: 'M' }]
          : []),
        ...(actionIsAvailable(ActionType.CULTIVATE) && unitActions.has(ActionType.CULTIVATE)
          ? [{ action: ActionType.CULTIVATE, name: 'Cultivate Terrain', icon: Zap }]
          : []),
        ...(actionIsAvailable(ActionType.PLANT) && unitActions.has(ActionType.PLANT)
          ? [{ action: ActionType.PLANT, name: 'Plant Terrain', icon: Mountain }]
          : []),
        ...(actionIsAvailable(ActionType.BUILD_FORTRESS) &&
        unitActions.has(ActionType.BUILD_FORTRESS)
          ? [{ action: ActionType.BUILD_FORTRESS, name: 'Build Fortress', icon: Shield }]
          : []),
        ...(actionIsAvailable(ActionType.BUILD_AIRBASE) && unitActions.has(ActionType.BUILD_AIRBASE)
          ? [
              {
                action: ActionType.BUILD_AIRBASE,
                name: 'Build Airbase',
                icon: Plane,
              },
            ]
          : []),
        ...(actionIsAvailable(ActionType.TRANSFORM_TERRAIN)
          ? [
              {
                action: ActionType.TRANSFORM_TERRAIN,
                name: 'Transform Terrain',
                icon: Mountain,
                hotkey: 'O',
              },
            ]
          : []),
        ...(actionIsAvailable(ActionType.CLEAN_POLLUTION)
          ? [
              {
                action: ActionType.CLEAN_POLLUTION,
                name: 'Clean Pollution',
                icon: Zap,
                hotkey: 'C',
              },
            ]
          : []),
      ];

      if (buildActions.length > 0) {
        actions.push({ separator: true });
        actions.push({
          action: ActionType.BUILD_ROAD, // Placeholder for submenu
          name: 'Build',
          icon: Hammer,
          submenu: buildActions,
        });
      }
    }

    // The reference asks the tile for a legal pillageable extra rather than
    // showing Pillage for every unit type that has the coarse capability.
    // The client tile model does not expose per-extra pillage rules yet, so a
    // known improvement is the conservative presentation-level projection.
    // @reference reference/freeciv-web/javascript/control.js:1838-1847
    const canPillageTile =
      (tile?.improvements?.length ?? 0) > 0 && (!city || city.playerId !== unit.playerId);
    if (unit.capabilities?.canPillage && canPillageTile) {
      actions.push(
        { separator: true },
        {
          action: ActionType.PILLAGE,
          name: 'Pillage Improvement',
          icon: Trash2,
        }
      );
    }

    if (unit.capabilities?.canTrade) {
      actions.push(
        { separator: true },
        {
          action: ActionType.TRADE_ROUTE,
          name: 'Establish Trade Route',
          icon: HandCoins,
          hotkey: 'T',
        }
      );
    }

    if (unit.capabilities?.diplomatActions?.length) {
      const diplomatLabels: Partial<Record<ActionType, string>> = {
        [ActionType.ESTABLISH_EMBASSY]: 'Establish Embassy',
        [ActionType.INVESTIGATE_CITY]: 'Investigate City',
        [ActionType.STEAL_TECH]: 'Steal Technology',
        [ActionType.SABOTAGE_CITY]: 'Sabotage City',
        [ActionType.SABOTAGE_CITY_PRODUCTION]: 'Sabotage Production',
        [ActionType.BRIBE_UNIT]: 'Bribe Unit',
        [ActionType.INCITE_CITY]: 'Incite Revolt',
        [ActionType.POISON_WATER]: 'Poison City',
        [ActionType.SABOTAGE_UNIT]: 'Sabotage Unit',
      };
      actions.push({ separator: true });
      for (const action of unit.capabilities.diplomatActions) {
        const actionType = action as ActionType;
        actions.push({
          action: actionType,
          name: diplomatLabels[actionType] ?? action.replaceAll('_', ' '),
          icon: actionType === ActionType.INVESTIGATE_CITY ? Eye : Zap,
        });
      }
    }

    const specialActions: UnitActionInfo[] = [];
    if (unitActions.has(ActionType.MARKETPLACE)) {
      specialActions.push({
        action: ActionType.MARKETPLACE,
        name: 'Sell Goods',
        icon: HandCoins,
      });
    }
    if (unitActions.has(ActionType.HELP_WONDER)) {
      specialActions.push({
        action: ActionType.HELP_WONDER,
        name: 'Help Wonder',
        icon: Hammer,
      });
    }
    // @reference reference/freeciv-web/javascript/control.js:1578-1589
    if (unitActions.has(ActionType.JOIN_CITY) && city) {
      specialActions.push({
        action: ActionType.JOIN_CITY,
        name: 'Join City',
        icon: Home,
      });
    }
    // @reference reference/freeciv-web/javascript/control.js:2078-2084
    if (
      unitActions.has(ActionType.CHANGE_HOME_CITY) &&
      city?.playerId === unit.playerId &&
      unit.homeCityId !== undefined &&
      unit.homeCityId !== city.id
    ) {
      specialActions.push({
        action: ActionType.CHANGE_HOME_CITY,
        name: 'Change Home City',
        icon: Home,
      });
    }
    // The server resolves the complete obsolete_by chain against the player's
    // researched technologies and sends the final target/cost to the owner.
    // @reference reference/freeciv-web/javascript/control.js:2096-2124
    const upgradeTarget = unit.capabilities?.upgradeTarget;
    if (
      unitActions.has(ActionType.UPGRADE_UNIT) &&
      city?.playerId === unit.playerId &&
      upgradeTarget
    ) {
      specialActions.push({
        action: ActionType.UPGRADE_UNIT,
        name: `Upgrade to ${upgradeTarget.name} (${upgradeTarget.cost === 0 ? 'free' : `${upgradeTarget.cost} gold`})`,
        icon: Zap,
      });
    }
    // Paradrop is not directly tech-gated in the reference menu. The
    // coarse Paratroopers capability is combined with the current movement
    // check here.
    // @reference reference/freeciv-web/javascript/control.js:2071-2076
    if (unitActions.has(ActionType.PARADROP) && unit.movesLeft > 0) {
      specialActions.push({
        action: ActionType.PARADROP,
        name: 'Paradrop',
        icon: Plane,
      });
    }
    if (unitActions.has(ActionType.BOMBARD)) {
      specialActions.push({
        action: ActionType.BOMBARD,
        name: 'Bombard',
        icon: Crosshair,
      });
    }
    if (unitActions.has(ActionType.NUCLEAR_EXPLOSION)) {
      specialActions.push({
        action: ActionType.NUCLEAR_EXPLOSION,
        name: 'Detonate Nuclear',
        icon: Zap,
      });
    }
    if (unitActions.has(ActionType.COLLECT_RANSOM)) {
      specialActions.push({
        action: ActionType.COLLECT_RANSOM,
        name: 'Collect Ransom',
        icon: HandCoins,
      });
    }
    if (unitActions.has(ActionType.SUICIDE_ATTACK)) {
      specialActions.push({
        action: ActionType.SUICIDE_ATTACK,
        name: 'Suicide Attack',
        icon: Crosshair,
      });
    }
    // The server projects both the endpoint capability and this turn's
    // remaining capacity, matching the reference's city airlift check.
    // @reference reference/freeciv-web/javascript/control.js:2086-2094
    const canAirliftFromCity =
      unitActions.has(ActionType.AIRLIFT) &&
      city?.playerId === unit.playerId &&
      city.airlift?.from.enabled === true;
    if (canAirliftFromCity && !unit.transportedBy && !(unit.cargoUnits?.length ?? 0)) {
      specialActions.push({
        action: ActionType.AIRLIFT,
        name: 'Airlift',
        icon: Plane,
        disabled: unit.movesLeft <= 0 || city.airlift?.from.available !== true,
      });
    }
    if (specialActions.length) {
      actions.push({ separator: true }, ...specialActions);
    }

    const automationActions: UnitActionInfo[] = [];
    if (unitActions.has(ActionType.AUTO_EXPLORE)) {
      automationActions.push({
        action: ActionType.AUTO_EXPLORE,
        name: 'Auto Explore',
        icon: Compass,
      });
    }
    if (unitActions.has(ActionType.AUTO_SETTLER)) {
      automationActions.push({
        action: ActionType.AUTO_SETTLER,
        name: 'Auto Worker',
        icon: Bot,
      });
    }
    if (automationActions.length) {
      actions.push({ separator: true }, ...automationActions);
    }

    actions.push(
      { separator: true },
      unit.transportedBy
        ? {
            action: ActionType.UNLOAD_UNIT,
            name: 'Unload',
            icon: Route,
          }
        : {
            action: ActionType.LOAD_UNIT,
            name: 'Load onto Transport',
            icon: Route,
          }
    );

    // Common unit management actions
    actions.push(
      { separator: true },
      {
        action: ActionType.DISBAND_UNIT,
        name: 'Disband Unit',
        icon: Trash2,
        hotkey: 'Shift+D',
      },
      ...(unitActions.has(ActionType.DISBAND_UNIT_RECOVER)
        ? [
            {
              action: ActionType.DISBAND_UNIT_RECOVER,
              name: 'Disband and Recover Shields',
              icon: Hammer,
            },
          ]
        : [])
    );

    return actions;
  };

  const availableActions = getAvailableActions(unit);

  const contextActions: Array<{
    name: string;
    icon: React.ComponentType<{ className?: string }>;
    onSelect: () => void;
  }> = [
    ...(onShowCity ? [{ name: 'Show City', icon: Building2, onSelect: onShowCity }] : []),
    ...(onShowTileInfo ? [{ name: 'Tile Info', icon: Info, onSelect: onShowTileInfo }] : []),
    ...(onSelectAllOnTile
      ? [{ name: 'Select All on Tile', icon: Compass, onSelect: onSelectAllOnTile }]
      : []),
    ...(onSelectSameType
      ? [{ name: 'Select Same Type', icon: Compass, onSelect: onSelectSameType }]
      : []),
  ];

  const handleActionClick = (action: ActionType) => {
    onActionSelect(action);
    onClose();
  };

  const renderMenuItem = (actionInfo: UnitMenuItem, index: number) => {
    if ('separator' in actionInfo && actionInfo.separator) {
      return <DropdownMenuSeparator key={`separator-${index}`} />;
    }

    // Type guard to ensure actionInfo is UnitActionInfo
    const action = actionInfo as UnitActionInfo;

    if (action.submenu) {
      return (
        <DropdownMenuSub key={action.action}>
          <DropdownMenuSubTrigger disabled={action.disabled}>
            <action.icon className="mr-2 h-4 w-4" />
            {action.name}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {action.submenu.map((subAction: UnitActionInfo) => (
              <DropdownMenuItem
                key={subAction.action}
                onClick={() => handleActionClick(subAction.action)}
                disabled={subAction.disabled}
              >
                <subAction.icon className="mr-2 h-4 w-4" />
                {subAction.name}
                {subAction.hotkey && (
                  <DropdownMenuShortcut>{subAction.hotkey}</DropdownMenuShortcut>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      );
    }

    return (
      <DropdownMenuItem
        key={action.action}
        onClick={() => handleActionClick(action.action)}
        disabled={action.disabled}
      >
        <action.icon className="mr-2 h-4 w-4" />
        {action.name}
        {action.hotkey && <DropdownMenuShortcut>{action.hotkey}</DropdownMenuShortcut>}
      </DropdownMenuItem>
    );
  };

  return (
    <DropdownMenu open={true} onOpenChange={open => !open && onClose()}>
      <DropdownMenuContent
        className="w-56"
        style={{
          position: 'fixed',
          left: position.x,
          top: position.y,
          zIndex: 1000,
        }}
      >
        {contextActions.map((contextAction, index) => (
          <React.Fragment key={contextAction.name}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onClick={() => {
                contextAction.onSelect();
                onClose();
              }}
            >
              <contextAction.icon className="mr-2 h-4 w-4" />
              {contextAction.name}
            </DropdownMenuItem>
          </React.Fragment>
        ))}
        {contextActions.length > 0 && <DropdownMenuSeparator />}
        {availableActions.map((actionInfo, index) => renderMenuItem(actionInfo, index))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
