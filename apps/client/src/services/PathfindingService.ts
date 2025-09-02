import { gameClient } from './GameClient';

export interface PathTile {
  x: number;
  y: number;
  moveCost: number;
  direction?: number; // Direction from previous tile (for rendering path lines)
}

export interface GotoPath {
  unitId: string;
  tiles: PathTile[];
  totalCost: number;
  estimatedTurns: number;
  valid: boolean;
}

export interface PathRequest {
  unitId: string;
  targetX: number;
  targetY: number;
}

export interface PathResponse {
  unitId: string;
  targetX: number;
  targetY: number;
  path: GotoPath | null;
  success: boolean;
  error?: string;
}

/**
 * Service for handling pathfinding communication between client and server
 * Based on freeciv-web's goto path system with caching and request management
 * 
 * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/control.js - goto_request_map cache
 * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/packhand.js - handle_web_goto_path
 * @compliance Implements client-side path request/response pattern matching freeciv-web
 */
export class PathfindingService {
  private static instance: PathfindingService;
  private pathCache = new Map<string, GotoPath>();
  private pendingRequests = new Set<string>();

  static getInstance(): PathfindingService {
    if (!PathfindingService.instance) {
      PathfindingService.instance = new PathfindingService();
    }
    return PathfindingService.instance;
  }

  /**
   * Request a goto path from the server
   * Similar to freeciv-web's request_goto_path function
   */
  async requestPath(unitId: string, targetX: number, targetY: number): Promise<GotoPath | null> {
    const requestKey = `${unitId}-${targetX}-${targetY}`;

    // Check if we already have this path cached
    if (this.pathCache.has(requestKey)) {
      return this.pathCache.get(requestKey)!;
    }

    // Check if we're already requesting this path
    if (this.pendingRequests.has(requestKey)) {
      // Wait for the pending request to complete
      return new Promise(resolve => {
        const checkForResult = () => {
          if (this.pathCache.has(requestKey)) {
            resolve(this.pathCache.get(requestKey)!);
          } else if (this.pendingRequests.has(requestKey)) {
            setTimeout(checkForResult, 100); // Check again in 100ms
          } else {
            resolve(null); // Request failed or was cancelled
          }
        };
        setTimeout(checkForResult, 100);
      });
    }

    // Mark as pending
    this.pendingRequests.add(requestKey);

    try {
      // Send path request to server via GameClient socket
      const path = await this.sendPathRequest({ unitId, targetX, targetY });

      if (path) {
        // Cache the result
        this.pathCache.set(requestKey, path);
        return path;
      }
    } catch (error) {
      console.error('Error requesting path:', error);
    } finally {
      // Remove from pending
      this.pendingRequests.delete(requestKey);
    }

    return null;
  }

  /**
   * Clear cached paths for a specific unit
   */
  clearPathsForUnit(unitId: string): void {
    for (const [key, path] of this.pathCache.entries()) {
      if (path.unitId === unitId) {
        this.pathCache.delete(key);
      }
    }
  }

  /**
   * Clear all cached paths
   */
  clearAllPaths(): void {
    this.pathCache.clear();
    this.pendingRequests.clear();
  }

  /**
   * Get cached path if available
   */
  getCachedPath(unitId: string, targetX: number, targetY: number): GotoPath | null {
    const requestKey = `${unitId}-${targetX}-${targetY}`;
    return this.pathCache.get(requestKey) || null;
  }

  /**
   * Send path request to server and wait for response
   * This will be enhanced when we implement socket events for pathfinding
   */
  private async sendPathRequest(request: PathRequest): Promise<GotoPath | null> {
    return new Promise(resolve => {
      const socket = gameClient.getSocket();
      if (!socket) {
        console.error('No socket connection available for path request');
        resolve(null);
        return;
      }

      // Set up response handler
      const responseHandler = (response: PathResponse) => {
        if (
          response.unitId === request.unitId &&
          response.targetX === request.targetX &&
          response.targetY === request.targetY
        ) {
          // Remove the listener to avoid memory leaks
          socket.off('path_response', responseHandler);

          if (response.success && response.path) {
            resolve(response.path as GotoPath);
          } else {
            console.warn('Path request failed:', response.error);
            resolve(null);
          }
        }
      };

      // Listen for response
      socket.on('path_response', responseHandler);

      // Send request
      socket.emit('path_request', request);

      // Set timeout to avoid hanging requests
      setTimeout(() => {
        socket.off('path_response', responseHandler);
        console.warn('Path request timeout for:', request);
        resolve(null);
      }, 5000); // 5 second timeout
    });
  }

  /**
   * Calculate direction from one tile to another
   * Used for rendering path lines - matches freeciv direction system
   */
  static calculateDirection(fromX: number, fromY: number, toX: number, toY: number): number {
    const dx = toX - fromX;
    const dy = toY - fromY;

    // Freeciv uses 8 directions: 0=North, 1=NE, 2=East, 3=SE, 4=South, 5=SW, 6=West, 7=NW
    if (dx === 0 && dy === -1) return 0; // North
    if (dx === 1 && dy === -1) return 1; // NE
    if (dx === 1 && dy === 0) return 2; // East
    if (dx === 1 && dy === 1) return 3; // SE
    if (dx === 0 && dy === 1) return 4; // South
    if (dx === -1 && dy === 1) return 5; // SW
    if (dx === -1 && dy === 0) return 6; // West
    if (dx === -1 && dy === -1) return 7; // NW

    // Default to east if no exact match
    return 2;
  }
}

// Export singleton instance
export const pathfindingService = PathfindingService.getInstance();
