import React, { useEffect, useState } from 'react';
import { LogOut, Menu, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { gameClient } from '../../services/GameClient';
import { useGameStore } from '../../store/gameStore';
import { Button } from '../ui/button';
import { HudActionButton } from './HudActionButton';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

export const GameMenu: React.FC = () => {
  const navigate = useNavigate();
  const setActiveTab = useGameStore(state => state.setActiveTab);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [menuOpen]);

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
      <HudActionButton
        compact
        label="Game menu"
        icon={Menu}
        active={menuOpen}
        aria-expanded={menuOpen}
        aria-controls="game-menu-popover"
        onClick={() => setMenuOpen(value => !value)}
      />
      {menuOpen && (
        <div
          id="game-menu-popover"
          role="dialog"
          aria-label="Game menu"
          className="hud-surface absolute bottom-full right-0 mb-2 min-w-44 rounded-xl border p-2 text-white"
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-slate-200 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
            onClick={() => {
              setActiveTab('options');
              setMenuOpen(false);
            }}
          >
            <Settings className="h-4 w-4" aria-hidden="true" />
            Settings
            <span className="ml-auto text-xs text-slate-500">F6</span>
          </button>
          <div className="my-1 h-px bg-white/10" />
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-rose-300 transition-colors hover:bg-rose-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/70"
            onClick={() => {
              setMenuOpen(false);
              setConfirmExit(true);
            }}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Exit Game
          </button>
        </div>
      )}

      <Dialog open={confirmExit} onOpenChange={setConfirmExit}>
        <DialogContent className="border-white/15 bg-slate-900/90 text-white shadow-2xl backdrop-blur-xl">
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
