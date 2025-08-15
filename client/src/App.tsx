import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Connect to the server
    const newSocket = io('http://localhost:3001');
    
    newSocket.on('connect', () => {
      console.log('Connected to server');
      setConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from server');
      setConnected(false);
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white p-8 rounded-lg shadow-lg">
        <h1 className="text-4xl font-bold text-gray-800 mb-4">CivJS</h1>
        <p className="text-gray-600 mb-4">Browser-based Civilization Game</p>
        
        <div className="flex items-center space-x-2">
          <div className={`w-3 h-3 rounded-full ${
            connected ? 'bg-green-500' : 'bg-red-500'
          }`}></div>
          <span className="text-sm text-gray-600">
            {connected ? 'Connected to server' : 'Disconnected from server'}
          </span>
        </div>
        
        <div className="mt-6">
          <button 
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded"
            disabled={!connected}
          >
            {connected ? 'Ready to Play!' : 'Connecting...'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
