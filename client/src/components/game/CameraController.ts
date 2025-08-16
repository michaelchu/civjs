import * as Phaser from 'phaser';

export interface CameraCallbacks {
  onTileClick?: (x: number, y: number) => void;
  onUnitSelect?: (unitId: string) => void;
  onEndTurn?: () => void;
}

export class CameraController {
  private scene: Phaser.Scene;
  private mapContainer: Phaser.GameObjects.Container;
  private callbacks: CameraCallbacks = {};
  private keyHandler?: (event: KeyboardEvent) => void;
  private panSpeed = 50;

  constructor(scene: Phaser.Scene, mapContainer: Phaser.GameObjects.Container) {
    this.scene = scene;
    this.mapContainer = mapContainer;
  }

  setCallbacks(callbacks: CameraCallbacks) {
    this.callbacks = callbacks;
  }

  setupControls(
    screenToIsometric: (x: number, y: number) => { x: number; y: number } | null
  ) {
    const camera = this.scene.cameras.main;

    this.scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.isDown && pointer.middleButtonDown()) {
        const deltaX = (pointer.x - pointer.prevPosition.x) / camera.zoom;
        const deltaY = (pointer.y - pointer.prevPosition.y) / camera.zoom;

        this.mapContainer.x += deltaX;
        this.mapContainer.y += deltaY;
      }
    });

    this.scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) {
        const worldPoint = camera.getWorldPoint(pointer.x, pointer.y);
        const tileCoords = screenToIsometric(worldPoint.x, worldPoint.y);

        if (this.callbacks.onTileClick && tileCoords) {
          this.callbacks.onTileClick(tileCoords.x, tileCoords.y);
        }
      }
    });

    this.scene.input.on(
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

    this.keyHandler = (event: KeyboardEvent) => {
      switch (event.key.toLowerCase()) {
        case 'w':
          this.mapContainer.y -= this.panSpeed;
          break;
        case 's':
          this.mapContainer.y += this.panSpeed;
          break;
        case 'a':
          this.mapContainer.x -= this.panSpeed;
          break;
        case 'd':
          this.mapContainer.x += this.panSpeed;
          break;
      }
      event.preventDefault();
    };

    document.addEventListener('keydown', this.keyHandler);
  }

  centerMapOnScreen(
    mapWidth: number,
    mapHeight: number,
    isometricToScreen: (x: number, y: number) => { x: number; y: number }
  ) {
    const gameWidth = this.scene.scale.width;
    const gameHeight = this.scene.scale.height;

    const screenCenterX = gameWidth / 2;
    const screenCenterY = gameHeight / 2;

    const mapCenterTile = isometricToScreen(mapWidth / 2, mapHeight / 2);

    this.mapContainer.x = screenCenterX - mapCenterTile.x;
    this.mapContainer.y = screenCenterY - mapCenterTile.y;
  }

  centerCamera(
    x: number,
    y: number,
    isometricToScreen: (x: number, y: number) => { x: number; y: number }
  ) {
    const screenPos = isometricToScreen(x, y);
    this.scene.cameras.main.centerOn(
      this.mapContainer.x + screenPos.x,
      this.mapContainer.y + screenPos.y
    );
  }

  destroy() {
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler);
    }
  }
}
