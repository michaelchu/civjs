// Client configuration
export const config = {
  // Server URL - uses environment variable, or defaults based on environment
  serverUrl: import.meta.env.VITE_SERVER_URL || 
    (import.meta.env.DEV ? 'http://localhost:3001' : 'https://civjs.up.railway.app'),
  
  // Development mode
  isDev: import.meta.env.DEV,
  
  // Production mode
  isProd: import.meta.env.PROD,
} as const;

// Export for convenience
export const SERVER_URL = config.serverUrl;