import React, { useState } from 'react';
import { gameClient } from '../services/GameClient';
import { useGameStore } from '../store/gameStore';
import { SERVER_URL } from '../config';
import { PageBackground } from './shared/PageBackground';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface ConnectionDialogProps {
  showForm?: boolean;
}

export const ConnectionDialog: React.FC<ConnectionDialogProps> = ({ showForm = true }) => {
  const [playerName, setPlayerName] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');

  const clientState = useGameStore(state => state.clientState);
  const setClientState = useGameStore(state => state.setClientState);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!playerName.trim()) {
      setError('Please enter a player name');
      return;
    }

    setIsConnecting(true);
    setError('');

    try {
      await gameClient.connect();
      gameClient.joinGame(playerName.trim());
      setClientState('preparing');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to server');
    } finally {
      setIsConnecting(false);
    }
  };

  if (!showForm) {
    return (
      <PageBackground className="min-h-screen flex items-center justify-center">
        <div className="text-center text-foreground">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-lg">
            {clientState === 'connecting' && 'Connecting to game...'}
            {clientState === 'waiting_for_players' && 'Waiting for other players...'}
            {clientState === 'joining_game' && 'Joining game...'}
          </p>
        </div>
      </PageBackground>
    );
  }

  return (
    <PageBackground className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-2xl">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl">CivJS</CardTitle>
          <CardDescription>
            {clientState === 'connecting' && 'Connecting to server...'}
            {clientState === 'waiting_for_players' && 'Waiting for other players...'}
            {clientState === 'joining_game' && 'Joining game...'}
            {clientState === 'waiting_for_players' && (
              <p className="text-muted-foreground text-sm mt-2">
                Game will start once all players are ready
              </p>
            )}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleConnect} className="space-y-6">
            <div>
              <label
                htmlFor="playerName"
                className="block text-sm font-medium text-foreground mb-2"
              >
                Player Name
              </label>
              <Input
                id="playerName"
                type="text"
                value={playerName}
                onChange={e => setPlayerName(e.target.value)}
                placeholder="Enter your name"
                className="bg-background"
                disabled={isConnecting}
                maxLength={32}
              />
            </div>

            {error && (
              <div
                role="alert"
                className="p-3 bg-destructive/10 border border-destructive/30 rounded-md text-destructive text-sm"
              >
                {error}
              </div>
            )}

            <Button type="submit" disabled={isConnecting || !playerName.trim()} className="w-full">
              {isConnecting ? (
                <div className="flex items-center justify-center">
                  <div className="animate-spin w-5 h-5 border-2 border-primary-foreground/30 border-t-transparent rounded-full mr-2"></div>
                  Connecting...
                </div>
              ) : (
                'Connect to Game'
              )}
            </Button>
          </form>
        </CardContent>

        <CardFooter className="border-t border-border justify-center">
          <div className="text-xs text-muted-foreground text-center">
            <p>Server: {SERVER_URL}</p>
            <p className="mt-1">Make sure the server is running before connecting</p>
          </div>
        </CardFooter>
      </Card>
    </PageBackground>
  );
};
