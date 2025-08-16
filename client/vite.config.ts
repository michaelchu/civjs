import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.VITE_API_URL': JSON.stringify(
      process.env.VITE_API_URL || 'http://localhost:3001'
    ),
    'process.env.VITE_WS_URL': JSON.stringify(
      process.env.VITE_WS_URL || 'ws://localhost:3001'
    ),
  },
});
