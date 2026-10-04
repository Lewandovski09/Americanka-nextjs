import { describe, it, expect } from 'vitest';
import { pressable } from './a11y';

const key = (k: string, same = true) => {
  const el = {};
  let prevented = false;
  return { e: { key: k, target: el, currentTarget: same ? el : {}, preventDefault: () => (prevented = true) } as any, wasPrevented: () => prevented };
};

describe('pressable', () => {
  it('is empty when the element is not clickable', () => {
    expect(pressable(() => {}, false)).toEqual({});
  });

  it('runs the action on Enter and Space', () => {
    let n = 0;
    const p: any = pressable(() => n++);
    expect(p.role).toBe('button');
    expect(p.tabIndex).toBe(0);
    const enter = key('Enter');
    p.onKeyDown(enter.e);
    p.onKeyDown(key(' ').e);
    p.onKeyDown(key('a').e);
    expect(n).toBe(2);
    expect(enter.wasPrevented()).toBe(true);
  });

  it('leaves key presses from a child to the child', () => {
    let n = 0;
    const p: any = pressable(() => n++);
    p.onKeyDown(key('Enter', false).e);
    expect(n).toBe(0);
  });
});
