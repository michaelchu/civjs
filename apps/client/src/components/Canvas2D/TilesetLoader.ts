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
      // Load configuration and specification from server (like freeciv-web lines 51-65)
      await this.loadConfig(`${serverUrl}/js/2dcanvas/tileset_config_amplio2.js`);
      
      await this.loadSpec(`${serverUrl}/js/2dcanvas/tileset_spec_amplio2.js`);
      
      // Load sprite sheets from server (like freeciv-web lines 139-140)
      await this.loadSpriteSheets(serverUrl);
      
      // Cache individual sprites (like freeciv-web lines 174-210)
      this.cacheSprites();
      
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
        // Extract the tileset spec from global variable
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
        
        // Same URL pattern as freeciv-web
        img.src = `${serverUrl}/tileset/freeciv-web-tileset-${this.config!.tileset_name}-${i}.png`;
        this.spriteSheets[i] = img;
      });
      
      loadPromises.push(promise);
    }
    
    await Promise.all(loadPromises);
  }
  
  // Port of freeciv-web's init_cache_sprites() - Lines 174-210
  private cacheSprites(): void {
    if (!this.spec) {
      throw new Error('Tileset spec not loaded');
    }
    
    for (const tileTag in this.spec) {
      try {
        const [x, y, w, h, sheetIndex] = this.spec[tileTag];
        
        // Create individual sprite canvas (exactly like freeciv-web)
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          console.warn(`Failed to get 2D context for sprite: ${tileTag}`);
          continue;
        }
        
        // Extract sprite from sheet
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
  
  cleanup(): void {
    this.sprites = {};
    this.spriteSheets = [];
    this.config = null;
    this.spec = null;
    this.isLoaded = false;
  }
}