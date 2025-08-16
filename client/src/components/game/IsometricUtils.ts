export class IsometricUtils {
  private tileWidth: number;
  private tileHeight: number;

  constructor(tileWidth: number = 64, tileHeight: number = 32) {
    this.tileWidth = tileWidth;
    this.tileHeight = tileHeight;
  }

  isometricToScreen(x: number, y: number): { x: number; y: number } {
    const screenX = (x - y) * (this.tileWidth / 2);
    const screenY = (x + y) * (this.tileHeight / 2);
    return { x: screenX, y: screenY };
  }

  screenToIsometric(
    screenX: number,
    screenY: number,
    mapContainer?: Phaser.GameObjects.Container
  ): { x: number; y: number } | null {
    if (mapContainer) {
      screenX -= mapContainer.x;
      screenY -= mapContainer.y;
    }

    const x = Math.floor(
      (screenX / (this.tileWidth / 2) + screenY / (this.tileHeight / 2)) / 2
    );
    const y = Math.floor(
      (screenY / (this.tileHeight / 2) - screenX / (this.tileWidth / 2)) / 2
    );

    return { x, y };
  }

  getTilePoints(): number[] {
    return [
      0,
      -this.tileHeight / 2,
      this.tileWidth / 2,
      0,
      0,
      this.tileHeight / 2,
      -this.tileWidth / 2,
      0,
    ];
  }

  getTileWidth(): number {
    return this.tileWidth;
  }

  getTileHeight(): number {
    return this.tileHeight;
  }
}
