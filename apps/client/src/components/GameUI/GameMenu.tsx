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
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 bg-slate-950/70 text-white shadow-lg backdrop-blur-md transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-cyan-300/70 focus:ring-offset-2 focus:ring-offset-slate-900"
            aria-label="Game menu"
            title="Game menu"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-44 border-white/15 bg-slate-950/90 text-white shadow-2xl backdrop-blur-md"
        >
          <DropdownMenuItem
            className="cursor-pointer gap-2 focus:bg-white/10 focus:text-white"
            onSelect={() => setActiveTab('options')}
          >
            <Settings className="h-4 w-4" aria-hidden="true" />
            Settings
            <span className="ml-auto text-xs text-slate-500">F6</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-white/10" />
          <DropdownMenuItem
            className="cursor-pointer gap-2 text-rose-300 focus:bg-rose-400/15 focus:text-rose-200"
            onSelect={() => setConfirmExit(true)}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Exit Game
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmExit} onOpenChange={setConfirmExit}>
        <DialogContent className="border-white/15 bg-slate-900/95 text-white shadow-2xl backdrop-blur-md">
          <DialogHeader>
            <DialogTitle>Exit game?</DialogTitle>
            <DialogDescription className="text-slate-400">
              You will disconnect from this game and return to the lobby.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button
                variant="outline"
                className="border-white/20 bg-white/5 text-slate-200 hover:bg-white/10"
              >
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
