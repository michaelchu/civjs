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

  // Production/Preview mode - try to construct dynamic URL
  const currentDomain = window.location.hostname;

  // If we're on a Railway preview domain (contains 'railway.app')
  if (currentDomain.includes('railway.app')) {
    // Extract the service name pattern and construct backend URL
    // Railway preview URLs follow pattern: servicename-projectname-hash.up.railway.app
    const parts = currentDomain.split('-');
    if (parts.length >= 3) {
      // Replace the first part (assumed to be 'client' or frontend service name) with 'server'
      parts[0] = 'server';
      return `https://${parts.join('-')}`;
    }
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
