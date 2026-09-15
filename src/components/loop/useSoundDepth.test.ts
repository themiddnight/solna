import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Minimize2, Sliders, Zap } from 'lucide-react';
import type { MixLayerId } from '@/store/focusTrack';
import {
  DRUM_SOUND_DEPTH_KEY,
  LEGACY_SOUND_DEPTH_KEYS,
  readSoundDepth,
  soundDepthOptions,
  SOUND_DEPTH_KEY,
  useSoundDepth,
  writeSoundDepth,
  type DepthStorage,
} from './useSoundDepth';

/** A storage a test drives: every read and write is recorded, none is global. */
function fakeStorage(seed: Record<string, string> = {}) {
  const items = new Map(Object.entries(seed));
  const writes: [string, string][] = [];
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
      writes.push([key, value]);
    },
    writes,
  };
}

/** The case the `typeof window` test never caught: storage that THROWS. */
const throwingStorage: DepthStorage = {
  getItem() {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  },
  setItem() {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  },
};

describe('the stored melodic Sound depth', () => {
  test('reads the current key', () => {
    expect(readSoundDepth('melodic', fakeStorage({ [SOUND_DEPTH_KEY]: 'pro' }))).toBe('pro');
    expect(readSoundDepth('melodic', fakeStorage({ [SOUND_DEPTH_KEY]: 'simple' }))).toBe('simple');
  });

  test('falls back to each legacy key, newest first', () => {
    for (const key of LEGACY_SOUND_DEPTH_KEYS) {
      expect(readSoundDepth('melodic', fakeStorage({ [key]: 'pro' }))).toBe('pro');
    }
    // The current key wins over every legacy one, whatever they hold.
    const both = fakeStorage(
      Object.fromEntries([
        [SOUND_DEPTH_KEY, 'simple'],
        ...LEGACY_SOUND_DEPTH_KEYS.map((key) => [key, 'pro'] as const),
      ]),
    );
    expect(readSoundDepth('melodic', both)).toBe('simple');
  });

  test('a missing, unreadable or nonsense value reads as simple', () => {
    expect(readSoundDepth('melodic', fakeStorage())).toBe('simple');
    expect(readSoundDepth('melodic', fakeStorage({ [SOUND_DEPTH_KEY]: 'expert' }))).toBe('simple');
    expect(readSoundDepth('melodic', null)).toBe('simple');
    // The whole reason the read is inside the try: this must not propagate.
    expect(() => readSoundDepth('melodic', throwingStorage)).not.toThrow();
    expect(readSoundDepth('melodic', throwingStorage)).toBe('simple');
  });

  test('writes only the current key, and survives a storage that throws', () => {
    const storage = fakeStorage({ [LEGACY_SOUND_DEPTH_KEYS[0]]: 'simple' });
    writeSoundDepth('melodic', 'pro', storage);
    expect(storage.writes).toEqual([[SOUND_DEPTH_KEY, 'pro']]);
    expect(() => writeSoundDepth('melodic', 'simple', throwingStorage)).not.toThrow();
  });

  test('an unoffered CURRENT value reads as the default, never a legacy key', () => {
    // The melodic key holding a drum-only depth is "no preference for this
    // scope". Falling through to the legacy synth-view-mode key instead
    // resurrected a stale preference the user never expressed here.
    const store = fakeStorage({
      [SOUND_DEPTH_KEY]: 'minimal',
      musibox_synth_view_mode: 'pro',
    });
    expect(readSoundDepth('melodic', store)).toBe('simple');
  });

  test('a legacy key is still adopted when the current key is ABSENT', () => {
    expect(readSoundDepth('melodic', fakeStorage({ musibox_synth_view_mode: 'pro' }))).toBe('pro');
  });
});

/**
 * The drum value is a SEPARATE preference: it never existed before this
 * split, so it adopts none of the melodic legacy keys — adopting them would
 * hand a user's old synth Simple/Pro setting to an editor it was never about.
 */
describe('the stored drum Sound depth', () => {
  test('reads its own key, independent of the melodic key', () => {
    expect(readSoundDepth('drum', fakeStorage({ [DRUM_SOUND_DEPTH_KEY]: 'pro' }))).toBe('pro');
    expect(readSoundDepth('drum', fakeStorage({ [SOUND_DEPTH_KEY]: 'pro' }))).toBe('simple');
  });

  test('adopts none of the melodic legacy keys', () => {
    for (const key of LEGACY_SOUND_DEPTH_KEYS) {
      expect(readSoundDepth('drum', fakeStorage({ [key]: 'pro' }))).toBe('simple');
    }
  });

  test('a missing, unreadable or nonsense value reads as simple', () => {
    expect(readSoundDepth('drum', fakeStorage())).toBe('simple');
    expect(readSoundDepth('drum', fakeStorage({ [DRUM_SOUND_DEPTH_KEY]: 'expert' }))).toBe('simple');
    expect(readSoundDepth('drum', null)).toBe('simple');
    expect(() => readSoundDepth('drum', throwingStorage)).not.toThrow();
    expect(readSoundDepth('drum', throwingStorage)).toBe('simple');
  });

  test('writes only its own key, never the melodic one', () => {
    const storage = fakeStorage();
    writeSoundDepth('drum', 'pro', storage);
    expect(storage.writes).toEqual([[DRUM_SOUND_DEPTH_KEY, 'pro']]);
    expect(() => writeSoundDepth('drum', 'simple', throwingStorage)).not.toThrow();
  });
});

/**
 * The hook itself: two independent values, selected by focus, both held
 * unconditionally so the hook is never called conditionally.
 */
describe('useSoundDepth scoping', () => {
  /** A render-only harness: calling `setDepth` during render is test-only
   *  plumbing to exercise the hook's write path under `renderToString`,
   *  which has no interactivity to click through. */
  function Probe({
    focus,
    storage,
    setTo,
  }: {
    focus: MixLayerId;
    storage: DepthStorage;
    setTo?: { value: 'pro'; done: { fired: boolean } };
  }) {
    const { depth, setDepth } = useSoundDepth(focus, storage);
    if (setTo && !setTo.done.fired) {
      setTo.done.fired = true;
      setDepth(setTo.value);
    }
    return createElement('span', null, depth);
  }

  test('setting depth on one scope leaves the other reading its own key', () => {
    const storage = fakeStorage();
    renderToString(
      createElement(Probe, { focus: 'synth', storage, setTo: { value: 'pro', done: { fired: false } } }),
    );

    // This is the assertion that must fail against a single shared value:
    // writing Pro on the melodic scope must not leak into the drum scope.
    expect(readSoundDepth('drum', storage)).toBe('simple');
    expect(readSoundDepth('melodic', storage)).toBe('pro');

    const drumHtml = renderToString(createElement(Probe, { focus: 'drum', storage }));
    expect(drumHtml).toContain('simple');
  });

  test('each scope reads its own key on init, both held unconditionally', () => {
    const storage = fakeStorage({ [SOUND_DEPTH_KEY]: 'pro', [DRUM_SOUND_DEPTH_KEY]: 'simple' });
    expect(renderToString(createElement(Probe, { focus: 'synth', storage }))).toContain('pro');
    expect(renderToString(createElement(Probe, { focus: 'drum', storage }))).toContain('simple');
  });
});

/**
 * One value, two vocabularies. The synth's Simple/Pro is a real depth split —
 * two panel trees — while Beat's is disclosure over one parameter model, so
 * calling Beat's deep state "Pro" would make one word mean two things.
 */
describe('the depth vocabulary', () => {
  test('a melodic focus reads Simple and Pro', () => {
    for (const focus of ['synth', 'fx', 'chord', 'bass', 'pad'] as const) {
      expect(soundDepthOptions(focus).map((o) => o.label)).toEqual(['Simple', 'Pro']);
    }
  });

  test('a drum focus reads Simple, Essential and All', () => {
    expect(soundDepthOptions('drum').map((o) => o.label)).toEqual([
      'Simple',
      'Essential',
      'All',
    ]);
  });

  /* `minimal` is the drum scope's alone: it hides the voice grid, and a synth
     channel has no bus-only state to hide anything down to. Asserted on the
     OPTION LIST rather than on the union, because the union legitimately holds
     all three — what must not happen is the melodic switch OFFERING one the
     synth editor cannot render. */
  test('a melodic focus is never offered the bus-only depth', () => {
    for (const focus of ['synth', 'fx', 'chord', 'bass', 'pad'] as const) {
      expect(soundDepthOptions(focus).map((o) => o.depth)).toEqual(['simple', 'pro']);
    }
    expect(soundDepthOptions('drum').map((o) => o.depth)).toEqual([
      'minimal',
      'simple',
      'pro',
    ]);
  });

  /* And the read refuses it too, so a melodic key holding `minimal` — hand
     edited, or written by a build where the scopes shared one list — cannot
     put the synth editor in a state it has no rendering for. */
  test('a melodic key holding the bus-only depth reads as no preference', () => {
    const storage = fakeStorage({ [SOUND_DEPTH_KEY]: 'minimal' });
    expect(readSoundDepth('melodic', storage)).toBe('simple');
    expect(readSoundDepth('drum', fakeStorage({ [DRUM_SOUND_DEPTH_KEY]: 'minimal' }))).toBe(
      'minimal',
    );
  });

  // The same stored value and the same switch, so the same icons: a second
  // icon pair across a focus change would say a different control had appeared.
  test('the icons never change with the vocabulary', () => {
    for (const focus of ['synth', 'drum'] as const) {
      const options = soundDepthOptions(focus);
      // Compared by the depth each option carries, so the shared-icon claim
      // survives the two scopes offering lists of different lengths.
      for (const option of options) {
        expect(option.icon).toBe(DEPTH_ICONS_EXPECTED[option.depth]);
      }
      expect(options.every((o) => o.title.length > 0)).toBe(true);
    }
  });
});

/** What each depth must be drawn with, in either scope. */
const DEPTH_ICONS_EXPECTED = { minimal: Minimize2, simple: Sliders, pro: Zap } as const;
