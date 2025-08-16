import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import * as Phaser from 'phaser';

interface GameState {
  mapWidth?: number;
  mapHeight?: number;
  map?: Array<{ x: number; y: number; terrain: string }>;
  units?: Array<{ id: string; x: number; y: number; type: string }>;
  cities?: Array<{ id: string; x: number; y: number; name: string }>;
}

interface PhaserGameProps {
  gameId: string;
  gameState: GameState | null;
  onTileClick?: (x: number, y: number) => void;
  onUnitSelect?: (unitId: string) => void;
  onEndTurn?: () => void;
}

interface PhaserGameHandle {
  updateGameState: (state: GameState) => void;
  centerCamera: (x: number, y: number) => void;
  highlightTile: (x: number, y: number) => void;
}

type TerrainType =
  | 'ocean'
  | 'coast'
  | 'grassland'
  | 'plains'
  | 'forest'
  | 'hills'
  | 'mountains'
  | 'desert'
  | 'tundra';

class GameMapScene extends Phaser.Scene {
  private gameState: GameState | null = null;
  private unitSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private citySprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private tileWidth = 64;
  private tileHeight = 32;
  private mapContainer?: Phaser.GameObjects.Container;
  private terrainMap: TerrainType[][] = [];
  private callbacks: {
    onTileClick?: (x: number, y: number) => void;
    onUnitSelect?: (unitId: string) => void;
    onEndTurn?: () => void;
  } = {};

  // Camera control properties
  private isMiddleMouseDown = false;
  private edgeScrollSpeed = 8;
  private edgeScrollMargin = 50;
  private panSpeed = 50;

  constructor() {
    super({ key: 'GameMapScene' });
  }

  private getTerrainColor(terrain: TerrainType): number {
    const terrainColors: Record<TerrainType, number> = {
      ocean: 0x1e40af, // Deep blue
      coast: 0x3b82f6, // Blue
      grassland: 0x22c55e, // Green
      plains: 0x84cc16, // Light green
      forest: 0x166534, // Dark green
      hills: 0xa3a3a3, // Gray
      mountains: 0x525252, // Dark gray
      desert: 0xfbbf24, // Yellow
      tundra: 0xe5e7eb, // Light gray
    };
    return terrainColors[terrain];
  }

  private generateContinentTerrain(
    width: number,
    height: number
  ): TerrainType[][] {
    const terrain: TerrainType[][] = [];

    // Initialize with ocean
    for (let y = 0; y < height; y++) {
      terrain[y] = [];
      for (let x = 0; x < width; x++) {
        terrain[y][x] = 'ocean';
      }
    }

    // Generate continent shape using noise-like generation
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const continentWidth = Math.floor(width * 0.6);
    const continentHeight = Math.floor(height * 0.6);

    // Create landmass
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const maxDistance = Math.min(continentWidth, continentHeight) / 2;

        // Add some randomness to create irregular coastline
        const noise =
          (Math.sin(x * 0.1) +
            Math.cos(y * 0.1) +
            Math.sin(x * 0.05 + y * 0.05)) *
          3;
        const adjustedDistance = distance + noise;

        if (adjustedDistance < maxDistance) {
          // Interior land - determine terrain type based on distance from center
          const normalizedDistance = adjustedDistance / maxDistance;
          const elevation =
            Math.random() * 0.3 + (1 - normalizedDistance) * 0.7;

          if (elevation > 0.8) {
            terrain[y][x] = 'mountains';
          } else if (elevation > 0.6) {
            terrain[y][x] = 'hills';
          } else if (elevation > 0.4) {
            terrain[y][x] = Math.random() > 0.5 ? 'forest' : 'grassland';
          } else if (elevation > 0.2) {
            terrain[y][x] = Math.random() > 0.3 ? 'plains' : 'grassland';
          } else {
            terrain[y][x] = 'grassland';
          }

          // Add some desert areas
          if (Math.abs(dy) < continentHeight / 6 && Math.random() > 0.85) {
            terrain[y][x] = 'desert';
          }

          // Add tundra near edges
          if (normalizedDistance > 0.7 && Math.random() > 0.7) {
            terrain[y][x] = 'tundra';
          }
        } else if (adjustedDistance < maxDistance + 2) {
          // Coast areas
          terrain[y][x] = 'coast';
        }
      }
    }

    return terrain;
  }

  private buildTerrainMapFromServerData(
    mapTiles: Array<{ x: number; y: number; terrain: string }>,
    width: number,
    height: number
  ): TerrainType[][] {
    const terrain: TerrainType[][] = [];

    // Initialize with ocean (default)
    for (let y = 0; y < height; y++) {
      terrain[y] = [];
      for (let x = 0; x < width; x++) {
        terrain[y][x] = 'ocean';
      }
    }

    // Fill in terrain data from server
    mapTiles.forEach(tile => {
      if (tile.x >= 0 && tile.x < width && tile.y >= 0 && tile.y < height) {
        terrain[tile.y][tile.x] = tile.terrain as TerrainType;
      }
    });

    return terrain;
  }

  preload() {
    // Load placeholder assets - replace with your actual assets
    this.load.image(
      'grass',
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    );
    this.load.image(
      'unit',
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    );
    this.load.image(
      'city',
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    );
  }

  create() {
    // Set initial camera zoom to moderate level
    this.cameras.main.setZoom(0.8);

    // Create a container for the isometric map (will be repositioned after map is rendered)
    this.mapContainer = this.add.container(0, 0);

    // Setup camera controls
    this.setupCameraControls();

    // Always render the initial map
    this.renderGameState();

    // Center the map after it's rendered
    this.centerMapOnScreen();
  }

  private setupCameraControls() {
    const camera = this.cameras.main;
    const panSpeed = 50;

    // Middle mouse drag panning
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.isDown && pointer.middleButtonDown() && this.mapContainer) {
        const deltaX = (pointer.x - pointer.prevPosition.x) / camera.zoom;
        const deltaY = (pointer.y - pointer.prevPosition.y) / camera.zoom;

        this.mapContainer.x += deltaX;
        this.mapContainer.y += deltaY;
      }
    });

    // Handle tile clicks
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) {
        const worldPoint = camera.getWorldPoint(pointer.x, pointer.y);
        const tileCoords = this.screenToIsometric(worldPoint.x, worldPoint.y);

        if (this.callbacks.onTileClick && tileCoords) {
          this.callbacks.onTileClick(tileCoords.x, tileCoords.y);
        }
      }
    });

    // Mouse wheel zoom
    this.input.on(
      'wheel',
      (
        _pointer: Phaser.Input.Pointer,
        _gameObjects: any[],
        _deltaX: number,
        deltaY: number
      ) => {
        const zoomLevel = camera.zoom;
        if (deltaY > 0) {
          camera.zoom = Math.max(0.5, zoomLevel - 0.1);
        } else {
          camera.zoom = Math.min(2, zoomLevel + 0.1);
        }
      }
    );

    // WASD keyboard controls
    const handleKeyPress = (event: KeyboardEvent) => {
      if (this.mapContainer) {
        switch (event.key.toLowerCase()) {
          case 'w':
            this.mapContainer.y -= panSpeed;
            break;
          case 's':
            this.mapContainer.y += panSpeed;
            break;
          case 'a':
            this.mapContainer.x -= panSpeed;
            break;
          case 'd':
            this.mapContainer.x += panSpeed;
            break;
        }
      }
      event.preventDefault();
    };

    // Add global keydown listener
    document.addEventListener('keydown', handleKeyPress);

    // Store reference for cleanup
    (this as any).keyHandler = handleKeyPress;
  }

  private centerMapOnScreen() {
    if (!this.mapContainer) return;

    const gameWidth = this.scale.width;
    const gameHeight = this.scale.height;

    // Calculate the center of the screen
    const screenCenterX = gameWidth / 2;
    const screenCenterY = gameHeight / 2;

    // Get map dimensions
    const mapWidth = this.gameState?.mapWidth || 40;
    const mapHeight = this.gameState?.mapHeight || 40;

    // Calculate the center of the isometric map
    const mapCenterTile = this.isometricToScreen(mapWidth / 2, mapHeight / 2);

    // Position the map container so the map center appears at screen center
    this.mapContainer.x = screenCenterX - mapCenterTile.x;
    this.mapContainer.y = screenCenterY - mapCenterTile.y;
  }

  setCallbacks(callbacks: typeof this.callbacks) {
    this.callbacks = callbacks;
  }

  updateGameState(state: GameState) {
    this.gameState = state;
    this.renderGameState();
    this.centerMapOnScreen();
  }

  // Convert isometric coordinates to screen coordinates
  private isometricToScreen(x: number, y: number): { x: number; y: number } {
    const screenX = (x - y) * (this.tileWidth / 2);
    const screenY = (x + y) * (this.tileHeight / 2);
    return { x: screenX, y: screenY };
  }

  // Convert screen coordinates to isometric tile coordinates
  private screenToIsometric(
    screenX: number,
    screenY: number
  ): { x: number; y: number } | null {
    // Adjust for map container offset
    if (!this.mapContainer) return null;

    screenX -= this.mapContainer.x;
    screenY -= this.mapContainer.y;

    const x = Math.floor(
      (screenX / (this.tileWidth / 2) + screenY / (this.tileHeight / 2)) / 2
    );
    const y = Math.floor(
      (screenY / (this.tileHeight / 2) - screenX / (this.tileWidth / 2)) / 2
    );

    return { x, y };
  }

  private renderGameState() {
    if (!this.mapContainer) return;

    // Clear existing sprites
    this.unitSprites.forEach(sprite => sprite.destroy());
    this.citySprites.forEach(sprite => sprite.destroy());
    this.unitSprites.clear();
    this.citySprites.clear();
    this.mapContainer.removeAll(true);

    // Render map tiles in isometric view - use defaults if no game state
    const mapWidth = this.gameState?.mapWidth || 40;
    const mapHeight = this.gameState?.mapHeight || 40;

    // Generate terrain map from server data or fallback to generated terrain
    if (this.gameState?.map && this.gameState.map.length > 0) {
      // Use terrain data from server
      this.terrainMap = this.buildTerrainMapFromServerData(
        this.gameState.map,
        mapWidth,
        mapHeight
      );
    } else if (
      this.terrainMap.length !== mapHeight ||
      this.terrainMap[0]?.length !== mapWidth
    ) {
      // Fallback: generate terrain locally (for testing/development)
      this.terrainMap = this.generateContinentTerrain(mapWidth, mapHeight);
    }

    // Create isometric tiles with depth sorting
    const tiles: Phaser.GameObjects.Polygon[] = [];

    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        const screenPos = this.isometricToScreen(x, y);

        // Create diamond-shaped isometric tile
        const points = [
          0,
          -this.tileHeight / 2, // Top
          this.tileWidth / 2,
          0, // Right
          0,
          this.tileHeight / 2, // Bottom
          -this.tileWidth / 2,
          0, // Left
        ];

        // Get terrain color based on generated terrain
        const terrainType = this.terrainMap[y][x];
        const color = this.getTerrainColor(terrainType);

        const tile = this.add.polygon(
          screenPos.x,
          screenPos.y,
          points,
          color,
          0.9
        );

        // Set stroke color based on terrain type
        const strokeColor =
          terrainType === 'ocean' || terrainType === 'coast'
            ? 0x1e3a8a
            : terrainType === 'mountains'
              ? 0x374151
              : terrainType === 'desert'
                ? 0xd97706
                : 0x16a34a;
        tile.setStrokeStyle(1, strokeColor);
        tile.setInteractive(
          new Phaser.Geom.Polygon(points),
          Phaser.Geom.Polygon.Contains
        );

        // Store tile coordinates for click handling
        tile.setData('tileX', x);
        tile.setData('tileY', y);

        tile.on('pointerover', () => {
          tile.setFillStyle(0xfbbf24, 0.8);
        });

        tile.on('pointerout', () => {
          tile.setFillStyle(color, 0.9);
        });

        // Set depth for proper rendering order
        tile.setDepth(x + y);

        this.mapContainer.add(tile);
        tiles.push(tile);
      }
    }

    // Render units in isometric positions (use sample data if no game state)
    const units = this.gameState?.units || [
      { id: 'unit1', x: 5, y: 5, type: 'warrior' },
      { id: 'unit2', x: 8, y: 3, type: 'archer' },
      { id: 'unit3', x: 12, y: 7, type: 'settler' },
    ];

    units.forEach((unit: any) => {
      const screenPos = this.isometricToScreen(unit.x, unit.y);
      const unitSprite = this.add.circle(
        screenPos.x,
        screenPos.y - 10, // Offset to appear on top of tile
        15,
        0x3b82f6
      );
      unitSprite.setStrokeStyle(2, 0x1e40af);
      unitSprite.setInteractive();
      unitSprite.on('pointerdown', () => {
        if (this.callbacks.onUnitSelect) {
          this.callbacks.onUnitSelect(unit.id);
        }
      });
      unitSprite.setDepth(unit.x + unit.y + 1); // Above tiles
      if (this.mapContainer) {
        this.mapContainer.add(unitSprite);
      }
      this.unitSprites.set(unit.id, unitSprite as any);
    });

    // Render cities in isometric positions (use sample data if no game state)
    const cities = this.gameState?.cities || [
      { id: 'city1', x: 10, y: 10, name: 'Capital City' },
      { id: 'city2', x: 15, y: 5, name: 'Trading Post' },
    ];

    cities.forEach((city: any) => {
      const screenPos = this.isometricToScreen(city.x, city.y);
      const citySprite = this.add.star(
        screenPos.x,
        screenPos.y - 15, // Offset to appear on top of tile
        6,
        12,
        20,
        0xfbbf24
      );
      citySprite.setStrokeStyle(2, 0xf59e0b);
      citySprite.setDepth(city.x + city.y + 1); // Above tiles
      if (this.mapContainer) {
        this.mapContainer.add(citySprite);
      }
      this.citySprites.set(city.id, citySprite as any);
    });
  }

  centerCamera(x: number, y: number) {
    const screenPos = this.isometricToScreen(x, y);
    this.cameras.main.centerOn(
      (this.mapContainer?.x || 0) + screenPos.x,
      (this.mapContainer?.y || 0) + screenPos.y
    );
  }

  highlightTile(x: number, y: number) {
    if (!this.mapContainer) return;

    const screenPos = this.isometricToScreen(x, y);

    // Create diamond-shaped highlight
    const points = [
      0,
      -this.tileHeight / 2,
      this.tileWidth / 2,
      0,
      0,
      this.tileHeight / 2,
      -this.tileWidth / 2,
      0,
    ];

    const highlight = this.add.polygon(
      screenPos.x,
      screenPos.y,
      points,
      0xfbbf24,
      0.5
    );

    highlight.setStrokeStyle(2, 0xfbbf24);
    highlight.setDepth(x + y + 0.5); // Between tile and units
    if (this.mapContainer) {
      this.mapContainer.add(highlight);
    }

    // Pulse and fade animation
    this.tweens.add({
      targets: highlight,
      alpha: 0,
      scaleX: 1.2,
      scaleY: 1.2,
      duration: 1000,
      ease: 'Power2',
      onComplete: () => highlight.destroy(),
    });
  }
}

const PhaserGame = forwardRef<PhaserGameHandle, PhaserGameProps>(
  ({ gameState, onTileClick, onUnitSelect, onEndTurn }, ref) => {
    const gameRef = useRef<HTMLDivElement>(null);
    const phaserGame = useRef<Phaser.Game | null>(null);
    const sceneRef = useRef<GameMapScene | null>(null);

    useImperativeHandle(ref, () => ({
      updateGameState: (state: GameState) => {
        if (sceneRef.current) {
          sceneRef.current.updateGameState(state);
        }
      },
      centerCamera: (x: number, y: number) => {
        if (sceneRef.current) {
          sceneRef.current.centerCamera(x, y);
        }
      },
      highlightTile: (x: number, y: number) => {
        if (sceneRef.current) {
          sceneRef.current.highlightTile(x, y);
        }
      },
    }));

    useEffect(() => {
      if (!gameRef.current || phaserGame.current) return;

      const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        parent: gameRef.current,
        width: gameRef.current.clientWidth,
        height: gameRef.current.clientHeight,
        backgroundColor: '#000000',
        scene: GameMapScene,
        physics: {
          default: 'arcade',
          arcade: {
            gravity: { x: 0, y: 0 },
            debug: false,
          },
        },
        scale: {
          mode: Phaser.Scale.RESIZE,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
      };

      phaserGame.current = new Phaser.Game(config);

      // Get scene reference once it's created
      phaserGame.current.events.once('ready', () => {
        sceneRef.current = phaserGame.current?.scene.getScene(
          'GameMapScene'
        ) as GameMapScene;
        if (sceneRef.current) {
          sceneRef.current.setCallbacks({
            onTileClick,
            onUnitSelect,
            onEndTurn,
          });
          if (gameState) {
            sceneRef.current.updateGameState(gameState);
          }
        }
      });

      // Cleanup
      return () => {
        if (phaserGame.current) {
          phaserGame.current.destroy(true);
          phaserGame.current = null;
          sceneRef.current = null;
        }
      };
    }, []);

    // Update game state when it changes
    useEffect(() => {
      if (sceneRef.current && gameState) {
        sceneRef.current.updateGameState(gameState);
      }
    }, [gameState]);

    // Update callbacks when they change
    useEffect(() => {
      if (sceneRef.current) {
        sceneRef.current.setCallbacks({
          onTileClick,
          onUnitSelect,
          onEndTurn,
        });
      }
    }, [onTileClick, onUnitSelect, onEndTurn]);

    return (
      <div
        ref={gameRef}
        className="w-full h-full"
        style={{ minHeight: '600px' }}
      />
    );
  }
);

PhaserGame.displayName = 'PhaserGame';

export default PhaserGame;
export type { PhaserGameHandle };
