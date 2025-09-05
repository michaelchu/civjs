/**
 * Service registry for dependency management following established patterns
 * @reference docs/refactor/REFACTORING_ARCHITECTURE_PATTERNS.md Service Registration Pattern
 */

import { GameService } from '@game/orchestrators/GameService';

export class ServiceRegistry {
  private services = new Map<string, GameService>();
  private initialized = false;

  /**
   * Register a service instance
   */
  register<T extends GameService>(key: string, service: T): void {
    this.services.set(key, service);
  }

  /**
   * Get a service instance by key
   */
  get<T extends GameService>(key: string): T {
    const service = this.services.get(key);
    if (!service) {
      throw new Error(`Service not found: ${key}`);
    }
    return service as T;
  }

  /**
   * Check if a service is registered
   */
  has(key: string): boolean {
    return this.services.has(key);
  }

  /**
   * Initialize all registered services
   */
  async initializeAll(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const initPromises = Array.from(this.services.values()).map(service => service.initialize());

    await Promise.all(initPromises);
    this.initialized = true;
  }

  /**
   * Cleanup all registered services
   */
  async cleanupAll(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    const cleanupPromises = Array.from(this.services.values()).map(service => service.cleanup());

    await Promise.all(cleanupPromises);
    this.initialized = false;
  }

  /**
   * Get list of all registered service names
   */
  getServiceNames(): string[] {
    return Array.from(this.services.keys());
  }
}
