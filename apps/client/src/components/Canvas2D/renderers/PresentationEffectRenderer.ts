/**
 * @module client/components/Canvas2D/renderers/PresentationEffectRenderer
 * Implements the Presentation Effect Renderer canvas rendering stage.
 */
import type { PresentationEffect, Tile, Unit } from '../../../types';
import { BaseRenderer, type RenderState } from './BaseRenderer';

type EffectLayer = 'unit' | 'goto';

interface SquareEffectLocation {
  effect: PresentationEffect;
  location: { x: number; y: number };
}

const EMPTY_PRESENTATION_EFFECTS: PresentationEffect[] = [];

/**
 * Renders short-lived map effects without putting animation state in the
 * authoritative unit/city snapshot.
 */
export class PresentationEffectRenderer extends BaseRenderer {
  /**
   * freeciv-web stores square-ISO explosion state per logical tile and advances
   * it whenever that tile is painted. Keep those counters separate from the
   * elapsed-time presentation used by the native Hexemplio renderer.
   */
  private squareEffectSteps = new Map<string, { effectKey: string; remaining: number }>();
  private indexedEffectsSource: RenderState['presentationEffects'] | null = null;
  private nativeEffectsByLayer: Record<EffectLayer, PresentationEffect[]> = {
    unit: [],
    goto: [],
  };
  private nativeEffectsByTile: Record<EffectLayer, Map<string, PresentationEffect[]>> = {
    unit: new Map(),
    goto: new Map(),
  };
  private squareEffectsByTile: Record<EffectLayer, Map<string, SquareEffectLocation>> = {
    unit: new Map(),
    goto: new Map(),
  };

  /** Remove counters only after their source presentation effect is gone. */
  beginFrame(state: RenderState): void {
    this.ensureEffectIndex(state);
    const activeIds = new Set(
      (state.presentationEffects ?? []).map(effect => this.effectKey(effect))
    );
    for (const [key, counter] of this.squareEffectSteps) {
      if (!activeIds.has(counter.effectKey)) this.squareEffectSteps.delete(key);
    }
  }

  getUnitOverrides(state: RenderState, now = performance.now()): Record<string, Unit> {
    // The pinned 2D browser client applies authoritative UNIT_INFO updates
    // directly. It does not synthesize or interpolate combatants while the
    // five explosion sprites play.
    if (state.reducedMotion || this.isSquareIsometric()) return {};

    const overrides: Record<string, Unit> = {};
    for (const effect of state.presentationEffects ?? []) {
      if (effect.type !== 'combat' || !effect.combatants?.length) continue;
      const duration = this.getDuration(effect);
      const progress = (now - effect.startedAt) / duration;
      if (progress < 0 || progress >= 1) continue;

      for (const combatant of effect.combatants) {
        const hp = Math.round(
          combatant.hpBefore + (combatant.hpAfter - combatant.hpBefore) * progress
        );
        overrides[combatant.id] = {
          id: combatant.id,
          playerId: combatant.playerId,
          unitTypeId: combatant.unitTypeId,
          x: combatant.x,
          y: combatant.y,
          hp: Math.max(0, hp),
          movesLeft: combatant.movesLeft ?? 0,
          veteranLevel: combatant.veteranLevel ?? 0,
          fortified: combatant.fortified,
          activity: combatant.activity,
        };
      }
    }
    return overrides;
  }

  render(state: RenderState): boolean {
    return this.renderEffectsForLayer(state, 'unit');
  }

  /** Paint UNIT-layer effects belonging to one tile in the global painter walk. */
  renderUnitEffectsForTile(state: RenderState, tile: Pick<Tile, 'x' | 'y'>): boolean {
    return this.renderEffectsForLayer(state, 'unit', tile);
  }

  /** Nuclear effects share Freeciv-web's final GOTO layer. */
  renderGotoLayer(state: RenderState): boolean {
    return this.renderEffectsForLayer(state, 'goto');
  }

  /** Paint final-layer effects belonging to one tile in the painter walk. */
  renderGotoEffectsForTile(state: RenderState, tile: Pick<Tile, 'x' | 'y'>): boolean {
    return this.renderEffectsForLayer(state, 'goto', tile);
  }

  private renderEffectsForLayer(
    state: RenderState,
    layer: EffectLayer,
    tile?: Pick<Tile, 'x' | 'y'>
  ): boolean {
    this.ensureEffectIndex(state);
    if (this.isSquareIsometric()) {
      return this.renderSquareEffectsForLayer(state, layer, tile);
    }

    const effects = tile
      ? (this.nativeEffectsByTile[layer].get(this.tileKey(tile)) ?? [])
      : this.nativeEffectsByLayer[layer];
    const now = performance.now();
    let hasActiveEffects = false;

    for (const effect of effects) {
      const duration = this.getDuration(effect);
      const progress = state.reducedMotion ? 0 : (now - effect.startedAt) / duration;
      if (progress < 0 || progress >= 1) continue;

      hasActiveEffects = !state.reducedMotion;
      if (effect.type === 'nuclear') {
        this.renderNuclearEffect(effect, progress, state, tile);
      } else if (effect.type === 'marker') {
        this.renderMarkerEffect(effect, progress, state);
      } else {
        this.renderCombatEffect(effect, progress, state);
      }
    }

    return hasActiveEffects;
  }

  /**
   * Paint the pinned freeciv-web 2D effect state machine.
   *
   * Combat explosions start at 25 tile-paint steps and use five frames for five
   * paints each. Nuclear explosions retain one native-size sprite for 60 tile
   * paints. Wrapped copies therefore advance the same logical-tile counter
   * independently on every fill_sprite_array() call. A nuclear packet identifies
   * one target tile; CivJS's affected blast-area list is visibility metadata and
   * must not duplicate the sprite.
   *
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/packhand.js:720-728,1001-1018
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:397-423,477-487
   */
  private renderSquareEffectsForLayer(
    state: RenderState,
    layer: EffectLayer,
    tile?: Pick<Tile, 'x' | 'y'>
  ): boolean {
    let needsAnotherFrame = false;

    const indexed = this.squareEffectsByTile[layer];
    const effects = tile
      ? indexed.has(this.tileKey(tile))
        ? [indexed.get(this.tileKey(tile))!]
        : []
      : [...indexed.values()];
    for (const { effect, location } of effects) {
      const initialSteps = effect.type === 'nuclear' ? 60 : 25;
      const counter = this.getSquareCounter(effect, location, initialSteps);
      const renderRemaining = state.reducedMotion ? initialSteps : counter.remaining;
      if (renderRemaining <= 0) continue;
      if (!state.reducedMotion) counter.remaining -= 1;

      if (effect.type === 'nuclear') {
        this.renderSquareNuclearEffect(location, state);
      } else {
        const frame = Math.min(4, Math.floor((initialSteps - renderRemaining) / 5));
        this.renderSquareCombatEffect(location, frame, state);
      }

      // The frame that consumes the final positive step still paints the last
      // sprite. Schedule one more pass so the cleared canvas can omit it.
      needsAnotherFrame = needsAnotherFrame || !state.reducedMotion;
    }

    return needsAnotherFrame;
  }

  /** Build tile lookups once per immutable effect snapshot, not once per painted tile. */
  private ensureEffectIndex(state: RenderState): void {
    const effects = state.presentationEffects ?? EMPTY_PRESENTATION_EFFECTS;
    if (this.indexedEffectsSource === effects) return;
    this.indexedEffectsSource = effects;
    this.nativeEffectsByLayer = { unit: [], goto: [] };
    this.nativeEffectsByTile = { unit: new Map(), goto: new Map() };
    this.squareEffectsByTile = { unit: new Map(), goto: new Map() };

    for (const effect of effects) {
      const layer: EffectLayer = effect.type === 'nuclear' ? 'goto' : 'unit';
      this.nativeEffectsByLayer[layer].push(effect);
      const nativeLocations =
        effect.type === 'nuclear' && effect.tiles?.length
          ? effect.tiles
          : [{ x: effect.x, y: effect.y }];
      for (const location of nativeLocations) {
        const key = this.tileKey(location);
        const atTile = this.nativeEffectsByTile[layer].get(key) ?? [];
        atTile.push(effect);
        this.nativeEffectsByTile[layer].set(key, atTile);
      }

      if (effect.type === 'marker') continue;
      const squareLocations =
        effect.type === 'nuclear'
          ? [{ x: effect.x, y: effect.y }]
          : this.getDestroyedCombatantTiles(effect);
      for (const location of squareLocations) {
        // explosion_anim_map and ptile.nuke hold one latest effect per tile.
        this.squareEffectsByTile[layer].set(this.tileKey(location), { effect, location });
      }
    }
  }

  private tileKey(tile: Pick<Tile, 'x' | 'y'>): string {
    return `${tile.x},${tile.y}`;
  }

  private getDestroyedCombatantTiles(effect: PresentationEffect): Array<{ x: number; y: number }> {
    // A local attack reply predating the rich server broadcast has no
    // combatants. It is only created for a lethal result, so its anchor remains
    // a valid fallback. Rich events can distinguish non-lethal combat exactly.
    const locations = effect.combatants
      ? effect.combatants
          .filter(combatant => combatant.destroyed)
          .map(combatant => ({ x: combatant.x, y: combatant.y }))
      : [{ x: effect.x, y: effect.y }];
    return locations.filter(
      (location, index) =>
        locations.findIndex(
          candidate => candidate.x === location.x && candidate.y === location.y
        ) === index
    );
  }

  private getSquareCounter(
    effect: PresentationEffect,
    location: Pick<Tile, 'x' | 'y'>,
    initialSteps: number
  ): { effectKey: string; remaining: number } {
    const effectKey = this.effectKey(effect);
    const key = `${effect.type}@${location.x},${location.y}`;
    const existing = this.squareEffectSteps.get(key);
    if (existing?.effectKey === effectKey) return existing;
    const counter = { effectKey, remaining: initialSteps };
    this.squareEffectSteps.set(key, counter);
    return counter;
  }

  private effectKey(effect: PresentationEffect): string {
    return `${effect.type}:${effect.correlationKey ?? effect.id}`;
  }

  private isSquareIsometric(): boolean {
    return (
      this.tilesetLoader.metadata?.projection === 'isometric' &&
      this.tilesetLoader.metadata?.topologyId === 1
    );
  }

  private renderSquareCombatEffect(
    location: Pick<Tile, 'x' | 'y'>,
    frame: number,
    state: RenderState
  ): void {
    const sprite = this.tilesetLoader.getSprite(`explode.unit_${frame}`);
    if (!sprite) return;
    const screen = this.mapToScreen(location.x, location.y, state.viewport);
    const offsets = this.tilesetLoader.getPresentationOffsets?.();
    this.ctx.drawImage(
      sprite,
      screen.x + (offsets?.unitX ?? 19),
      screen.y - (offsets?.unitY ?? -14)
    );
  }

  private renderSquareNuclearEffect(location: Pick<Tile, 'x' | 'y'>, state: RenderState): void {
    const sprite = this.tilesetLoader.getSprite('explode.nuke');
    if (!sprite) return;
    const screen = this.mapToScreen(location.x, location.y, state.viewport);
    this.ctx.drawImage(sprite, screen.x - 45, screen.y - 45);
  }

  private getDuration(effect: PresentationEffect): number {
    if (effect.durationMs !== undefined) return Math.max(1, effect.durationMs);
    if (effect.type === 'nuclear') return 720;
    if (effect.type === 'marker') return 900;
    return effect.style === 'swords' ? 480 : 360;
  }

  private renderCombatEffect(effect: PresentationEffect, progress: number, state: RenderState) {
    const screen = this.mapToScreen(effect.x, effect.y, state.viewport);
    const style = effect.style ?? 'explosion';
    const frameCount = style === 'swords' ? 8 : 5;
    const frame = Math.min(frameCount - 1, Math.floor(progress * frameCount));
    const key = `${style === 'swords' ? 'swords' : 'explode'}.unit_${frame}`;
    const sprite = this.tilesetLoader.getSprite(key);

    if (sprite) {
      const offsetX = style === 'swords' ? 25 + frame * 8 : 25;
      const offsetY = style === 'swords' ? 18 - frame * 15 : 18;
      this.ctx.drawImage(sprite, screen.x + offsetX, screen.y + offsetY);
      return;
    }

    // Keep combat feedback visible if a custom tileset does not provide the
    // copied reference frames.
    this.renderFallbackBurst(
      screen.x + this.tileWidth / 2,
      screen.y + this.tileHeight / 2,
      progress
    );
  }

  private renderNuclearEffect(
    effect: PresentationEffect,
    progress: number,
    state: RenderState,
    tile?: Pick<Tile, 'x' | 'y'>
  ) {
    const sprite = this.tilesetLoader.getSprite('explode.nuke');
    const tiles = tile
      ? [tile]
      : effect.tiles?.length
        ? effect.tiles
        : [{ x: effect.x, y: effect.y }];
    for (const tile of tiles) {
      const screen = this.mapToScreen(tile.x, tile.y, state.viewport);
      if (sprite) {
        // Freeciv-web advances the effect lifetime, not the sprite scale. The
        // atlas image is always painted at its native size from this offset.
        this.ctx.drawImage(sprite, screen.x - 45, screen.y - 45);
      } else {
        this.renderFallbackBurst(
          screen.x + this.tileWidth / 2,
          screen.y + this.tileHeight / 2,
          progress
        );
      }
    }
  }

  private renderMarkerEffect(effect: PresentationEffect, progress: number, state: RenderState) {
    const screen = this.mapToScreen(effect.x, effect.y, state.viewport);
    const sprite = this.tilesetLoader.getSprite('grid.usermark');
    if (sprite) {
      this.ctx.globalAlpha = 0.35 + (1 - progress) * 0.65;
      this.ctx.drawImage(sprite, screen.x, screen.y);
      this.ctx.globalAlpha = 1;
      return;
    }

    const centerX = screen.x + this.tileWidth / 2;
    const centerY = screen.y + this.tileHeight / 2;
    this.ctx.globalAlpha = 0.35 + (1 - progress) * 0.65;
    this.ctx.strokeStyle = '#fbbf24';
    this.ctx.lineWidth = 3;
    this.ctx.beginPath();
    this.ctx.moveTo(centerX, centerY - 14);
    this.ctx.lineTo(centerX + 24, centerY);
    this.ctx.lineTo(centerX, centerY + 14);
    this.ctx.lineTo(centerX - 24, centerY);
    this.ctx.closePath();
    this.ctx.stroke();
    this.ctx.globalAlpha = 1;
  }

  private renderFallbackBurst(centerX: number, centerY: number, progress: number): void {
    const radius = 8 + progress * 24;
    this.ctx.globalAlpha = 1 - progress;
    this.ctx.fillStyle = '#fbbf24';
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.globalAlpha = 1;
  }
}
