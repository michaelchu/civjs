/**
 * GameObjectLayer - Renders units, cities, and other game objects
 * Overlay layer on top of terrain
 */

import { Canvas2DRenderer } from './Canvas2DRenderer';

export interface Unit {
  id: string;
  x: number;
  y: number;
  type: string;
  owner?: string;
  health?: number;
}

export interface City {
  id: string;
  x: number;
  y: number;
  name: string;
  owner?: string;
  population?: number;
}

export class GameObjectLayer {
  private renderer: Canvas2DRenderer;
  private units: Unit[] = [];
  private cities: City[] = [];
  private unitSprites: Map<string, HTMLCanvasElement> = new Map();
  private citySprite: HTMLCanvasElement;

  constructor(renderer: Canvas2DRenderer) {
    this.renderer = renderer;
    this.citySprite = this.createCitySprite();
    this.initializeUnitSprites();
  }

  /**
   * Initialize unit sprites for different unit types
   */
  private initializeUnitSprites(): void {
    const unitTypes = ['warrior', 'settler', 'worker', 'scout'];

    unitTypes.forEach(type => {
      const sprite = this.createUnitSprite(type);
      this.unitSprites.set(type, sprite);
    });
  }

  /**
   * Create a sprite for a unit type
   */
  private createUnitSprite(type: string): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to create unit sprite context');

    // Simple unit representation - circle with type indicator
    ctx.save();

    // Draw unit background circle
    ctx.fillStyle = this.getUnitColor(type);
    ctx.beginPath();
    ctx.arc(16, 16, 12, 0, Math.PI * 2);
    ctx.fill();

    // Draw unit border
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw unit type symbol
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.getUnitSymbol(type), 16, 16);

    ctx.restore();

    return canvas;
  }

  /**
   * Get color for unit type
   */
  private getUnitColor(type: string): string {
    const colors: Record<string, string> = {
      warrior: '#FF4444',
      settler: '#4444FF',
      worker: '#FFAA00',
      scout: '#44FF44',
    };
    return colors[type] || '#888888';
  }

  /**
   * Get symbol for unit type
   */
  private getUnitSymbol(type: string): string {
    const symbols: Record<string, string> = {
      warrior: '⚔',
      settler: '🏠',
      worker: '⚒',
      scout: '👁',
    };
    return symbols[type] || '?';
  }

  /**
   * Create a sprite for cities
   */
  private createCitySprite(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to create city sprite context');

    ctx.save();

    // Draw city base (walls)
    ctx.fillStyle = '#8B7355';
    ctx.fillRect(8, 24, 32, 16);

    // Draw buildings
    ctx.fillStyle = '#D2691E';
    ctx.fillRect(12, 16, 8, 12);
    ctx.fillRect(20, 12, 8, 16);
    ctx.fillRect(28, 18, 8, 10);

    // Draw roofs
    ctx.fillStyle = '#8B4513';
    ctx.beginPath();
    ctx.moveTo(10, 16);
    ctx.lineTo(16, 10);
    ctx.lineTo(22, 16);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(18, 12);
    ctx.lineTo(24, 6);
    ctx.lineTo(30, 12);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(26, 18);
    ctx.lineTo(32, 12);
    ctx.lineTo(38, 18);
    ctx.closePath();
    ctx.fill();

    // Draw city border
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(8, 24, 32, 16);

    ctx.restore();

    return canvas;
  }

  /**
   * Update the units to render
   */
  public setUnits(units: Unit[]): void {
    this.units = units;
  }

  /**
   * Update the cities to render
   */
  public setCities(cities: City[]): void {
    this.cities = cities;
  }

  /**
   * Render all game objects on the provided context
   */
  public render(ctx: CanvasRenderingContext2D, viewport: any): void {
    // Render cities first (they're larger and should be behind units)
    this.cities.forEach(city => {
      const screenPos = this.renderer['isoToScreen'](city.x, city.y);

      // Check if city is visible in viewport
      if (this.isInViewport(screenPos.x, screenPos.y, viewport)) {
        ctx.drawImage(this.citySprite, screenPos.x - 24, screenPos.y - 24);

        // Draw city name
        ctx.save();
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.strokeText(city.name, screenPos.x, screenPos.y + 20);
        ctx.fillText(city.name, screenPos.x, screenPos.y + 20);
        ctx.restore();
      }
    });

    // Render units on top
    this.units.forEach(unit => {
      const screenPos = this.renderer['isoToScreen'](unit.x, unit.y);

      // Check if unit is visible in viewport
      if (this.isInViewport(screenPos.x, screenPos.y, viewport)) {
        const sprite =
          this.unitSprites.get(unit.type) || this.unitSprites.get('warrior');
        if (sprite) {
          ctx.drawImage(sprite, screenPos.x - 16, screenPos.y - 16);

          // Draw health bar if damaged
          if (unit.health !== undefined && unit.health < 100) {
            this.drawHealthBar(ctx, screenPos.x, screenPos.y - 20, unit.health);
          }
        }
      }
    });
  }

  /**
   * Draw a health bar for a unit
   */
  private drawHealthBar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    health: number
  ): void {
    const width = 24;
    const height = 4;

    ctx.save();

    // Background
    ctx.fillStyle = '#000000';
    ctx.fillRect(x - width / 2, y, width, height);

    // Health fill
    const healthPercent = health / 100;
    if (healthPercent > 0.6) {
      ctx.fillStyle = '#00FF00';
    } else if (healthPercent > 0.3) {
      ctx.fillStyle = '#FFFF00';
    } else {
      ctx.fillStyle = '#FF0000';
    }
    ctx.fillRect(x - width / 2, y, width * healthPercent, height);

    // Border
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - width / 2, y, width, height);

    ctx.restore();
  }

  /**
   * Check if a position is visible in the viewport
   */
  private isInViewport(x: number, y: number, viewport: any): boolean {
    return (
      x >= viewport.x - 50 &&
      x <= viewport.x + viewport.width + 50 &&
      y >= viewport.y - 50 &&
      y <= viewport.y + viewport.height + 50
    );
  }

  /**
   * Get unit at position
   */
  public getUnitAt(tileX: number, tileY: number): Unit | undefined {
    return this.units.find(u => u.x === tileX && u.y === tileY);
  }

  /**
   * Get city at position
   */
  public getCityAt(tileX: number, tileY: number): City | undefined {
    return this.cities.find(c => c.x === tileX && c.y === tileY);
  }
}
