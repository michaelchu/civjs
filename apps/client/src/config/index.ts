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

  // Detect Railway preview environments by checking for PR pattern in the domain
  // Preview URLs contain "-pr-" while production URLs don't
  if (currentDomain.includes('railway.app') && currentDomain.includes('-pr-')) {
    // Railway preview URLs follow pattern: civjs-frontend-civjs-pr-XXX.up.railway.app
    // We need to replace 'frontend' with 'backend'
    if (currentDomain.includes('frontend')) {
      return `https://${currentDomain.replace('frontend', 'backend')}`;
    }

    // Fallback: try replacing 'client' with 'server' for other patterns
    const parts = currentDomain.split('-');
    if (parts.length >= 3) {
      parts[0] = parts[0].replace('client', 'server');
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
