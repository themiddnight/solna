import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { BEAT_VOICE_IDS, DEFAULT_BEAT_PRESET_ID } from '@/data/beatPresets';
import { MAX_STEPS_PER_BAR, getMeter } from '@/utils/timeSignature';
import { beatParamsFromPreset, beatPresetById, defaultBeatState } from './beatPresets';
import { createDefaultLoop } from './loopSlice';
import { loopStatePatch } from './loop';
import { useAppStore } from './store';

const stepsPerBar = getMeter('4/4').stepsPerBar;

/**
 * The store is a shared singleton across every test file in one bun process,
 * so each test restores the default loop AND the default Beat state rather
 * than trusting whatever an earlier suite left behind.
 */
beforeEach(() => {
  useAppStore.setState({ meterId: '4/4', ...defaultBeatState() });
});

afterEach(() => {
  const loop = createDefaultLoop();
  useAppStore.setState({ loops: [loop], activeLoopId: loop.id, ...loopStatePatch(loop) });
});

const state = () => useAppStore.getState();

describe('beat sound edits', () => {
  test('updateBeatVoice writes one field and leaves every sibling voice identical', () => {
    const previous = state().beatParams;

    state().updateBeatVoice('kick', { decay: 0.7 });

    const next = state().beatParams;
    expect(next.voices.kick.decay).toBe(0.7);
    // Identity, not equality: a value check would pass against an
    // implementation that rebuilt every voice object on every knob tick.
    expect(next.voices.snare).toBe(previous.voices.snare);
    expect(next.voices.hihat).toBe(previous.voices.hihat);
    expect(next.filter).toBe(previous.filter);
    // The kick's own untouched fields survive the patch.
    expect(next.voices.kick.gain).toBe(previous.voices.kick.gain);
  });

  test('updateBeatVoice never writes through to the previous object', () => {
    const previous = state().beatParams;
    state().updateBeatVoice('kick', { decay: 0.7 });
    expect(previous.voices.kick.decay).not.toBe(0.7);
    expect(state().beatParams).not.toBe(previous);
  });

  test('setBeatParams clones: a later write to the caller\'s object never reaches the store', () => {
    // The caller's object is typically a library entry — a factory preset now,
    // a saved user preset from Task 5 — so installing it by reference would
    // let the next knob edit write back into the library.
    const mine = beatParamsFromPreset('club-standard');
    state().setBeatParams(mine);
    expect(state().beatParams).not.toBe(mine);
    expect(state().beatParams.voices.kick).not.toBe(mine.voices.kick);

    mine.voices.kick.decay = 0.123;
    mine.filter.cutoff = 111;
    expect(state().beatParams.voices.kick.decay).not.toBe(0.123);
    expect(state().beatParams.filter.cutoff).not.toBe(111);
  });

  test('setBeatParams installs a whole patch and leaves pattern and mix alone', () => {
    const pattern = state().beatPattern;
    const mix = state().beatMix;

    state().setBeatParams(beatParamsFromPreset('club-standard'));

    expect(state().beatParams.basePresetId).toBe('club-standard');
    expect(state().beatPattern).toBe(pattern);
    expect(state().beatMix).toBe(mix);
  });

  test('setBeatPreset replaces the patch whole, records its provenance and keeps the pattern', () => {
    state().updateBeatVoice('kick', { decay: 0.7 });
    state().toggleBeatStep('kick', 3);
    const pattern = state().beatPattern;

    state().setBeatPreset('trap-beat');

    const preset = beatPresetById('trap-beat')!;
    expect(state().beatParams.basePresetId).toBe('trap-beat');
    expect(state().beatParams.voices).toEqual(preset.patch.voices);
    expect(state().beatParams.filter).toEqual(preset.patch.filter);
    expect(state().beatParams.outputTrimDb).toBe(preset.patch.outputTrimDb);
    // A sound change is not a pattern change.
    expect(state().beatPattern).toBe(pattern);
    expect(state().beatPattern.rows.kick[3]).toBe(true);
  });

  test('setBeatPreset hands out a fresh copy, never the factory table entry', () => {
    state().setBeatPreset('trap-beat');
    state().updateBeatVoice('kick', { decay: 0.123 });
    expect(beatPresetById('trap-beat')!.patch.voices.kick.decay).not.toBe(0.123);
  });

  test('resetBeatVoice restores one voice from the base preset and touches no other', () => {
    state().setBeatPreset('club-standard');
    state().updateBeatVoice('kick', { decay: 0.7 });
    state().updateBeatVoice('snare', { noiseDecay: 0.42 });
    const beforeReset = state().beatParams;

    state().resetBeatVoice('kick');

    const base = beatPresetById('club-standard')!.patch;
    expect(state().beatParams.voices.kick).toEqual(base.voices.kick);
    // The other edited voice keeps BOTH its edit and its identity.
    expect(state().beatParams.voices.snare).toBe(beforeReset.voices.snare);
    expect(state().beatParams.voices.snare.noiseDecay).toBe(0.42);
    expect(state().beatParams.basePresetId).toBe('club-standard');
  });

  test('resetBeatParams restores the whole base patch and keeps its provenance', () => {
    state().setBeatPreset('club-standard');
    state().updateBeatVoice('kick', { decay: 0.7 });
    state().updateBeatVoice('snare', { noiseDecay: 0.42 });

    state().resetBeatParams();

    const base = beatPresetById('club-standard')!.patch;
    expect(state().beatParams.voices).toEqual(base.voices);
    expect(state().beatParams.filter).toEqual(base.filter);
    expect(state().beatParams.basePresetId).toBe('club-standard');
  });

  test('a reset with no resolvable base leaves the sound exactly as stored', () => {
    // `basePresetId: null` is what the sanitizer records for a patch whose base
    // cannot be resolved. Reset is unanswerable then, so it must do NOTHING
    // rather than substitute somebody else's preset.
    useAppStore.setState({ beatParams: { ...beatParamsFromPreset('club-standard'), basePresetId: null } });
    state().updateBeatVoice('kick', { decay: 0.7 });
    const held = state().beatParams;

    state().resetBeatParams();
    expect(state().beatParams).toBe(held);

    state().resetBeatVoice('kick');
    expect(state().beatParams).toBe(held);
  });
});

describe('a saved user preset is a first-class base', () => {
  test('setBeatPreset installs a SAVED USER preset, not the default one', () => {
    // The trap this closes: `beatPresetById` knows the factory table only, and
    // the old `beatParamsFromPreset` fell back to the DEFAULT preset for any id
    // it did not know — so applying a preset the user saved installed somebody
    // else's kit under the user's own name, with no error anywhere.
    state().setBeatPreset('club-standard');
    state().updateBeatVoice('kick', { decay: 0.37 });
    state().updateBeatVoice('snare', { noiseDecay: 0.29 });
    const saved = state().saveCustomBeatPreset('Mine', state().beatParams);

    state().setBeatPreset(DEFAULT_BEAT_PRESET_ID);
    state().setBeatPreset(saved.id);

    expect(state().beatParams.basePresetId).toBe(saved.id);
    expect(state().beatParams.voices).toEqual(saved.patch.voices);
    expect(state().beatParams.voices.kick.decay).toBe(0.37);
    expect(state().beatParams.filter).toEqual(saved.patch.filter);
    // ...and still a fresh copy: the library entry must not be editable
    // through the loop that was just based on it.
    state().updateBeatVoice('kick', { decay: 0.11 });
    expect(saved.patch.voices.kick.decay).toBe(0.37);
    state().deleteCustomBeatPreset(saved.id);
  });

  test('an id no library claims is LOUD, never a silently substituted sound', () => {
    expect(() => state().setBeatPreset('no-such-preset')).toThrow('Unknown Beat preset id');
    // ...and nothing was written on the way out.
    expect(state().beatParams.basePresetId).toBe(DEFAULT_BEAT_PRESET_ID);
  });

  test('reset resolves a USER base too, rather than silently doing nothing', () => {
    state().setBeatPreset('club-standard');
    state().updateBeatVoice('kick', { decay: 0.37 });
    const saved = state().saveCustomBeatPreset('Mine', state().beatParams);
    state().updateBeatVoice('kick', { decay: 0.9 });
    state().updateBeatVoice('snare', { noiseDecay: 0.81 });

    state().resetBeatVoice('kick');
    expect(state().beatParams.voices.kick.decay).toBe(0.37);

    state().resetBeatParams();
    expect(state().beatParams.voices).toEqual(saved.patch.voices);
    expect(state().beatParams.basePresetId).toBe(saved.id);
    state().deleteCustomBeatPreset(saved.id);
  });
});

describe('beat pattern edits', () => {
  test('replaceBeatPattern loops a short row and clears every voice it does not name', () => {
    state().toggleBeatStep('snare', 4);

    state().replaceBeatPattern({ kick: [true, false] });

    const next = state().beatPattern;
    expect(next.rows.kick.slice(0, 4)).toEqual([true, false, true, false]);
    expect(next.rows.snare.every((hit) => !hit)).toBe(true);
  });

  test('replaceBeatPattern writes the ACTIVE window only and preserves wider-meter steps', () => {
    // A step past 4/4's 16-step window is the user's programming for a wider
    // meter and must survive a grid replacement untouched.
    useAppStore.setState({
      beatPattern: {
        rows: {
          ...defaultBeatState().beatPattern.rows,
          kick: (() => {
            const row = new Array<boolean>(MAX_STEPS_PER_BAR).fill(false);
            row[MAX_STEPS_PER_BAR - 1] = true;
            return row;
          })(),
        },
      },
    });

    state().replaceBeatPattern({ kick: [true, false] });

    const kick = state().beatPattern.rows.kick;
    expect(kick).toHaveLength(MAX_STEPS_PER_BAR);
    expect(kick[MAX_STEPS_PER_BAR - 1]).toBe(true);
    expect(kick[stepsPerBar - 1]).toBe(false);
  });

  test('replaceBeatPattern gives every voice its own row', () => {
    state().replaceBeatPattern({});
    const rows = state().beatPattern.rows;
    const seen = new Set(BEAT_VOICE_IDS.map((voice) => rows[voice]));
    expect(seen.size).toBe(BEAT_VOICE_IDS.length);
  });

  test('toggleBeatStep flips one cell and leaves every other row identical', () => {
    const previous = state().beatPattern;

    // Step 3, which the starter groove leaves silent on the hat — so the flip
    // below is off -> on and the assertion is not agreeing with a hit that was
    // already there.
    expect(previous.rows.hihat[3]).toBe(false);
    state().toggleBeatStep('hihat', 3);

    expect(state().beatPattern.rows.hihat[3]).toBe(true);
    expect(state().beatPattern.rows.kick).toBe(previous.rows.kick);
    // The row it replaced is untouched: the write rebuilt the array rather
    // than editing the one every other holder of this pattern still points at.
    expect(previous.rows.hihat[3]).toBe(false);

    // And it is a FLIP, not a set: the second call puts it back.
    state().toggleBeatStep('hihat', 3);
    expect(state().beatPattern.rows.hihat[3]).toBe(false);
    // A step the groove ships ON flips the other way, off.
    expect(state().beatPattern.rows.hihat[2]).toBe(true);
    state().toggleBeatStep('hihat', 2);
    expect(state().beatPattern.rows.hihat[2]).toBe(false);
  });

  test('toggleBeatStep ignores a step outside the stored row', () => {
    const previous = state().beatPattern;
    state().toggleBeatStep('hihat', MAX_STEPS_PER_BAR);
    state().toggleBeatStep('hihat', -1);
    state().toggleBeatStep('hihat', 1.5);
    expect(state().beatPattern).toBe(previous);
  });

  /**
   * The bound is the ACTIVE WINDOW, not the stored row. A hit written into the
   * dormant wider-meter padding draws nowhere and plays nowhere — it surfaces
   * as a phantom the first time the meter widens.
   */
  test('toggleBeatStep is a no-op past the active window and leaves the padding alone', () => {
    const dormant = stepsPerBar + 2;
    expect(dormant).toBeLessThan(MAX_STEPS_PER_BAR);
    // Seed a real dormant hit, so the assertion cannot pass on an all-false row.
    const rows = defaultBeatState().beatPattern.rows;
    rows.hihat[dormant] = true;
    useAppStore.setState({ beatPattern: { rows } });
    const previous = state().beatPattern;

    state().toggleBeatStep('hihat', stepsPerBar);
    state().toggleBeatStep('hihat', dormant);

    expect(state().beatPattern).toBe(previous);
    expect(state().beatPattern.rows.hihat[dormant]).toBe(true);
    // The last column the window DOES reach still writes.
    state().toggleBeatStep('hihat', stepsPerBar - 1);
    expect(state().beatPattern.rows.hihat[stepsPerBar - 1]).toBe(true);
    expect(state().beatPattern.rows.hihat[dormant]).toBe(true);
  });
});

describe('beat mix edits', () => {
  test('setBeatVoiceLevel writes one voice entry and keeps every sibling identical', () => {
    const previous = state().beatMix;

    state().setBeatVoiceLevel('clap', -4.5);

    expect(state().beatMix.voices.clap.levelDb).toBe(-4.5);
    expect(state().beatMix.voices.clap.muted).toBe(false);
    expect(state().beatMix.voices.kick).toBe(previous.voices.kick);
    expect(state().beatMix.levelDb).toBe(previous.levelDb);
  });

  test('toggleBeatVoiceMuted flips one voice only', () => {
    const previous = state().beatMix;

    state().toggleBeatVoiceMuted('ride');

    expect(state().beatMix.voices.ride.muted).toBe(true);
    expect(state().beatMix.voices.crash).toBe(previous.voices.crash);
    expect(previous.voices.ride.muted).toBe(false);
  });

  test('setBeatLevel and toggleBeatMuted move the bus without touching the voices', () => {
    const previous = state().beatMix;

    state().setBeatLevel(-12);
    state().toggleBeatMuted();

    expect(state().beatMix.levelDb).toBe(-12);
    expect(state().beatMix.muted).toBe(true);
    expect(state().beatMix.voices).toBe(previous.voices);
  });

  test('a mix edit never touches the sound or the pattern', () => {
    const params = state().beatParams;
    const pattern = state().beatPattern;
    state().setBeatVoiceLevel('clap', -4.5);
    expect(state().beatParams).toBe(params);
    expect(state().beatPattern).toBe(pattern);
  });
});

describe('the loop mirror', () => {
  const activeLoop = () => {
    const s = state();
    return s.loops.find((loop) => loop.id === s.activeLoopId)!;
  };

  beforeEach(() => {
    const loop = createDefaultLoop();
    useAppStore.setState({ loops: [loop], activeLoopId: loop.id, ...loopStatePatch(loop) });
  });

  /**
   * One committed action must produce ONE store notification carrying both the
   * flat write and its loops[] mirror. Two notifications would mean a second
   * setState — exactly the doubled persist write and render wave loopSync.ts
   * exists to avoid.
   */
  const commits = (action: () => void): number => {
    let notifications = 0;
    const unsubscribe = useAppStore.subscribe(() => {
      notifications += 1;
    });
    action();
    unsubscribe();
    return notifications;
  };

  test('each beat action notifies exactly once and mirrors into the active loop', () => {
    const cases: [string, 'beatParams' | 'beatPattern' | 'beatMix', () => void][] = [
      ['setBeatPreset', 'beatParams', () => state().setBeatPreset('club-standard')],
      ['setBeatParams', 'beatParams', () => state().setBeatParams(beatParamsFromPreset('trap-beat'))],
      ['updateBeatVoice', 'beatParams', () => state().updateBeatVoice('kick', { decay: 0.7 })],
      ['resetBeatVoice', 'beatParams', () => state().resetBeatVoice('kick')],
      ['resetBeatParams', 'beatParams', () => state().resetBeatParams()],
      ['replaceBeatPattern', 'beatPattern', () => state().replaceBeatPattern({ kick: [true, false] })],
      ['toggleBeatStep', 'beatPattern', () => state().toggleBeatStep('snare', 4)],
      ['setBeatVoiceLevel', 'beatMix', () => state().setBeatVoiceLevel('clap', -4.5)],
      ['toggleBeatVoiceMuted', 'beatMix', () => state().toggleBeatVoiceMuted('ride')],
      ['setBeatLevel', 'beatMix', () => state().setBeatLevel(-12)],
      ['toggleBeatMuted', 'beatMix', () => state().toggleBeatMuted()],
    ];

    for (const [name, field, action] of cases) {
      expect(commits(action), name).toBe(1);
      // The mirror is the SAME object the flat slice holds, written in the
      // same set() — not a copy made by a second subscription.
      expect(activeLoop()[field], name).toBe(state()[field]);
    }
  });
});

describe('a fresh loop', () => {
  test('starts from the default preset with full-width rows carrying the starter groove', () => {
    const loop = createDefaultLoop();
    expect(loop.beatParams.basePresetId).toBe(DEFAULT_BEAT_PRESET_ID);
    // The starter groove itself is pinned in initialState.test.ts; what
    // matters here is the WIDTH, which is what a meter change windows.
    expect(loop.beatPattern.rows.kick.some(Boolean)).toBe(true);
    for (const voice of BEAT_VOICE_IDS) {
      expect(loop.beatPattern.rows[voice]).toHaveLength(MAX_STEPS_PER_BAR);
      expect(loop.beatMix.voices[voice].muted, voice).toBe(false);
    }
  });

  test('two loops share no Beat substructure', () => {
    const a = createDefaultLoop();
    const b = createDefaultLoop();
    expect(a.beatPattern.rows.kick).not.toBe(b.beatPattern.rows.kick);
    expect(a.beatParams.voices.kick).not.toBe(b.beatParams.voices.kick);
    expect(a.beatMix.voices.kick).not.toBe(b.beatMix.voices.kick);
    // Step 1, silent in the starter groove, so the write below is a change.
    a.beatPattern.rows.kick[1] = true;
    expect(createDefaultLoop().beatPattern.rows.kick[1]).toBe(false);
  });
});
