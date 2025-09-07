// Helper function to construct dynamic server URL for Railway previews
const getServerUrl = (): string => {
  // If VITE_SERVER_URL is explicitly set, use it
  if (import.meta.env.VITE_SERVER_URL) {
    return import.meta.env.VITE_SERVER_URL;
  }

  // Development mode - use localhost
  if (import.meta.env.DEV) {
    return 'http://localhost:3001';
  }

  // Railway preview environments - use PREVIEW_BACKEND_URL if available
  if (import.meta.env.VITE_PREVIEW_BACKEND_URL) {
    return import.meta.env.VITE_PREVIEW_BACKEND_URL;
  }

  // Fallback to production URL
  return 'https://civjs.up.railway.app';
};

// Client configuration
export const config = {
  // Server URL - uses dynamic resolution for Railway previews
  serverUrl: getServerUrl(),

  // Development mode
  isDev: import.meta.env.DEV,

  // Production mode
  isProd: import.meta.env.PROD,
} as const;

// Export for convenience
export const SERVER_URL = config.serverUrl;
