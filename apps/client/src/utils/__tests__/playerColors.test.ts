import { describe, expect, it } from 'vitest';
import { getContrastingTextColor } from '../playerColors';

describe('getContrastingTextColor', () => {
  it('returns dark text for light backgrounds', () => {
    expect(getContrastingTextColor('#fef08a')).toBe('#0f172a');
  });

  it('returns light text for dark backgrounds', () => {
    expect(getContrastingTextColor('#0f172a')).toBe('#f8fafc');
  });
});
