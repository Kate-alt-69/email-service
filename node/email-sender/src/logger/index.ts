/**
 * Logger Index - Bridges local logger.dump.ts with Bootstrap-injected loggers
 * 
 * Import flow:
 * 1. Service imports from '@/logger'
 * 2. If Bootstrap provided logger.js via IPC: uses that
 * 3. Fallback: uses local logger.dump.ts
 * 4. Both expose same interface (Logger class)
 */

import { Logger, LoggerConfig, LogLevel, getGlobalLogger, setGlobalLogger } from './logger.dump';

export { Logger, LoggerConfig, LogLevel, getGlobalLogger, setGlobalLogger };

/**
 * Create or get logger instance
 * Called by services on startup
 */
export function createLogger(config: LoggerConfig): Logger {
  const logger = new Logger(config);
  setGlobalLogger(logger);
  return logger;
}

/**
 * Request logger from Bootstrap Manager
 * Returns a promise that resolves to logger config
 * Used when Bootstrap provides logger via IPC
 */
export async function requestLoggerFromBootstrap(): Promise<LoggerConfig | null> {
  // This would be called when running under Bootstrap management
  // For now, returns null (falls back to local logger)
  
  if (typeof process !== 'undefined' && process.env.BOOTSTRAP_IPC_PATH) {
    // Try to request logger from Bootstrap via IPC
    // Implementation will be added when Bootstrap IPC is ready
    try {
      // TODO: Implement IPC request to Bootstrap
      // For now, return null to use local logger
      return null;
    } catch (error) {
      console.error('Failed to request logger from Bootstrap:', error);
      return null;
    }
  }
  
  return null;
}

// Default export - the global logger instance
export default getGlobalLogger();
