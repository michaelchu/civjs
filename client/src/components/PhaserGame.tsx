import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import * as Phaser from 'phaser';
import { useGameStore } from '../stores/gameStore';
import type { GameState } from '../../../shared/types';

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

class GameMapScene extends Phaser.Scene {
  private gameState: GameState | null = null;
  private tileMap?: Phaser.Tilemaps.Tilemap;
  private unitSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private citySprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private selectedUnit: string | null = null;
  private tileGroup?: Phaser.GameObjects.Group;
  private tileWidth = 64;
  private tileHeight = 32;
  private mapContainer?: Phaser.GameObjects.Container;
  private callbacks: {
    onTileClick?: (x: number, y: number) => void;
    onUnitSelect?: (unitId: string) => void;
    onEndTurn?: () => void;
  } = {};

  constructor() {
    super({ key: 'GameMapScene' });
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
    console.log('Phaser scene created');
    // Create a container for the isometric map
    this.mapContainer = this.add.container(400, 300);
    console.log('Map container created:', this.mapContainer);

    // Setup camera controls
    const cursors = this.input.keyboard?.createCursorKeys();
    const camera = this.cameras.main;

    // Enable camera panning with mouse drag
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.isDown && pointer.rightButtonDown()) {
        camera.scrollX -= (pointer.x - pointer.prevPosition.x) / camera.zoom;
        camera.scrollY -= (pointer.y - pointer.prevPosition.y) / camera.zoom;
      }
    });

    // Enable zoom with mouse wheel
    this.input.on(
      'wheel',
      (
        pointer: Phaser.Input.Pointer,
        gameObjects: any[],
        deltaX: number,
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

    // Handle tile clicks with isometric conversion
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.rightButtonDown()) {
        const worldPoint = camera.getWorldPoint(pointer.x, pointer.y);
        const tileCoords = this.screenToIsometric(worldPoint.x, worldPoint.y);

        if (this.callbacks.onTileClick && tileCoords) {
          this.callbacks.onTileClick(tileCoords.x, tileCoords.y);
        }
      }
    });

    // Keyboard camera controls
    if (cursors) {
      this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
        const speed = 10;
        switch (event.key) {
          case 'ArrowLeft':
            camera.scrollX -= speed;
            break;
          case 'ArrowRight':
            camera.scrollX += speed;
            break;
          case 'ArrowUp':
            camera.scrollY -= speed;
            break;
          case 'ArrowDown':
            camera.scrollY += speed;
            break;
        }
      });
    }

    // Always render the initial map
    this.renderGameState();
  }

  setCallbacks(callbacks: typeof this.callbacks) {
    this.callbacks = callbacks;
  }

  updateGameState(state: GameState) {
    this.gameState = state;
    this.renderGameState();
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
    console.log('Rendering game state, mapContainer:', this.mapContainer);
    if (!this.mapContainer) return;

    // Clear existing sprites
    this.unitSprites.forEach(sprite => sprite.destroy());
    this.citySprites.forEach(sprite => sprite.destroy());
    this.unitSprites.clear();
    this.citySprites.clear();
    this.mapContainer.removeAll(true);

    // Render map tiles in isometric view - use defaults if no game state
    const mapWidth = this.gameState?.mapWidth || 20;
    const mapHeight = this.gameState?.mapHeight || 20;

    console.log(`Rendering map: ${mapWidth}x${mapHeight}`);

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

        // Alternate tile colors for checkerboard pattern
        const color = (x + y) % 2 === 0 ? 0x4ade80 : 0x22c55e;

        const tile = this.add.polygon(
          screenPos.x,
          screenPos.y,
          points,
          color,
          0.9
        );

        tile.setStrokeStyle(1, 0x16a34a);
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

        tile.on('pointerdown', () => {
          if (this.callbacks.onTileClick) {
            this.callbacks.onTileClick(x, y);
          }
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
      this.mapContainer.add(unitSprite);
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
      this.mapContainer.add(citySprite);
      this.citySprites.set(city.id, citySprite as any);
    });

    // Set camera bounds based on isometric map size
    const bottomRight = this.isometricToScreen(mapWidth, mapHeight);
    const topLeft = this.isometricToScreen(0, 0);
    this.cameras.main.setBounds(
      topLeft.x - 200,
      topLeft.y - 200,
      bottomRight.x - topLeft.x + 400,
      bottomRight.y - topLeft.y + 400
    );
  }

  centerCamera(x: number, y: number) {
    const screenPos = this.isometricToScreen(x, y);
    if (this.mapContainer) {
      this.cameras.main.centerOn(
        this.mapContainer.x + screenPos.x,
        this.mapContainer.y + screenPos.y
      );
    }
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
    this.mapContainer.add(highlight);

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
  ({ gameId, gameState, onTileClick, onUnitSelect, onEndTurn }, ref) => {
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
