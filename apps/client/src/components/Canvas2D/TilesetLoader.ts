// TilesetLoader - Port of freeciv-web's sprite loading system
// Based on freeciv-web/mapview.js init_sprites() and init_cache_sprites()
// NOTE: Freeciv constants are now loaded globally in index.html

interface TilesetConfig {
  tileset_tile_width: number;
  tileset_tile_height: number;
  tileset_name: string;
  tileset_image_count: number;
  is_isometric: number;
}

interface TilesetSpec {
  [key: string]: [number, number, number, number, number]; // x, y, width, height, sheet_index
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export class TilesetLoader {
  private config: TilesetConfig | null = null;
  private spec: TilesetSpec | null = null;
  private spriteSheets: HTMLImageElement[] = [];
  private sprites: Record<string, HTMLCanvasElement> = {};
  private isLoaded = false;

  constructor() {
    // Constants are now defined at module load time
  }

  async loadTileset(serverUrl: string): Promise<void> {
    try {
      await this.loadConfig(`${serverUrl}/js/2dcanvas/tileset_config_amplio2.js`);

      await this.loadSpec(`${serverUrl}/js/2dcanvas/tileset_spec_amplio2.js`);
      await this.loadSpriteSheets(serverUrl);

      this.cacheSprites();

      // Validate river sprite coverage
      this.logRiverSpriteValidation();

      this.isLoaded = true;
    } catch (error) {
      console.error('Failed to load tileset:', error);
      throw error;
    }
  }

  private async loadConfig(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.onload = () => {
        // Extract global variables set by the script
        this.config = {
          tileset_tile_width: (window as any).tileset_tile_width || 96,
          tileset_tile_height: (window as any).tileset_tile_height || 48,
          tileset_name: (window as any).tileset_name || 'amplio2',
          tileset_image_count: (window as any).tileset_image_count || 3,
          is_isometric: (window as any).is_isometric || 1,
        };
        document.head.removeChild(script);
        resolve();
      };
      script.onerror = () => {
        document.head.removeChild(script);
        reject(new Error(`Failed to load tileset config from ${url}`));
      };
      document.head.appendChild(script);
    });
  }

  private async loadSpec(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.onload = () => {
        this.spec = (window as any).tileset || null;
        if (!this.spec) {
          reject(new Error('Tileset spec not found in loaded script'));
          return;
        }
        document.head.removeChild(script);
        resolve();
      };
      script.onerror = () => {
        document.head.removeChild(script);
        reject(new Error(`Failed to load tileset spec from ${url}`));
      };
      document.head.appendChild(script);
    });
  }

  private async loadSpriteSheets(serverUrl: string): Promise<void> {
    if (!this.config) {
      throw new Error('Tileset config not loaded');
    }

    const loadPromises: Promise<void>[] = [];

    for (let i = 0; i < this.config.tileset_image_count; i++) {
      const promise = new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`Failed to load sprite sheet ${i}`));

        img.src = `${serverUrl}/tilesets/freeciv-web-tileset-${this.config!.tileset_name}-${i}.png`;
        this.spriteSheets[i] = img;
      });

      loadPromises.push(promise);
    }

    await Promise.all(loadPromises);
  }

  private cacheSprites(): void {
    if (!this.spec) {
      throw new Error('Tileset spec not loaded');
    }

    const sheetUsage: Record<number, number> = {};
    for (const tileTag in this.spec) {
      try {
        const [x, y, w, h, sheetIndex] = this.spec[tileTag];
        sheetUsage[sheetIndex] = (sheetUsage[sheetIndex] || 0) + 1;

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          console.warn(`Failed to get 2D context for sprite: ${tileTag}`);
          continue;
        }

        if (this.spriteSheets[sheetIndex]) {
          ctx.drawImage(this.spriteSheets[sheetIndex], x, y, w, h, 0, 0, w, h);
          this.sprites[tileTag] = canvas;
        } else {
          console.warn(`Sprite sheet ${sheetIndex} not found for sprite: ${tileTag}`);
        }
      } catch (error) {
        console.warn(`Problem caching sprite: ${tileTag}`, error);
      }
    }
  }

  getSprite(tag: string): HTMLCanvasElement | null {
    return this.sprites[tag] || null;
  }

  isReady(): boolean {
    return this.isLoaded;
  }

  getTileSize(): { width: number; height: number } {
    return {
      width: this.config?.tileset_tile_width || 96,
      height: this.config?.tileset_tile_height || 48,
    };
  }

  // Debug method to list available sprites
  getAvailableSprites(): string[] {
    return Object.keys(this.sprites);
  }

  // Debug method to find sprites by pattern
  findSprites(pattern: string): string[] {
    return Object.keys(this.sprites).filter(key =>
      key.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  /**
   * Validate river sprite coverage during tileset loading
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/tilesets.js:200-300 sprite validation
   */
  validateRiverSprites(): { missing: string[]; available: string[] } {
    const missing: string[] = [];
    const available: string[] = [];

    // Check for basic river sprites (16 combinations for N, E, S, W connections)
    const directions = ['n', 'e', 's', 'w'];

    for (let mask = 0; mask < 16; mask++) {
      let riverStr = '';
      for (let i = 0; i < 4; i++) {
        const hasConnection = (mask & (1 << i)) !== 0;
        riverStr += directions[i] + (hasConnection ? '1' : '0');
      }

      const spriteKey = `road.river_s_${riverStr}`;

      if (this.sprites[spriteKey]) {
        available.push(spriteKey);
      } else {
        missing.push(spriteKey);
      }
    }

    // Check for river outlet sprites
    const outletDirections = ['n', 'e', 's', 'w'];
    for (const dir of outletDirections) {
      const outletKey = `road.river_outlet_${dir}`;
      if (this.sprites[outletKey]) {
        available.push(outletKey);
      } else {
        missing.push(outletKey);
      }
    }

    return { missing, available };
  }

  /**
   * Log river sprite validation results
   */
  logRiverSpriteValidation(): void {
    const validation = this.validateRiverSprites();

    if (validation.available.length > 0) {
      console.log(`River sprites available: ${validation.available.length}`);
      if (import.meta.env.DEV) {
        console.log('Available river sprites:', validation.available.slice(0, 5)); // Show first 5 examples
      }
    }

    if (validation.missing.length > 0) {
      console.warn(`River sprites missing: ${validation.missing.length}`);
      if (import.meta.env.DEV) {
        console.warn('Missing river sprites:', validation.missing.slice(0, 10)); // Show first 10 missing
      }
    }
  }

  cleanup(): void {
    this.sprites = {};
    this.spriteSheets = [];
    this.config = null;
    this.spec = null;
    this.isLoaded = false;
  }
}
