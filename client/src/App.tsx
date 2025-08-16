import { useEffect, useState } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { io } from 'socket.io-client';
import { useGameStore } from './stores/gameStore';
import GamesList from './components/GamesList';
import CreateGame from './components/CreateGame';
import GameLobby from './components/GameLobby';
import GameBoard from './components/GameBoard';
import HomePage from './components/HomePage';
import Layout from './components/Layout';

function App() {
  const [connected, setConnected] = useState(false);
  const { error, clearError } = useGameStore();

  useEffect(() => {
    // Connect to the server
    const newSocket = io(process.env.VITE_WS_URL || 'http://localhost:3001');

    newSocket.on('connect', () => {
      console.log('Connected to server');
      setConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from server');
      setConnected(false);
    });

    return () => {
      newSocket.close();
    };
  }, []);

  return (
    <Router>
      <Layout error={error} onClearError={clearError}>
        <Routes>
          {/* Home page */}
          <Route path="/" element={<HomePage connected={connected} />} />

          {/* Games routes */}
          <Route path="/games" element={<GamesList />} />
          <Route path="/games/create" element={<CreateGame />} />
          <Route path="/games/:gameId/lobby" element={<GameLobby />} />
          <Route
            path="/games/:gameId/play"
            element={<GameBoard connected={connected} />}
          />

          {/* Redirect unknown routes to home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
