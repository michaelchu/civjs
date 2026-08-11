import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyboardController } from '../KeyboardController';
import { ActionType } from '../../types/shared/actions';

describe('KeyboardController worker automation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the existing shortcut and wire action while naming it Auto Worker', () => {
    const binding = new KeyboardController().getKeyBindings().get('a');

    expect(binding).toEqual({
      action: ActionType.AUTO_SETTLER,
      description: 'Auto worker',
    });
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/control.js:80-91
   * @assertion Keyboard activation is scoped to the active map surface and
   * deactivation removes the exact listener that was installed.
   */
  it('does not leave a stale key listener after deactivation', () => {
    const controller = new KeyboardController();
    const actionHandler = vi.fn();
    document.addEventListener('keyboard-unit-action', actionHandler);

    controller.activate();
    controller.deactivate();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));

    expect(actionHandler).not.toHaveBeenCalled();
    document.removeEventListener('keyboard-unit-action', actionHandler);
  });
});
