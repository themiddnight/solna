import { describe, expect, test } from 'bun:test';
import { MIX_LAYER_IDS } from '@/store/focusTrack';
import { createViewScrollMemory, viewScrollKey } from './useViewScrollMemory';

describe('viewScrollKey', () => {
  test('a non-Pattern tab is its own key, whatever the focus', () => {
    for (const focus of MIX_LAYER_IDS) {
      expect(viewScrollKey('sound', focus)).toBe('sound');
      expect(viewScrollKey('arrange', focus)).toBe('arrange');
      expect(viewScrollKey('master', focus)).toBe('master');
    }
  });

  test('Pattern keys on the visible segment', () => {
    expect(viewScrollKey('pattern', 'synth')).toBe('pattern:lead');
    expect(viewScrollKey('pattern', 'fx')).toBe('pattern:fx');
    expect(viewScrollKey('pattern', 'drum')).toBe('pattern:beat');
  });

  test('the three accompaniment focuses share one segment key', () => {
    expect(viewScrollKey('pattern', 'chord')).toBe('pattern:accompaniment');
    expect(viewScrollKey('pattern', 'bass')).toBe('pattern:accompaniment');
    expect(viewScrollKey('pattern', 'pad')).toBe('pattern:accompaniment');
  });
});

describe('createViewScrollMemory', () => {
  test('a view seen for the first time starts at the top', () => {
    const memory = createViewScrollMemory('pattern:accompaniment');
    memory.record(900);
    expect(memory.switchTo('pattern:lead')).toBe(0);
    expect(memory.current).toBe('pattern:lead');
  });

  test('returning to a view restores its recorded position', () => {
    const memory = createViewScrollMemory('pattern:accompaniment');
    memory.record(900);
    memory.switchTo('pattern:lead');
    memory.settle();
    memory.record(120);
    expect(memory.switchTo('pattern:accompaniment')).toBe(900);
    memory.settle();
    expect(memory.switchTo('pattern:lead')).toBe(120);
  });

  test("the switch's clamp and restore events are recorded against neither view", () => {
    const memory = createViewScrollMemory('pattern:accompaniment');
    memory.record(900);
    memory.switchTo('pattern:lead');
    // The browser clamps 900 to Lead's bottom and fires a scroll event a
    // frame later, before `settle()` runs.
    memory.record(255);
    memory.settle();
    expect(memory.switchTo('pattern:accompaniment')).toBe(900);
    memory.record(255);
    memory.settle();
    expect(memory.switchTo('pattern:lead')).toBe(0);
  });

  test('scrolling after the switch settles is recorded', () => {
    const memory = createViewScrollMemory('sound');
    memory.switchTo('master');
    memory.settle();
    memory.record(40);
    memory.switchTo('sound');
    memory.settle();
    expect(memory.switchTo('master')).toBe(40);
  });
});
