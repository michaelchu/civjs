import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import * as Phaser from 'phaser';
import { TerrainService } from './game/TerrainService';
import type { TerrainType } from './game/TerrainService';
import { CameraController } from './game/CameraController';
import type { CameraCallbacks } from './game/CameraController';
import { IsometricUtils } from './game/IsometricUtils';
import { MapRenderer } from './game/MapRenderer';
import { GameObjectRenderer } from './game/GameObjectRenderer';
import type { Unit, City } from './game/GameObjectRenderer';

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

class GameMapScene extends Phaser.Scene {
  private gameState: GameState | null = null;
  private mapContainer?: Phaser.GameObjects.Container;
  private terrainMap: TerrainType[][] = [];
  private callbacks: CameraCallbacks = {};

  private isometricUtils: IsometricUtils;
  private cameraController?: CameraController;
  private mapRenderer: MapRenderer;
  private gameObjectRenderer: GameObjectRenderer;

  constructor() {
    super({ key: 'GameMapScene' });
    this.isometricUtils = new IsometricUtils(64, 32);
    this.mapRenderer = new MapRenderer(this, this.isometricUtils);
    this.gameObjectRenderer = new GameObjectRenderer(this, this.isometricUtils);
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
    this.cameras.main.setZoom(0.8);
    this.mapContainer = this.add.container(0, 0);

    this.cameraController = new CameraController(this, this.mapContainer);
    this.cameraController.setCallbacks(this.callbacks);
    this.cameraController.setupControls((x, y) =>
      this.isometricUtils.screenToIsometric(x, y, this.mapContainer)
    );

    this.renderGameState();
    this.centerMapOnScreen();
  }

  private centerMapOnScreen() {
    if (!this.mapContainer || !this.cameraController) return;

    const mapWidth = this.gameState?.mapWidth || 40;
    const mapHeight = this.gameState?.mapHeight || 40;

    this.cameraController.centerMapOnScreen(mapWidth, mapHeight, (x, y) =>
      this.isometricUtils.isometricToScreen(x, y)
    );
  }

  setCallbacks(callbacks: CameraCallbacks) {
    this.callbacks = callbacks;
    if (this.cameraController) {
      this.cameraController.setCallbacks(callbacks);
    }
  }

  updateGameState(state: GameState) {
    this.gameState = state;
    this.renderGameState();
    this.centerMapOnScreen();
  }

  private renderGameState() {
    if (!this.mapContainer) return;

    this.gameObjectRenderer.clear();
    this.mapContainer.removeAll(true);

    const mapWidth = this.gameState?.mapWidth || 40;
    const mapHeight = this.gameState?.mapHeight || 40;

    if (this.gameState?.map && this.gameState.map.length > 0) {
      this.terrainMap = TerrainService.buildTerrainMapFromServerData(
        this.gameState.map,
        mapWidth,
        mapHeight
      );
    } else if (
      this.terrainMap.length !== mapHeight ||
      this.terrainMap[0]?.length !== mapWidth
    ) {
      this.terrainMap = TerrainService.generateContinentTerrain(
        mapWidth,
        mapHeight
      );
    }

    this.mapRenderer.renderTerrain(
      this.terrainMap,
      mapWidth,
      mapHeight,
      this.mapContainer
    );

    const units: Unit[] = this.gameState?.units || [
      { id: 'unit1', x: 5, y: 5, type: 'warrior' },
      { id: 'unit2', x: 8, y: 3, type: 'archer' },
      { id: 'unit3', x: 12, y: 7, type: 'settler' },
    ];

    this.gameObjectRenderer.renderUnits(
      units,
      this.mapContainer,
      this.callbacks.onUnitSelect
    );

    const cities: City[] = this.gameState?.cities || [
      { id: 'city1', x: 10, y: 10, name: 'Capital City' },
      { id: 'city2', x: 15, y: 5, name: 'Trading Post' },
    ];

    this.gameObjectRenderer.renderCities(cities, this.mapContainer);
  }

  centerCamera(x: number, y: number) {
    if (this.cameraController) {
      this.cameraController.centerCamera(x, y, (x, y) =>
        this.isometricUtils.isometricToScreen(x, y)
      );
    }
  }

  highlightTile(x: number, y: number) {
    if (!this.mapContainer) return;
    this.mapRenderer.highlightTile(x, y, this.mapContainer);
  }

  cleanup() {
    if (this.cameraController) {
      this.cameraController.destroy();
    }
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

      return () => {
        if (phaserGame.current) {
          const scene = sceneRef.current;
          if (scene) {
            scene.cleanup();
          }
          phaserGame.current.destroy(true);
          phaserGame.current = null;
          sceneRef.current = null;
        }
      };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
