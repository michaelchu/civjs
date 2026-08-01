import { describe, expect, it } from 'vitest';
import { KeyboardController } from '../KeyboardController';
import { ActionType } from '../../types/shared/actions';

describe('KeyboardController worker automation', () => {
  it('keeps the existing shortcut and wire action while naming it Auto Worker', () => {
    const binding = new KeyboardController().getKeyBindings().get('a');

    expect(binding).toEqual({
      action: ActionType.AUTO_SETTLER,
      description: 'Auto worker',
    });
  });
});
