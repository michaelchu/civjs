/**
 * Mouse Controller for Canvas2D - Based on Freeciv's mapctrl implementation
 * Handles mouse interactions, dragging, and click detection
 */

import { Canvas2DRenderer } from './Canvas2DRenderer';
import type { TilePosition } from './Canvas2DRenderer';

export interface MouseCallbacks {
  onTileClick?: (x: number, y: number) => void;
  onTileHover?: (x: number, y: number) => void;
  onRightClick?: (x: number, y: number) => void;
}

export class CanvasMouseController {
  private canvas: HTMLCanvasElement;
  private renderer: Canvas2DRenderer;
  private callbacks: MouseCallbacks;

  // Mouse state
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private lastMouseX = 0;
  private lastMouseY = 0;

  // Touch support
  private touchStartX = 0;
  private touchStartY = 0;
  private initialPinchDistance = 0;

  // Hover state
  private hoveredTile: TilePosition | null = null;
  private highlightCanvas: HTMLCanvasElement;
  private highlightCtx: CanvasRenderingContext2D;

  constructor(
    canvas: HTMLCanvasElement,
    renderer: Canvas2DRenderer,
    callbacks: MouseCallbacks = {}
  ) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.callbacks = callbacks;

    // Create highlight overlay canvas
    this.highlightCanvas = document.createElement('canvas');
    this.highlightCanvas.width = 64;
    this.highlightCanvas.height = 48;
    const ctx = this.highlightCanvas.getContext('2d');
    if (!ctx) throw new Error('Failed to create highlight context');
    this.highlightCtx = ctx;

    this.createHighlightSprite();
    this.attachEventListeners();
  }

  /**
   * Create a highlight sprite for hover effects
   */
  private createHighlightSprite(): void {
    const ctx = this.highlightCtx;
    ctx.clearRect(
      0,
      0,
      this.highlightCanvas.width,
      this.highlightCanvas.height
    );

    // Draw yellow highlight
    ctx.save();
    ctx.translate(32, 8);
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.6;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(32, 16);
    ctx.lineTo(0, 32);
    ctx.lineTo(-32, 16);
    ctx.closePath();
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Attach all event listeners
   */
  private attachEventListeners(): void {
    // Mouse events
    this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
    this.canvas.addEventListener('wheel', this.handleWheel.bind(this));
    this.canvas.addEventListener(
      'contextmenu',
      this.handleContextMenu.bind(this)
    );

    // Touch events
    this.canvas.addEventListener(
      'touchstart',
      this.handleTouchStart.bind(this)
    );
    this.canvas.addEventListener('touchmove', this.handleTouchMove.bind(this));
    this.canvas.addEventListener('touchend', this.handleTouchEnd.bind(this));

    // Prevent default drag behavior
    this.canvas.addEventListener('dragstart', e => e.preventDefault());
  }

  /**
   * Handle mouse down event
   */
  private handleMouseDown(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (e.button === 0) {
      // Left click
      this.isDragging = true;
      this.dragStartX = x;
      this.dragStartY = y;
      this.lastMouseX = x;
      this.lastMouseY = y;
      this.canvas.style.cursor = 'grabbing';
    } else if (e.button === 2) {
      // Right click
      const tile = this.renderer.screenToIso(x, y);
      if (this.callbacks.onRightClick) {
        this.callbacks.onRightClick(tile.x, tile.y);
      }
    }
  }

  /**
   * Handle mouse move event
   */
  private handleMouseMove(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (this.isDragging) {
      // Pan the map
      const dx = this.lastMouseX - x;
      const dy = this.lastMouseY - y;
      this.renderer.pan(dx, dy);
      this.lastMouseX = x;
      this.lastMouseY = y;
    } else {
      // Handle hover
      const tile = this.renderer.screenToIso(x, y);
      if (
        !this.hoveredTile ||
        tile.x !== this.hoveredTile.x ||
        tile.y !== this.hoveredTile.y
      ) {
        this.hoveredTile = tile;
        if (this.callbacks.onTileHover) {
          this.callbacks.onTileHover(tile.x, tile.y);
        }
      }
      this.canvas.style.cursor = 'pointer';
    }
  }

  /**
   * Handle mouse up event
   */
  private handleMouseUp(e: MouseEvent): void {
    if (e.button === 0 && this.isDragging) {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Check if it was a click (not a drag)
      const distance = Math.sqrt(
        Math.pow(x - this.dragStartX, 2) + Math.pow(y - this.dragStartY, 2)
      );

      if (distance < 5) {
        // Click threshold
        const tile = this.renderer.screenToIso(x, y);
        if (this.callbacks.onTileClick) {
          this.callbacks.onTileClick(tile.x, tile.y);
        }
      }

      this.isDragging = false;
      this.canvas.style.cursor = 'grab';
    }
  }

  /**
   * Handle mouse wheel event for zooming
   */
  private handleWheel(e: WheelEvent): void {
    e.preventDefault();

    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Calculate zoom factor
    const zoomSpeed = 0.1;
    const factor = e.deltaY > 0 ? 1 - zoomSpeed : 1 + zoomSpeed;

    this.renderer.zoom(factor, x, y);
  }

  /**
   * Handle context menu (right click)
   */
  private handleContextMenu(e: MouseEvent): void {
    e.preventDefault();
  }

  /**
   * Handle touch start event
   */
  private handleTouchStart(e: TouchEvent): void {
    e.preventDefault();

    if (e.touches.length === 1) {
      // Single touch - start drag
      const touch = e.touches[0];
      const rect = this.canvas.getBoundingClientRect();
      this.touchStartX = touch.clientX - rect.left;
      this.touchStartY = touch.clientY - rect.top;
      this.lastMouseX = this.touchStartX;
      this.lastMouseY = this.touchStartY;
      this.isDragging = true;
    } else if (e.touches.length === 2) {
      // Two finger touch - prepare for pinch zoom
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      this.initialPinchDistance = Math.sqrt(
        Math.pow(touch2.clientX - touch1.clientX, 2) +
          Math.pow(touch2.clientY - touch1.clientY, 2)
      );
    }
  }

  /**
   * Handle touch move event
   */
  private handleTouchMove(e: TouchEvent): void {
    e.preventDefault();

    if (e.touches.length === 1 && this.isDragging) {
      // Single touch drag
      const touch = e.touches[0];
      const rect = this.canvas.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      const dx = this.lastMouseX - x;
      const dy = this.lastMouseY - y;
      this.renderer.pan(dx, dy);

      this.lastMouseX = x;
      this.lastMouseY = y;
    } else if (e.touches.length === 2) {
      // Pinch zoom
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const currentDistance = Math.sqrt(
        Math.pow(touch2.clientX - touch1.clientX, 2) +
          Math.pow(touch2.clientY - touch1.clientY, 2)
      );

      if (this.initialPinchDistance > 0) {
        const factor = currentDistance / this.initialPinchDistance;
        const rect = this.canvas.getBoundingClientRect();
        const centerX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
        const centerY = (touch1.clientY + touch2.clientY) / 2 - rect.top;

        this.renderer.zoom(factor, centerX, centerY);
        this.initialPinchDistance = currentDistance;
      }
    }
  }

  /**
   * Handle touch end event
   */
  private handleTouchEnd(e: TouchEvent): void {
    e.preventDefault();

    if (e.touches.length === 0) {
      // Check if it was a tap
      if (
        this.isDragging &&
        this.touchStartX !== undefined &&
        this.touchStartY !== undefined
      ) {
        const distance = Math.sqrt(
          Math.pow(this.lastMouseX - this.touchStartX, 2) +
            Math.pow(this.lastMouseY - this.touchStartY, 2)
        );

        if (distance < 10) {
          // Tap threshold
          const tile = this.renderer.screenToIso(
            this.touchStartX,
            this.touchStartY
          );
          if (this.callbacks.onTileClick) {
            this.callbacks.onTileClick(tile.x, tile.y);
          }
        }
      }

      this.isDragging = false;
      this.initialPinchDistance = 0;
    }
  }

  /**
   * Update callbacks
   */
  public setCallbacks(callbacks: MouseCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Clean up event listeners
   */
  public destroy(): void {
    this.canvas.removeEventListener(
      'mousedown',
      this.handleMouseDown.bind(this)
    );
    this.canvas.removeEventListener(
      'mousemove',
      this.handleMouseMove.bind(this)
    );
    this.canvas.removeEventListener('mouseup', this.handleMouseUp.bind(this));
    this.canvas.removeEventListener('wheel', this.handleWheel.bind(this));
    this.canvas.removeEventListener(
      'contextmenu',
      this.handleContextMenu.bind(this)
    );
    this.canvas.removeEventListener(
      'touchstart',
      this.handleTouchStart.bind(this)
    );
    this.canvas.removeEventListener(
      'touchmove',
      this.handleTouchMove.bind(this)
    );
    this.canvas.removeEventListener('touchend', this.handleTouchEnd.bind(this));
  }
}
