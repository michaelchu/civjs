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
  Search,
  SkipForward,
  Trash2,
} from 'lucide-react';
import type { Unit } from '../../types';
import { ActionType } from '../../types/shared/actions';

interface UnitContextMenuProps {
  unit: Unit | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
  onActionSelect: (action: ActionType, targetX?: number, targetY?: number) => void;
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
  onClose,
  onActionSelect,
}) => {
  if (!unit || !position) {
    return null;
  }

  // Determine available actions based on unit type and capabilities
  const getAvailableActions = (unit: Unit): UnitMenuItem[] => {
    const actions: UnitMenuItem[] = [];

    // Basic movement actions - available to all units
    actions.push(
      {
        action: ActionType.GOTO,
        name: 'Go To',
        icon: MapPin,
        hotkey: 'G',
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
    if (
      unit.type === 'warrior' ||
      unit.type === 'archer' ||
      unit.type === 'spearman' ||
      unit.type === 'scout'
    ) {
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

      // Combat actions for military units
      if (unit.type !== 'scout') {
        actions.push({
          action: ActionType.PATROL,
          name: 'Patrol',
          icon: Route,
          hotkey: 'P',
        });
      }
    }

    // Settler actions
    if (unit.type === 'settler') {
      actions.push(
        { separator: true },
        {
          action: ActionType.FOUND_CITY,
          name: 'Found City',
          icon: Home,
          hotkey: 'B',
        },
        {
          action: ActionType.JOIN_CITY,
          name: 'Join City',
          icon: Home,
          hotkey: 'J',
          disabled: true, // TODO: Enable when in city
        }
      );
    }

    // Worker actions
    if (unit.type === 'worker') {
      actions.push(
        { separator: true },
        {
          action: ActionType.AUTO_SETTLER,
          name: 'Auto Settler',
          icon: Hammer,
          hotkey: 'A',
        }
      );

      // Build submenu for workers
      const buildActions: UnitActionInfo[] = [
        {
          action: ActionType.BUILD_ROAD,
          name: 'Build Road',
          icon: Route,
          hotkey: 'R',
        },
        {
          action: ActionType.BUILD_IRRIGATION,
          name: 'Build Irrigation',
          icon: Zap,
          hotkey: 'I',
        },
        {
          action: ActionType.BUILD_MINE,
          name: 'Build Mine',
          icon: Pickaxe,
          hotkey: 'M',
        },
        {
          action: ActionType.TRANSFORM_TERRAIN,
          name: 'Transform Terrain',
          icon: Mountain,
          hotkey: 'O',
        },
      ];

      actions.push({
        action: ActionType.BUILD_ROAD, // Placeholder for submenu
        name: 'Build',
        icon: Hammer,
        submenu: buildActions,
      });
    }

    // Scout actions
    if (unit.type === 'scout') {
      actions.push(
        { separator: true },
        {
          action: ActionType.AUTO_EXPLORE,
          name: 'Auto Explore',
          icon: Search,
          hotkey: 'X',
        }
      );
    }

    // Common unit management actions
    actions.push(
      { separator: true },
      {
        action: ActionType.DISBAND_UNIT,
        name: 'Disband Unit',
        icon: Trash2,
        hotkey: 'Shift+D',
      }
    );

    return actions;
  };

  const availableActions = getAvailableActions(unit);

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
        {availableActions.map((actionInfo, index) => renderMenuItem(actionInfo, index))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
