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

      // Comprehensive sprite validation
      this.validateSpriteCoverage();

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

  /**
   * Comprehensive sprite coverage validation during tileset loading
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:102-130 tileset_has_tag() and fallback logic
   */
  private validateSpriteCoverage(): void {
    const requiredSprites = this.getRequiredSpriteList();
    const missingSprites: string[] = [];
    const availableSprites: string[] = [];

    console.log('Validating sprite coverage...');

    requiredSprites.forEach(spriteKey => {
      if (this.sprites[spriteKey]) {
        availableSprites.push(spriteKey);
      } else {
        missingSprites.push(spriteKey);
      }
    });

    // Log validation results
    console.log(
      `Sprite validation complete: ${availableSprites.length}/${requiredSprites.length} sprites available`
    );

    if (missingSprites.length > 0) {
      console.warn(`Missing sprites (${missingSprites.length}):`, missingSprites.slice(0, 20)); // Show first 20

      // Attempt to load fallback sprites for missing ones
      this.loadFallbackSprites(missingSprites);
    }

    // Validate river sprites separately for detailed reporting
    this.logRiverSpriteValidation();

    // Log overall sprite coverage statistics
    const totalSprites = Object.keys(this.sprites).length;
    const coveragePercent = ((availableSprites.length / requiredSprites.length) * 100).toFixed(1);
    console.log(`Total sprites loaded: ${totalSprites}, Required coverage: ${coveragePercent}%`);
  }

  /**
   * Get list of required sprites for basic game functionality
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:113-130 tileset_ruleset_entity_tag_str_or_alt() fallback pattern
   */
  private getRequiredSpriteList(): string[] {
    const requiredSprites: string[] = [];

    // Basic terrain sprites (layer 0, 1, 2 with common match patterns)
    const terrainTypes = [
      'grassland',
      'plains',
      'desert',
      'forest',
      'hills',
      'mountains',
      'tundra',
      'swamp',
      'jungle',
      'coast',
      'floor',
      'lake',
      'arctic',
    ];

    terrainTypes.forEach(terrain => {
      // Layer 0, 1, 2 sprites
      for (let layer = 0; layer <= 2; layer++) {
        requiredSprites.push(`t.l${layer}.${terrain}1`);

        // Common match patterns for MATCH_SAME terrain blending
        for (let mask = 0; mask < 16; mask++) {
          const dirStr = this.getMaskDirectionString(mask);
          requiredSprites.push(`t.l${layer}.${terrain}_${dirStr}`);
        }
      }
    });

    // River sprites (already covered by validateRiverSprites)
    const riverValidation = this.validateRiverSprites();
    requiredSprites.push(...riverValidation.missing, ...riverValidation.available);

    // Basic unit sprites
    const unitTypes = ['warriors', 'phalanx', 'archers', 'legion', 'pikemen', 'musketeers'];
    unitTypes.forEach(unit => {
      requiredSprites.push(`${unit}_Idle`);
    });

    // Basic city sprites
    const citySizes = ['0', '1', '2', '3', '4'];
    const cityWalls = ['city', 'wall'];
    citySizes.forEach(size => {
      cityWalls.forEach(wall => {
        requiredSprites.push(`city.european_${wall}_${size}`);
      });
    });

    // Remove duplicates
    return Array.from(new Set(requiredSprites));
  }

  /**
   * Convert bitmask to direction string (e.g., mask 5 -> "n1e0s1w0")
   */
  private getMaskDirectionString(mask: number): string {
    const directions = ['n', 'e', 's', 'w'];
    let result = '';

    for (let i = 0; i < 4; i++) {
      const hasConnection = (mask & (1 << i)) !== 0;
      result += directions[i] + (hasConnection ? '1' : '0');
    }

    return result;
  }

  /**
   * Attempt to load fallback sprites for missing ones
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:120-126 graphic_alt fallback pattern
   */
  private loadFallbackSprites(missingSprites: string[]): void {
    const fallbacksLoaded: string[] = [];

    missingSprites.forEach(spriteKey => {
      const fallbackKeys = this.generateFallbackSpriteKeys(spriteKey);

      for (const fallbackKey of fallbackKeys) {
        if (this.sprites[fallbackKey]) {
          // Create a copy of the fallback sprite for the missing key
          this.sprites[spriteKey] = this.sprites[fallbackKey];
          fallbacksLoaded.push(`${spriteKey} -> ${fallbackKey}`);
          break;
        }
      }
    });

    if (fallbacksLoaded.length > 0) {
      console.log(
        `Fallback sprites loaded (${fallbacksLoaded.length}):`,
        fallbacksLoaded.slice(0, 10)
      );
    }
  }

  /**
   * Generate fallback sprite keys for a missing sprite
   * Based on freeciv-web's graphic_str -> graphic_alt fallback pattern
   */
  generateFallbackSpriteKeys(originalKey: string): string[] {
    const fallbacks: string[] = [];

    // Terrain sprite fallbacks
    if (originalKey.startsWith('t.l')) {
      // Try simpler versions (remove match patterns)
      const baseMatch = originalKey.match(/^(t\.l\d+\.)([^_]+)/);
      if (baseMatch) {
        const prefix = baseMatch[1];
        const terrain = baseMatch[2];

        // Try basic sprite without match patterns
        fallbacks.push(`${prefix}${terrain}1`);

        // Try other common match patterns
        fallbacks.push(`${prefix}${terrain}_n0e0s0w0`);
        fallbacks.push(`${prefix}${terrain}_cell_u_u_u_u`);

        // Try alternative terrain graphics
        const terrainAlternatives: Record<string, string[]> = {
          coast: ['floor', 'lake'],
          floor: ['coast'],
          lake: ['coast', 'floor'],
          arctic: ['tundra', 'plains'],
          jungle: ['forest'],
          swamp: ['grassland'],
        };

        if (terrainAlternatives[terrain]) {
          terrainAlternatives[terrain].forEach(alt => {
            fallbacks.push(`${prefix}${alt}1`);
            fallbacks.push(`${prefix}${alt}_n0e0s0w0`);
          });
        }
      }
    }

    // River sprite fallbacks
    if (originalKey.startsWith('road.river_s_')) {
      // Try simpler river patterns
      fallbacks.push('road.river_s_n0e0s0w0'); // No connections
      fallbacks.push('road.river_s_n1e0s0w0'); // North only
      fallbacks.push('road.river_s_n0e1s0w0'); // East only
      fallbacks.push('road.river_s_n0e0s1w0'); // South only
      fallbacks.push('road.river_s_n0e0s0w1'); // West only
    }

    // Unit sprite fallbacks
    if (originalKey.endsWith('_Idle')) {
      const unitName = originalKey.replace('_Idle', '');
      // Try alternative unit graphics
      fallbacks.push(`u.${unitName}`);
      fallbacks.push('warriors_Idle'); // Ultimate fallback for any unit
    }

    // City sprite fallbacks
    if (originalKey.startsWith('city.')) {
      // Try simpler city sprites
      fallbacks.push('city.european_city_0');
      fallbacks.push('city.generic_city_0');
    }

    return fallbacks;
  }

  /**
   * Check if a specific sprite exists
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:102-105 tileset_has_tag()
   */
  hasSprite(tag: string): boolean {
    return this.sprites[tag] != null;
  }

  /**
   * Get sprite with fallback support
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:113-130 tileset_ruleset_entity_tag_str_or_alt()
   */
  getSpriteWithFallback(tag: string): HTMLCanvasElement | null {
    // Try primary sprite
    if (this.sprites[tag]) {
      return this.sprites[tag];
    }

    // Try fallback sprites
    const fallbackKeys = this.generateFallbackSpriteKeys(tag);
    for (const fallbackKey of fallbackKeys) {
      if (this.sprites[fallbackKey]) {
        return this.sprites[fallbackKey];
      }
    }

    return null;
  }

  cleanup(): void {
    this.sprites = {};
    this.spriteSheets = [];
    this.config = null;
    this.spec = null;
    this.isLoaded = false;
  }

  /**
   * Get sprite coverage statistics for debugging
   */
  getSpriteCoverageStats(): {
    totalSprites: number;
    requiredSprites: number;
    missingSprites: number;
    coveragePercent: number;
  } {
    const requiredSprites = this.getRequiredSpriteList();
    const availableCount = requiredSprites.filter(key => this.sprites[key]).length;
    const missingCount = requiredSprites.length - availableCount;

    return {
      totalSprites: Object.keys(this.sprites).length,
      requiredSprites: requiredSprites.length,
      missingSprites: missingCount,
      coveragePercent: (availableCount / requiredSprites.length) * 100,
    };
  }
}
