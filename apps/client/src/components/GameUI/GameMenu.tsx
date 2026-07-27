import React, { useState } from 'react';
import { LogOut, Menu, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { gameClient } from '../../services/GameClient';
import { useGameStore } from '../../store/gameStore';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

export const GameMenu: React.FC = () => {
  const navigate = useNavigate();
  const setActiveTab = useGameStore(state => state.setActiveTab);
  const [confirmExit, setConfirmExit] = useState(false);

  const exitToLobby = () => {
    gameClient.disconnect();
    useGameStore.setState({
      currentGameId: null,
      clientState: 'initial',
      activeTab: 'map',
      selectedUnitId: null,
      selectedCityId: null,
      focusedUnits: [],
      urgentFocusQueue: [],
    });
    navigate('/browse-games');
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex h-10 w-10 items-center justify-center rounded bg-gray-600 text-white transition-colors hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800"
            aria-label="Game menu"
            title="Game menu"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-44 border-gray-600 bg-gray-700 text-white"
        >
          <DropdownMenuItem
            className="cursor-pointer gap-2 focus:bg-gray-600 focus:text-white"
            onSelect={() => setActiveTab('options')}
          >
            <Settings className="h-4 w-4" aria-hidden="true" />
            Settings
            <span className="ml-auto text-xs text-gray-400">F6</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-gray-600" />
          <DropdownMenuItem
            className="cursor-pointer gap-2 text-red-300 focus:bg-red-950 focus:text-red-200"
            onSelect={() => setConfirmExit(true)}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Exit Game
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmExit} onOpenChange={setConfirmExit}>
        <DialogContent className="border-gray-600 bg-gray-800 text-white">
          <DialogHeader>
            <DialogTitle>Exit game?</DialogTitle>
            <DialogDescription className="text-gray-300">
              You will disconnect from this game and return to the lobby.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="border-gray-500 bg-transparent">
                Cancel
              </Button>
            </DialogClose>
            <Button variant="destructive" onClick={exitToLobby}>
              Exit Game
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
