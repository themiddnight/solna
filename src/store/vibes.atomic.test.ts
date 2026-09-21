import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { shallow } from 'zustand/shallow';
import { BEAT_VOICE_IDS } from '@/data/beatPresets';
import { VIBES } from '../data/vibes';
import { DEFAULT_METER_ID, MAX_STEPS_PER_BAR } from '../utils/meter';
import { INITIAL_EFFECTS } from './initialState';
import { loopStatePatch } from './loop';
import { createDefaultLoop } from './loopSlice';
import { SCOPE_NONE } from './playbackScope';
import { useAppStore } from './store';
import { DEFAULT_BPM } from './transportSlice';
import { applyVibeToStore, resolveVibe, resolveVibeSynthParams, vibeContentPatch } from './vibes';

/**
 * Split out of vibes.test.ts to stay under the file's own line-count gate
 * (eslint.config.js's max-lines: "Split the file, never raise the cap"). Pins
 * that applying a vibe is ONE content write: one notification, the loops[]
 * mirror carried in it, and the meter-before-grid ordering kept inside it.
 */
const RESOLVED_VIBES = VIBES.map(resolveVibe);

const resetStore = () => {
  const loop = createDefaultLoop();
  useAppStore.setState({
    loops: [loop],
    activeLoopId: loop.id,
    ...loopStatePatch(loop),
    sequencerPlayer: 'stopped',
    chordsPlayer: 'stopped',
    leadPlayer: 'stopped',
    songLoopIndex: null,
    activeTab: 'sound',
    playbackScope: SCOPE_NONE,
    selectedVibeId: null,
    bpm: DEFAULT_BPM,
    meterId: DEFAULT_METER_ID,
    effects: { ...INITIAL_EFFECTS },
  });
};

describe('applyVibeToStore writes the vibe in one atomic patch', () => {
  beforeEach(resetStore);
  afterEach(() => {
    useAppStore.getState().hardStopAll();
    resetStore();
  });

  test('applying a vibe notifies content subscribers exactly once', () => {
    // Guard against a vacuous pass: the vibe must actually change both.
    const vibe = RESOLVED_VIBES[0];
    const before = useAppStore.getState();
    expect(vibe.scaleRoot).not.toBe(before.scaleRoot);
    expect(vibe.chords).not.toEqual(before.chords);

    let notified = 0;
    const off = useAppStore.subscribe((s) => s.chords, () => { notified++; });
    const offKey = useAppStore.subscribe((s) => s.scaleRoot, () => { notified += 100; });
    applyVibeToStore(vibe);
    off(); offKey();
    expect(notified).toBe(101); // one chords change + one key change, each in the single write
  });

  test('every content field a vibe states lands in the same store notification', () => {
    let writes = 0;
    const off = useAppStore.subscribe(
      (s) => [
        s.bpm, s.meterId, s.scaleRoot, s.scaleType, s.selectedVibeId, s.loops,
        s.beatParams, s.beatPattern, s.chords, s.chordRhythmId, s.chordFeel,
        s.chordSynthParams, s.bassPatternId, s.bassSynthParams, s.padMuted,
        s.synthParams, s.fxSynthParams, s.effects, s.leadMelodySteps,
      ],
      () => { writes++; },
      { equalityFn: shallow },
    );
    applyVibeToStore(RESOLVED_VIBES[0]);
    off();
    expect(writes).toBe(1);
  });

  test('the one write keeps loops[] mirrored', () => {
    applyVibeToStore(RESOLVED_VIBES[0]);
    const s = useAppStore.getState();
    const active = s.loops.find((l) => l.id === s.activeLoopId)!;
    expect(active.chords).toEqual(s.chords);
    expect(active.scaleRoot).toBe(s.scaleRoot);
    expect(active.beatParams).toEqual(s.beatParams);
    expect(active.tempName).toBe(RESOLVED_VIBES[0].name);
  });

  test('the drum grid is windowed to the vibe meter, not the outgoing one', () => {
    // Every stored slot starts lit. A 3/4 vibe windows its rows to 12 steps, so
    // the slots past 12 are wider-meter padding and must survive; a grid
    // written against the OUTGOING 4/4 window would clear 12..15.
    const waltz = RESOLVED_VIBES.find((v) => v.id === 'lofi-waltz')!;
    expect(waltz.meter).toBe('3/4');
    const lit = Object.fromEntries(
      BEAT_VOICE_IDS.map((voice) => [voice, new Array<boolean>(MAX_STEPS_PER_BAR).fill(true)]),
    ) as ReturnType<typeof useAppStore.getState>['beatPattern']['rows'];
    useAppStore.setState({ meterId: '4/4', beatPattern: { rows: lit } });
    applyVibeToStore(waltz);
    const kick = useAppStore.getState().beatPattern.rows.kick;
    expect(kick.slice(12, 16)).toEqual([true, true, true, true]);
  });

  test('vibeContentPatch is pure: it builds the patch and writes nothing', () => {
    const vibe = RESOLVED_VIBES[0];
    const before = useAppStore.getState();
    const patch = vibeContentPatch(before, vibe, {
      chord: resolveVibeSynthParams(vibe.chordPresetId, 'chord'),
      bass: resolveVibeSynthParams(vibe.bassPresetId, 'bass'),
      synth: resolveVibeSynthParams(vibe.synthPresetId, 'synth'),
      fx: resolveVibeSynthParams(vibe.fxPresetId, 'fx'),
      pad: null,
    });
    expect(useAppStore.getState()).toBe(before);
    expect(patch.meterId).toBe(vibe.meter);
    expect(patch.scaleRoot).toBe(vibe.scaleRoot);
    expect(patch.padMuted).toBe(true);
    expect(patch.selectedVibeId).toBe(vibe.id);
  });
});
