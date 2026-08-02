/**
 * @module client/utils/logger
 * Provides logger client utilities.
 */
type ClientLogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const levels: Record<ClientLogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

const configuredLevel = (import.meta.env.VITE_LOG_LEVEL || 'warn') as ClientLogLevel;
const currentLevel = levels[configuredLevel] ?? levels.warn;

export const clientLogger = {
  debug: (...args: unknown[]) => {
    if (currentLevel >= levels.debug) console.debug(...args);
  },
  info: (...args: unknown[]) => {
    if (currentLevel >= levels.info) console.info(...args);
  },
  warn: (...args: unknown[]) => {
    if (currentLevel >= levels.warn) console.warn(...args);
  },
  error: (...args: unknown[]) => {
    if (currentLevel >= levels.error) console.error(...args);
  },
};
