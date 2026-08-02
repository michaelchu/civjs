/**
 * @module client/config/index
 * Defines client runtime configuration.
 */
// Client configuration
export const config = {
  // Server URL - use an explicit override when provided; otherwise use the local server.
  serverUrl: import.meta.env.VITE_SERVER_URL || 'http://localhost:3001',

  // Development mode
  isDev: import.meta.env.DEV,

  // Production mode
  isProd: import.meta.env.PROD,
} as const;

// Export for convenience
export const SERVER_URL = config.serverUrl;
