import type { PresentationEffect, Unit } from '../../../types';
import { BaseRenderer, type RenderState } from './BaseRenderer';

/**
 * Renders short-lived map effects without putting animation state in the
 * authoritative unit/city snapshot.
 */
export class PresentationEffectRenderer extends BaseRenderer {
  getUnitOverrides(state: RenderState, now = performance.now()): Record<string, Unit> {
    if (state.reducedMotion) return {};

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
    const effects = state.presentationEffects ?? [];
    const now = performance.now();
    let hasActiveEffects = false;

    for (const effect of effects) {
      const duration = this.getDuration(effect);
      const progress = state.reducedMotion ? 0 : (now - effect.startedAt) / duration;
      if (progress < 0 || progress >= 1) continue;

      hasActiveEffects = !state.reducedMotion;
      if (effect.type === 'nuclear') {
        this.renderNuclearEffect(effect, progress, state);
      } else if (effect.type === 'marker') {
        this.renderMarkerEffect(effect, progress, state);
      } else {
        this.renderCombatEffect(effect, progress, state);
      }
    }

    return hasActiveEffects;
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

  private renderNuclearEffect(effect: PresentationEffect, progress: number, state: RenderState) {
    const sprite = this.tilesetLoader.getSprite('explode.nuke');
    const tiles = effect.tiles?.length ? effect.tiles : [{ x: effect.x, y: effect.y }];
    for (const tile of tiles) {
      const screen = this.mapToScreen(tile.x, tile.y, state.viewport);
      if (sprite) {
        const scale = 0.6 + progress * 0.4;
        const width = sprite.width * scale;
        const height = sprite.height * scale;
        this.ctx.drawImage(
          sprite,
          screen.x + this.tileWidth / 2 - width / 2,
          screen.y + this.tileHeight / 2 - height / 2,
          width,
          height
        );
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
