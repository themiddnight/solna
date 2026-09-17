import { afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
import {
  resetNoteInputListeners,
  subscribeNoteInput,
  type NoteInputEvent,
} from '../audio/playback/noteInputBus';
import {
  computeDisconnectedInputIds,
  createHeldNoteTracker,
  __flushCcFramesForTests,
  startMidiInputBridge,
} from './midiInput';
import { useAppStore } from './store';
import { sliderPosTodB } from '../utils/gainUnits';
import type { VoiceId } from '../audio/synth/voiceId';
import type { ActiveSynth } from '../types/synth';
import { noteFrequency } from '@/utils/musicTheory';

/** The NEXT patch of one `updateSynthPatch` call — argument 1, not argument 0.
 *  Argument 0 is what the engine is told the patch WAS; the pair is what the
 *  engine diffs to decide which continuous controls actually moved. */
const nextPatch = (call: unknown[] | undefined): ActiveSynth => (call as unknown[])[1] as ActiveSynth;

describe('computeDisconnectedInputIds', () => {
  test('returns ids present before but missing now', () => {
    expect(computeDisconnectedInputIds(['a', 'b', 'c'], ['a', 'c'])).toEqual(['b']);
  });

  test('returns an empty list when nothing disappeared', () => {
    expect(computeDisconnectedInputIds(['a', 'b'], ['a', 'b', 'c'])).toEqual([]);
  });

  test('returns an empty list on the first enumeration', () => {
    expect(computeDisconnectedInputIds([], ['a', 'b'])).toEqual([]);
  });
});

describe('createHeldNoteTracker', () => {
  test('release returns every note currently on for that input, WITH its voice, and clears it', () => {
    const tracker = createHeldNoteTracker();
    tracker.noteOn('dev-1', 'C4', 'v1' as VoiceId);
    tracker.noteOn('dev-1', 'E4', 'v2' as VoiceId);
    tracker.noteOn('dev-2', 'G3', 'v3' as VoiceId);

    // The voice, not just the note: a flush has to release the exact
    // instances this device started, and the lead bus carries the on-screen
    // keyboard, the arp and the melody grid as well.
    expect(tracker.release('dev-1')).toEqual([
      { note: 'C4', voiceId: 'v1' as VoiceId },
      { note: 'E4', voiceId: 'v2' as VoiceId },
    ]);
    expect(tracker.release('dev-1')).toEqual([]);
    expect(tracker.release('dev-2')).toEqual([{ note: 'G3', voiceId: 'v3' as VoiceId }]);
  });

  test('noteOff hands back the voice it was tracking and forgets the note', () => {
    const tracker = createHeldNoteTracker();
    tracker.noteOn('dev-1', 'C4', 'v1' as VoiceId);

    expect(tracker.noteOff('dev-1', 'C4')).toBe('v1' as VoiceId);
    expect(tracker.release('dev-1')).toEqual([]);
    // A note the tracker never saw has no voice to release.
    expect(tracker.noteOff('dev-1', 'C4')).toBeNull();
  });

  test('release on an unknown input id is a no-op', () => {
    const tracker = createHeldNoteTracker();
    expect(tracker.release('missing')).toEqual([]);
  });
});

// The Bun test runtime has no Web MIDI API at all (no navigator.requestMIDIAccess,
// no MIDIAccess/MIDIInput, no 'statechange' event), so the objects below hand-build
// just enough of each to drive setupInputs()'s enumeration and access.onstatechange.
//
// `state` defaults to 'connected' and is mutated in place rather than the port
// being removed, because that is what Chromium actually does on disconnect
// (blink's MidiAccess::DidSetInputPortState looks the port up by index and
// calls SetState() on it — it never erases from the map). A fake that instead
// deleted the port on "disconnect" would hide exactly the bug this module
// exists to fix: it would make the map-diff path look sufficient when real
// hardware never triggers it.
class FakeMidiInput {
  readonly type = 'input';
  state: 'connected' | 'disconnected' = 'connected';
  onmidimessage: ((event: { data: number[]; target: FakeMidiInput }) => void) | null = null;
  constructor(public readonly id: string) {}
}

class FakeMidiAccess {
  inputs = new Map<string, FakeMidiInput>();
  onstatechange: ((event: { port: FakeMidiInput | null }) => void) | null = null;
}

// Bound once for the whole file: startMidiInputBridge() is guarded by a
// module-level `started` flag and binds to whatever requestMIDIAccess
// resolves with exactly once per process, so every scenario below drives
// this SAME fake access object rather than restarting the bridge.
const access = new FakeMidiAccess();

beforeAll(async () => {
  (navigator as unknown as { requestMIDIAccess: () => Promise<FakeMidiAccess> }).requestMIDIAccess = () =>
    Promise.resolve(access);
  startMidiInputBridge();
  // requestMIDIAccess().then(...) resolves on a microtask; give it a turn
  // of the loop before any test touches `access`.
  await Promise.resolve();
  await Promise.resolve();
});

// `ccFrames` (src/store/midiInput.ts) is module scope, so a CC test that
// pushes to the same `targetKey` as one that ran moments earlier can land
// inside that earlier test's still-armed real-timer window (the coalescer
// falls back to a bare `setTimeout` outside a browser) and get silently
// deferred rather than applied immediately. Settling it after every test in
// this file — not only the coalescing describe block below — keeps every CC
// test's first push a leading edge regardless of run order.
afterEach(() => {
  __flushCcFramesForTests();
});

function connect(id: string): FakeMidiInput {
  const input = new FakeMidiInput(id);
  access.inputs.set(id, input);
  access.onstatechange?.({ port: input });
  return input;
}

function noteOn(input: FakeMidiInput, midiNote: number): void {
  input.onmidimessage?.({ data: [0x90, midiNote, 100], target: input });
}

// Primary detection path: Chromium's real shape — the port stays in
// `access.inputs`, only `state` flips to 'disconnected', and the
// statechange event carries that same port.
function disconnectByStateFlip(input: FakeMidiInput): void {
  input.state = 'disconnected';
  access.onstatechange?.({ port: input });
}

// Defense-in-depth path: an implementation that honours the spec's
// non-normative "should not appear in the map" text and removes the port
// outright instead of flipping its state.
function disconnectByRemoval(input: FakeMidiInput): void {
  access.inputs.delete(input.id);
  access.onstatechange?.({ port: null });
}

/**
 * Spies the note pair, handing each note-on an id derived from its note name.
 *
 * The engine has no context in these tests, so a real `triggerSynthNoteOn`
 * returns `null` and every release would be skipped — the assertions below
 * would pass vacuously against an empty call list. Mocking a returned id is
 * what keeps them about the flush rather than about the missing context.
 */
function spyNotePair() {
  const on = spyOn(audioEngine, 'triggerSynthNoteOn').mockImplementation(
    (frequency: number) => `voice-${frequency}` as VoiceId,
  );
  const off = spyOn(audioEngine, 'triggerSynthNoteOff').mockClear();
  return {
    on,
    off,
    /** The FREQUENCIES the releases addressed, recovered from the ids they were given. */
    releasedFrequencies: () => off.mock.calls.map((call) => Number(String(call[0]).replace('voice-', ''))),
    restore: () => {
      on.mockRestore();
      off.mockRestore();
    },
  };
}

describe('startMidiInputBridge releases held notes on disconnect (state flip — Chromium shape)', () => {
  test('a note held at disconnect is released, by the voice it started', () => {
    const spies = spyNotePair();
    const input = connect('dev-a');
    noteOn(input, 60); // C4

    disconnectByStateFlip(input);

    expect(spies.off.mock.calls.map((call) => call[0])).toEqual([`voice-${noteFrequency('C4')}` as VoiceId]);
    spies.restore();
  });

  test('several held notes are all released', () => {
    const spies = spyNotePair();
    const input = connect('dev-b');
    noteOn(input, 60); // C4
    noteOn(input, 64); // E4

    disconnectByStateFlip(input);

    expect(spies.releasedFrequencies().sort((a, b) => a - b)).toEqual(['C4', 'E4'].map((n) => noteFrequency(n)).sort((a, b) => a - b));
    spies.restore();
  });

  test('a disconnect with nothing held fires no release', () => {
    const spies = spyNotePair();
    const input = connect('dev-c');

    disconnectByStateFlip(input);

    expect(spies.off).not.toHaveBeenCalled();
    spies.restore();
  });
});

describe('startMidiInputBridge releases held notes on disconnect (map removal fallback)', () => {
  test('a note held is released when the port is removed from the map instead of flipped', () => {
    const spies = spyNotePair();
    const input = connect('dev-d');
    noteOn(input, 67); // G4

    disconnectByRemoval(input);

    expect(spies.releasedFrequencies()).toEqual(['G4'].map((n) => noteFrequency(n)));
    spies.restore();
  });

  test('a device caught by both the state flip and the map removal is flushed once, not twice', () => {
    const spies = spyNotePair();
    const input = connect('dev-e');
    noteOn(input, 60); // C4

    // Some implementation could plausibly fire the event AND drop the map
    // entry for the same disconnect; both detection paths must agree on a
    // single flush.
    disconnectByStateFlip(input);
    access.inputs.delete(input.id);
    access.onstatechange?.({ port: input });

    expect(spies.releasedFrequencies()).toEqual(['C4'].map((n) => noteFrequency(n)));
    spies.restore();
  });
});

// A MIDI device is a person playing, so it has to arrive on the note-input
// bus like every other input source. It used to call audioEngine directly,
// which made it audible but invisible: a recorder listening for performed
// notes would have heard the computer keyboard and silently missed the piano.
describe('MIDI joins the note-input funnel', () => {
  test('a note-on from a device is announced on the bus', () => {
    const events: NoteInputEvent[] = [];
    subscribeNoteInput((e) => events.push(e));
    const input = connect('dev-bus-on');

    noteOn(input, 60); // C4

    expect(events).toEqual([{ kind: 'on', note: 'C4', velocity: 100 / 127, time: undefined }]);
    resetNoteInputListeners();
  });

  test('a note-off from a device is announced too', () => {
    const events: NoteInputEvent[] = [];
    subscribeNoteInput((e) => events.push(e));
    const input = connect('dev-bus-off');

    noteOn(input, 60);
    input.onmidimessage?.({ data: [0x80, 60, 0], target: input });

    expect(events.map((e) => e.kind)).toEqual(['on', 'off']);
    resetNoteInputListeners();
  });

  test('notes flushed by a disconnect are announced, so nothing stays stuck held', () => {
    const events: NoteInputEvent[] = [];
    const input = connect('dev-bus-flush');
    noteOn(input, 60);
    subscribeNoteInput((e) => events.push(e));

    disconnectByStateFlip(input);

    expect(events).toEqual([{ kind: 'off', note: 'C4', velocity: 0, time: undefined }]);
    resetNoteInputListeners();
  });
});

describe('MIDI CC drives masterVolume on the fader taper, not a linear dB ramp', () => {
  // No test previously exercised the default 'm-vol' mapping (CC 7) at all —
  // this is new coverage, not a replacement.
  test('CC 127 lands on the top of the taper: +12 dB', () => {
    // Asserted on the STORE, and only on the store. This handler used to also
    // call audioEngine.setMasterVolume(faderDbToGain(db)) itself, which made
    // this file a second dB->linear boundary that had to agree with
    // engineSync's forever. It writes the store and stops now: engineSync
    // subscribes to `masterVolume` with fireImmediately and starts this bridge
    // itself, so the subscription provably exists before any CC arrives, and
    // the linear conversion is asserted once where it lives (engineSync.test).
    const setMasterVolume = spyOn(audioEngine, 'setMasterVolume').mockClear();
    const input = connect('dev-cc-master-top');

    input.onmidimessage?.({ data: [0xb0, 7, 127], target: input });

    expect(useAppStore.getState().masterVolume).toBeCloseTo(12, 6);
    expect(setMasterVolume).not.toHaveBeenCalled();
  });

  test('CC 95 (0.748..) sits a hair below unity, on the same curve VolumeFader draws', () => {
    const input = connect('dev-cc-master-mid');

    input.onmidimessage?.({ data: [0xb0, 7, 95], target: input });

    const expectedDb = sliderPosTodB(95 / 127);
    expect(expectedDb).toBeLessThan(0);
    expect(useAppStore.getState().masterVolume).toBeCloseTo(expectedDb, 6);
  });
});

// Unlike masterVolume, the five synth-param branches (filterCutoff,
// filterResonance, attack, release, oscType) push to audioEngine directly, in
// addition to writing the store. That is not leftover duplication: engineSync
// (not started in this file — see its own subscription tests) ALSO routes
// updateSynthPatch through its own per-key frame coalescer
// (src/utils/frameCoalescer.ts) keyed on the synth bus, which applies only
// the FIRST value inside an animation-frame window and defers any repeat to
// the next frame; the direct call here is what an isolated `synthParams`
// write (with engineSync not running) still needs to reach the engine at
// all. `applyCcMapping` itself now ALSO routes every branch's whole body
// (store write plus this direct engine call) through its own module-level
// `ccFrames` coalescer, keyed on `mapping.targetKey` — a hardware fader
// sweep transmits CC byte-pairs at a rate comparable to or higher than a
// mouse drag, and per-message store writes carried the full render-fanout
// and persist-tick cost of a `set()` for every byte pair. This test pins
// that a single message per target still reaches the engine with the right
// computed value, in the same synchronous tick; the coalescing behaviour
// itself — a same-target repeat inside one frame collapsing to the latest
// value — is proven separately below.
describe('MIDI CC pushes the five synth-param branches straight to the engine', () => {
  test('filterCutoff (CC 74) computes Hz from the CC value and pushes it directly', () => {
    const updateSynthPatch = spyOn(audioEngine, 'updateSynthPatch').mockClear();
    const input = connect('dev-cc-filter-cutoff');

    input.onmidimessage?.({ data: [0xb0, 74, 64], target: input });

    const expectedHz = Math.round(20 * Math.pow(1000, 64 / 127));
    expect(useAppStore.getState().synthParams.patch.synth.filter.cutoffHz).toBe(expectedHz);
    const lastCall = updateSynthPatch.mock.calls.at(-1);
    expect(lastCall?.[2]).toBe('synth');
    // Argument 1 is the patch the engine is told it WAS, argument 2 what it
    // now IS — `updateSynthPatch` diffs them to decide what actually moved.
    expect(nextPatch(lastCall).patch.synth.filter.cutoffHz).toBe(expectedHz);

    updateSynthPatch.mockRestore();
  });

  test('filterResonance (CC 71), attack (CC 73), release (CC 72) and oscType (CC 16) all push directly too', () => {
    const updateSynthPatch = spyOn(audioEngine, 'updateSynthPatch').mockClear();
    const input = connect('dev-cc-other-synth-targets');
    const slot2Before = useAppStore.getState().synthParams.patch.synth.oscillators[1].waveform;

    input.onmidimessage?.({ data: [0xb0, 71, 64], target: input });
    input.onmidimessage?.({ data: [0xb0, 73, 64], target: input });
    input.onmidimessage?.({ data: [0xb0, 72, 64], target: input });
    input.onmidimessage?.({ data: [0xb0, 16, 64], target: input });

    const patch = useAppStore.getState().synthParams.patch.synth;
    const calls = updateSynthPatch.mock.calls.filter(([, , source]) => source === 'synth');
    expect(calls.length).toBe(4);
    expect(nextPatch(calls.at(-4)).patch.synth.filter.resonance).toBe(patch.filter.resonance);
    expect(nextPatch(calls.at(-3)).patch.synth.ampEnvelope.attack).toBe(patch.ampEnvelope.attack);
    expect(nextPatch(calls.at(-2)).patch.synth.ampEnvelope.release).toBe(patch.ampEnvelope.release);
    expect(nextPatch(calls.at(-1)).patch.synth.oscillators[0].waveform).toBe(patch.oscillators[0].waveform);
    // Slot 2 is untouched: a CC that re-voiced both oscillators would
    // collapse a two-oscillator patch into one sound on the first knob move.
    expect(patch.oscillators[1].waveform).toBe(slot2Before);

    updateSynthPatch.mockRestore();
  });
});

// A hardware fader sweep transmits CC byte-pairs synchronously, all in the
// same tick — before this fix, `applyCcMapping` wrote the store (and, for
// the synth-param branches, called `audioEngine.updateSynthPatch`) once per
// message, with no draft/preview stage at all. `applyCcMapping` now routes
// every branch's whole body through the module-level `ccFrames` coalescer
// (src/utils/frameCoalescer.ts), keyed on `mapping.targetKey`: the FIRST
// message for a target inside an animation-frame window still lands
// synchronously (a MIDI Learn assignment or a single nudge is never
// delayed), and only a REPEAT on the SAME target inside that window defers
// to the next frame and applies the LATEST value — mirroring
// store/beatPreview.ts's "repeated previews inside one frame apply only the
// latest params" test.
describe('MIDI CC coalesces repeated messages to the same target', () => {
  /** One frame of the coalescer's fallback scheduler (16 ms), with slack. */
  const FRAME_MS = 40;
  const nextFrame = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, FRAME_MS));

  // The file-wide `afterEach(__flushCcFramesForTests)` above settles anything left
  // armed after each test, so the leading-edge assumption below never
  // depends on run order.

  test('two messages to the SAME synth target in one tick reach the engine once immediately (leading value), then once more at frame rate (latest value)', async () => {
    const updateSynthPatch = spyOn(audioEngine, 'updateSynthPatch').mockClear();
    const input = connect('dev-cc-coalesce-cutoff');
    const synthCalls = () => updateSynthPatch.mock.calls.filter(([, , source]) => source === 'synth');

    input.onmidimessage?.({ data: [0xb0, 74, 40], target: input });
    input.onmidimessage?.({ data: [0xb0, 74, 100], target: input });

    // Before any animation frame runs: exactly ONE push has reached the
    // engine — the leading edge, computed from the FIRST message — not two.
    expect(synthCalls().length).toBe(1);
    const hzAfterFirst = Math.round(20 * Math.pow(1000, 40 / 127));
    expect(nextPatch(synthCalls().at(-1)).patch.synth.filter.cutoffHz).toBe(hzAfterFirst);

    await nextFrame();

    // The frame drains the deferred message: one more call, using the LAST
    // value (100/127), never the intermediate one that already landed.
    expect(synthCalls().length).toBe(2);
    const hzAfterSecond = Math.round(20 * Math.pow(1000, 100 / 127));
    expect(nextPatch(synthCalls().at(-1)).patch.synth.filter.cutoffHz).toBe(hzAfterSecond);
    expect(useAppStore.getState().synthParams.patch.synth.filter.cutoffHz).toBe(hzAfterSecond);

    updateSynthPatch.mockRestore();
  });

  test('two messages to the SAME masterVolume target in one tick commit the store once immediately (leading value), then once more at frame rate (latest value)', async () => {
    const input = connect('dev-cc-coalesce-master');

    input.onmidimessage?.({ data: [0xb0, 7, 32], target: input });
    input.onmidimessage?.({ data: [0xb0, 7, 127], target: input });

    // Before any animation frame runs: the store already reflects the FIRST
    // message, not the second — a synchronous burst commits once, not twice.
    expect(useAppStore.getState().masterVolume).toBeCloseTo(sliderPosTodB(32 / 127), 6);

    await nextFrame();

    // The frame commits the deferred message: the store now reflects the
    // LAST message (CC 127, the top of the taper: +12 dB).
    expect(useAppStore.getState().masterVolume).toBeCloseTo(12, 6);
  });

  test('two DIFFERENT synth targets moved in the same tick never block each other — both reach the engine immediately', () => {
    const updateSynthPatch = spyOn(audioEngine, 'updateSynthPatch').mockClear();
    const input = connect('dev-cc-coalesce-distinct-targets');

    input.onmidimessage?.({ data: [0xb0, 74, 64], target: input }); // filterCutoff
    input.onmidimessage?.({ data: [0xb0, 71, 64], target: input }); // filterResonance

    const synthCalls = updateSynthPatch.mock.calls.filter(([, , source]) => source === 'synth');
    expect(synthCalls.length).toBe(2);

    updateSynthPatch.mockRestore();
  });
});
