import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { useAppStore } from './store';
import { MAX_STEPS_PER_BAR } from '../utils/timeSignature';
import type { LeadNote } from '../audio/playback/leadMelody';
import { readFileSync } from 'node:fs';
import { changeKey } from './keyChange';
import { MELODY_TRACKS } from './melodyTracks';
import type { ChordItem } from '../types';

function emptyMelody(): LeadNote[][] {
  return Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as LeadNote[]);
}

describe('musicContextSlice — setScaleRoot re-maps the lead melody', () => {
  beforeEach(() => {
    const steps = emptyMelody();
    steps[0] = [{ note: 'A3', len: 1 }, { note: 'C4', len: 1 }];
    steps[1] = [{ note: 'E4', len: 1 }];
    useAppStore.setState({ scaleRoot: 'A', scaleType: 'Natural Minor', leadMelodySteps: steps });
  });

  test('transposes every lead note by the root interval (A → C)', () => {
    useAppStore.getState().setScaleRoot('C');
    const s = useAppStore.getState();
    expect(s.scaleRoot).toBe('C');
    expect(s.leadMelodySteps[0]).toEqual([{ note: 'C3', len: 1 }, { note: 'D#3', len: 1 }]);
    expect(s.leadMelodySteps[1]).toEqual([{ note: 'G3', len: 1 }]);
  });
});

describe('musicContextSlice — setScaleType re-maps the lead melody', () => {
  beforeEach(() => {
    const steps = emptyMelody();
    steps[0] = [{ note: 'A3', len: 1 }, { note: 'F4', len: 1 }];
    useAppStore.setState({ scaleRoot: 'A', scaleType: 'Natural Minor', leadMelodySteps: steps });
  });

  test('re-maps in-scale degrees (minor → dorian raises degree 5)', () => {
    useAppStore.getState().setScaleType('Dorian');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([
      { note: 'A3', len: 1 },
      { note: 'F#4', len: 1 },
    ]);
  });

  test('leaves out-of-scale notes unchanged on a scale change', () => {
    const steps = emptyMelody();
    steps[0] = [{ note: 'C#4', len: 1 }];
    useAppStore.setState({ scaleRoot: 'A', scaleType: 'Natural Minor', leadMelodySteps: steps });
    useAppStore.getState().setScaleType('Dorian');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'C#4', len: 1 }]);
  });
});

describe('musicContextSlice — every melody track follows the key (MELODY_TRACKS)', () => {
  beforeEach(() => {
    const lead = emptyMelody();
    lead[0] = [{ note: 'A3', len: 1 }];
    const fx = emptyMelody();
    fx[0] = [{ note: 'C4', len: 1 }];
    fx[1] = [{ note: 'F4', len: 1 }];
    useAppStore.setState({ scaleRoot: 'A', scaleType: 'Natural Minor', leadMelodySteps: lead, fxMelodySteps: fx });
  });

  test('setScaleRoot transposes FX exactly as it transposes Lead', () => {
    useAppStore.getState().setScaleRoot('C');
    const s = useAppStore.getState();
    expect(s.leadMelodySteps[0]).toEqual([{ note: 'C3', len: 1 }]);
    expect(s.fxMelodySteps[0]).toEqual([{ note: 'D#3', len: 1 }]);
  });

  test('setScaleType remaps FX exactly as it remaps Lead', () => {
    useAppStore.getState().setScaleType('Dorian');
    expect(useAppStore.getState().fxMelodySteps[1]).toEqual([{ note: 'F#4', len: 1 }]);
  });

  test('changeKey writes one steps field per MELODY_TRACKS row and nothing else', () => {
    const patch = changeKey(useAppStore.getState(), { root: 'C' }, { harmonizeChords: false });
    const stepKeys = MELODY_TRACKS.map((t) => t.steps).sort();
    expect(Object.keys(patch).sort()).toEqual(['scaleRoot', ...stepKeys].sort());
  });

  test('source scan: no hand-written melody field in the slice', () => {
    const src = readFileSync(new URL('./musicContextSlice.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/leadMelodySteps|fxMelodySteps/);
  });
});

const PROG: ChordItem[] = [
  { id: 'c1', root: 'A', quality: 'min', bars: 1 },
  { id: 'c2', root: 'F', quality: 'maj', bars: 1 },
];

describe('musicContextSlice — chords follow the key in the same write', () => {
  // This block's tests key-change the singleton store's chords, autoReharmonize
  // and reharmonizedIndicator (and the loops[active] mirror). Restore the
  // pre-test baseline after each test so a sibling suite reading the store
  // does not see this block's leftovers — see vibes.test.ts's resetStore and
  // reharmonizeNav.test.ts's baseline restore.
  let baseline: ReturnType<typeof useAppStore.getState>;

  beforeEach(() => {
    baseline = useAppStore.getState();
    useAppStore.setState({
      scaleRoot: 'A', scaleType: 'Natural Minor', chords: PROG,
      autoReharmonize: true, reharmonizedIndicator: false,
    });
  });

  afterEach(() => {
    useAppStore.setState(baseline);
  });

  test('toggle on: one notification carries key, chords, indicator and the loops[] mirror', () => {
    let notifications = 0;
    const stop = useAppStore.subscribe(() => { notifications += 1; });
    useAppStore.getState().setScaleRoot('C');
    stop();
    const s = useAppStore.getState();
    expect(notifications).toBe(1);
    expect(s.chords.map((c) => c.root)).toEqual(['C', 'G#']);
    expect(s.reharmonizedIndicator).toBe(true);
    expect(s.loops.find((l) => l.id === s.activeLoopId)!.chords).toBe(s.chords);
  });

  test('toggle off: chords untouched by reference, indicator stays false', () => {
    useAppStore.getState().setAutoReharmonize(false);
    useAppStore.getState().setScaleRoot('C');
    expect(useAppStore.getState().chords).toBe(PROG);
    expect(useAppStore.getState().reharmonizedIndicator).toBe(false);
  });

  test('turning the toggle off clears the indicator; turning it on rewrites nothing', () => {
    useAppStore.getState().setScaleRoot('C');
    useAppStore.getState().setAutoReharmonize(false);
    expect(useAppStore.getState().reharmonizedIndicator).toBe(false);
    const before = useAppStore.getState().chords;
    useAppStore.getState().setAutoReharmonize(true);
    expect(useAppStore.getState().chords).toBe(before);
  });

  test('root then type through the setters equals one combined changeKey', () => {
    const start = useAppStore.getState();
    const combined = changeKey(start, { root: 'C', scaleType: 'Major' }, { harmonizeChords: true });
    useAppStore.getState().setScaleRoot('C');
    useAppStore.getState().setScaleType('Major');
    expect(useAppStore.getState().chords).toEqual(combined.chords!);
  });
});
