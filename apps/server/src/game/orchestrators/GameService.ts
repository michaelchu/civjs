/**
 * Base interface for all game services following the established architecture patterns
 * @reference docs/refactor/REFACTORING_ARCHITECTURE_PATTERNS.md Service Layer Organization
 */

import { logger as baseLogger } from '@utils/logger';

export interface GameService {
  /**
   * Initialize the service with required dependencies
   */
  initialize(): Promise<void>;

  /**
   * Cleanup resources when service is destroyed
   */
  cleanup(): Promise<void>;

  /**
   * Get service name for logging and debugging
   */
  getServiceName(): string;
}

/**
 * Base class providing common functionality for game services
 */
export abstract class BaseGameService implements GameService {
  protected logger: typeof baseLogger;

  constructor(logger: typeof baseLogger) {
    this.logger = logger;
  }

  async initialize(): Promise<void> {
    this.logger.info(`Initializing ${this.getServiceName()}`);
  }

  async cleanup(): Promise<void> {
    this.logger.info(`Cleaning up ${this.getServiceName()}`);
  }

  abstract getServiceName(): string;
}
