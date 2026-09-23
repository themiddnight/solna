import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
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
import { startEngineSync, stopEngineSync } from './engineSync';
import { sliderPosTodB } from '../utils/gainUnits';
import type { VoiceId } from '../audio/synth/voiceId';
import type { ActiveSynth } from '../types/synth';
import { noteFrequency } from '@/utils/musicTheory';
import { startMelodyRecordBridges } from './leadRecord';
import { LEAD_TICKS_PER_BAR } from '../utils/stepResolution';
import type { LeadNote } from '../audio/playback/leadMelody';

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

  test('releaseAll releases every held note across every input id and forgets them all', () => {
    const tracker = createHeldNoteTracker();
    tracker.noteOn('input-a', 'C4', 'voice-1' as VoiceId);
    tracker.noteOn('input-a', 'E4', 'voice-2' as VoiceId);
    tracker.noteOn('input-b', 'G4', 'voice-3' as VoiceId);

    const released = tracker.releaseAll();

    expect(released.map((h) => h.note).sort()).toEqual(['C4', 'E4', 'G4']);
    // Forgotten: a second call finds nothing left to release.
    expect(tracker.releaseAll()).toEqual([]);
  });

  test('releaseAll on an empty tracker returns an empty array', () => {
    const tracker = createHeldNoteTracker();
    expect(tracker.releaseAll()).toEqual([]);
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

// Bun's test runtime provides `navigator` (used above for MIDI) but no
// `window`/`document` at all — this repo ships no jsdom/happy-dom. The
// blur/visibilitychange backstop is guarded on both being defined, so these
// hand-built EventTargets stand in for them, installed as real globals below
// BEFORE startMidiInputBridge() runs so its guard sees them.
class FakeEventTarget {
  private listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, handler: () => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler);
  }
  removeEventListener(type: string, handler: () => void): void {
    this.listeners.get(type)?.delete(handler);
  }
  dispatch(type: string): void {
    this.listeners.get(type)?.forEach((handler) => handler());
  }
}

class FakeDocument extends FakeEventTarget {
  hidden = false;
}

const fakeWindow = new FakeEventTarget();
const fakeDocument = new FakeDocument();

// Captured so the real values (or lack of them) can be restored in afterAll —
// other test files sharing this Bun process must not see this file's fakes.
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

beforeAll(async () => {
  // `configurable: true` because other test files in this same Bun process
  // (store.test.ts, projectBoot.test.ts, ...) may have already defined
  // `window` as a non-writable alias for `globalThis`; a plain assignment
  // would throw "Attempted to assign to readonly property" depending on
  // which file ran first, so this redefines the property outright instead.
  Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: fakeDocument, configurable: true });
  (navigator as unknown as { requestMIDIAccess: () => Promise<FakeMidiAccess> }).requestMIDIAccess = () =>
    Promise.resolve(access);
  startMidiInputBridge();
  // requestMIDIAccess().then(...) resolves on a microtask; give it a turn
  // of the loop before any test touches `access`.
  await Promise.resolve();
  await Promise.resolve();
});

afterAll(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete (globalThis as { window?: unknown }).window;
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else delete (globalThis as { document?: unknown }).document;
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

describe('startMidiInputBridge releases held notes on tab blur / visibilitychange', () => {
  test('window blur releases every held note across every input, by the voice it started', () => {
    const spies = spyNotePair();
    const inputA = connect('dev-blur-a');
    const inputB = connect('dev-blur-b');
    noteOn(inputA, 60); // C4
    noteOn(inputB, 64); // E4

    fakeWindow.dispatch('blur');

    expect(spies.releasedFrequencies().sort((a, b) => a - b)).toEqual(
      ['C4', 'E4'].map((n) => noteFrequency(n)).sort((a, b) => a - b),
    );
    spies.restore();
  });

  test('a blur with nothing held fires no release', () => {
    const spies = spyNotePair();

    fakeWindow.dispatch('blur');

    expect(spies.off).not.toHaveBeenCalled();
    spies.restore();
  });

  test('visibilitychange releases held notes only when the document is hidden', () => {
    const spies = spyNotePair();
    const input = connect('dev-visibility');
    noteOn(input, 60); // C4

    fakeDocument.hidden = false;
    fakeDocument.dispatch('visibilitychange');
    expect(spies.off).not.toHaveBeenCalled();

    fakeDocument.hidden = true;
    fakeDocument.dispatch('visibilitychange');
    expect(spies.releasedFrequencies()).toEqual(['C4'].map((n) => noteFrequency(n)));

    fakeDocument.hidden = false;
    spies.restore();
  });

  test('a note held on one input survives a disconnect flush of a different, unrelated input', () => {
    // Proves the two backstops (per-input disconnect flush vs. cross-input
    // blur/visibilitychange release) don't interfere with each other: flushing
    // one input's notes must never reach into another input's held set.
    const spies = spyNotePair();
    const stillHeld = connect('dev-coexist-held');
    const disconnecting = connect('dev-coexist-gone');
    noteOn(stillHeld, 60); // C4
    noteOn(disconnecting, 64); // E4

    disconnectByStateFlip(disconnecting);
    expect(spies.releasedFrequencies()).toEqual(['E4'].map((n) => noteFrequency(n)));

    fakeWindow.dispatch('blur');
    expect(spies.releasedFrequencies().sort((a, b) => a - b)).toEqual(
      ['E4', 'C4'].map((n) => noteFrequency(n)).sort((a, b) => a - b),
    );
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

describe('suspended note input drops MIDI note-on and CC (R336)', () => {
  afterEach(() => { useAppStore.setState({ noteInputSuspended: false }); });

  test('a note-on is dropped: no voice, no bus event', () => {
    const spy = spyNotePair();
    const events: NoteInputEvent[] = [];
    subscribeNoteInput((e) => events.push(e));
    const input = connect('dev-suspend-on');
    useAppStore.getState().setNoteInputSuspended(true);
    noteOn(input, 60);
    expect(spy.on).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    resetNoteInputListeners();
    spy.restore();
  });

  test('a note-off still passes, so a key held across the open releases', () => {
    const spy = spyNotePair();
    const input = connect('dev-suspend-off');
    noteOn(input, 60);
    useAppStore.getState().setNoteInputSuspended(true);
    input.onmidimessage?.({ data: [0x80, 60, 0], target: input });
    expect(spy.releasedFrequencies()).toEqual([noteFrequency('C4')]);
    spy.restore();
  });

  test('a CC is dropped: the mapped parameter does not move', () => {
    useAppStore.setState({ masterVolume: 0 });
    const input = connect('dev-suspend-cc');
    useAppStore.getState().setNoteInputSuspended(true);
    input.onmidimessage?.({ data: [0xb0, 7, 127], target: input }); // would be +12 dB
    __flushCcFramesForTests();
    expect(useAppStore.getState().masterVolume).toBe(0);
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

// Like masterVolume, the five synth-param branches (filterCutoff,
// filterResonance, attack, release, oscType) write the store and stop there:
// engineSync's patch subscription is what pushes a patch to the engine, and
// its frame coalescer is leading-edge, so the edit still reaches the engine on
// the same tick (proven by 'a CC edit reaches the engine exactly once' below).
// engineSync is not started here, so these tests also pin that the bridge
// makes no engine call of its own.
describe('MIDI CC writes the five synth-param branches into the Lead patch', () => {
  test('filterCutoff (CC 74) computes Hz from the CC value and writes it to the store', () => {
    const updateSynthPatch = spyOn(audioEngine, 'updateSynthPatch').mockClear();
    const input = connect('dev-cc-filter-cutoff');

    input.onmidimessage?.({ data: [0xb0, 74, 64], target: input });

    const expectedHz = Math.round(20 * Math.pow(1000, 64 / 127));
    expect(useAppStore.getState().synthParams.patch.synth.filter.cutoffHz).toBe(expectedHz);
    expect(updateSynthPatch).not.toHaveBeenCalled();

    updateSynthPatch.mockRestore();
  });

  test('filterResonance (CC 71), attack (CC 73), release (CC 72) and oscType (CC 16) all write the store too', () => {
    const updateSynthPatch = spyOn(audioEngine, 'updateSynthPatch').mockClear();
    const input = connect('dev-cc-other-synth-targets');
    const before = useAppStore.getState().synthParams.patch.synth;

    input.onmidimessage?.({ data: [0xb0, 71, 64], target: input });
    input.onmidimessage?.({ data: [0xb0, 73, 64], target: input });
    input.onmidimessage?.({ data: [0xb0, 72, 64], target: input });
    input.onmidimessage?.({ data: [0xb0, 16, 64], target: input });

    const patch = useAppStore.getState().synthParams.patch.synth;
    const n = 64 / 127;
    expect(patch.filter.resonance).toBe(Number(n.toFixed(3)));
    expect(patch.ampEnvelope.attack).toBe(Number((0.001 + n * 1.999).toFixed(3)));
    expect(patch.ampEnvelope.release).toBe(Number((0.01 + n * 4.99).toFixed(3)));
    expect(patch.oscillators[0].waveform).toBe('sawtooth');
    // Slot 2 is untouched: a CC that re-voiced both oscillators would
    // collapse a two-oscillator patch into one sound on the first knob move.
    expect(patch.oscillators[1].waveform).toBe(before.oscillators[1].waveform);
    expect(updateSynthPatch).not.toHaveBeenCalled();

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

  test('two messages to the SAME synth target in one tick commit the Lead patch once immediately (leading value), then once more at frame rate (latest value)', async () => {
    const commits: number[] = [];
    const unsub = useAppStore.subscribe(
      (st) => st.synthParams,
      (synth) => commits.push(synth.patch.synth.filter.cutoffHz),
    );
    const input = connect('dev-cc-coalesce-cutoff');

    input.onmidimessage?.({ data: [0xb0, 74, 40], target: input });
    input.onmidimessage?.({ data: [0xb0, 74, 100], target: input });

    // Before any animation frame runs: exactly ONE commit — the leading edge,
    // computed from the FIRST message — not two.
    const hzAfterFirst = Math.round(20 * Math.pow(1000, 40 / 127));
    expect(commits).toEqual([hzAfterFirst]);

    await nextFrame();

    // The frame drains the deferred message: one more commit, using the LAST
    // value (100/127), never the intermediate one that already landed.
    const hzAfterSecond = Math.round(20 * Math.pow(1000, 100 / 127));
    expect(commits).toEqual([hzAfterFirst, hzAfterSecond]);
    unsub();
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

  test('two DIFFERENT synth targets moved in the same tick never block each other — both commit immediately', () => {
    let commits = 0;
    const unsub = useAppStore.subscribe(
      (st) => st.synthParams,
      () => { commits += 1; },
    );
    const input = connect('dev-cc-coalesce-distinct-targets');

    input.onmidimessage?.({ data: [0xb0, 74, 64], target: input }); // filterCutoff
    input.onmidimessage?.({ data: [0xb0, 71, 64], target: input }); // filterResonance

    expect(commits).toBe(2);
    unsub();
  });
});

describe('a MIDI-recorded black key is stored sharp-spelled (ROOTS identity)', () => {
  test('MIDI 61 records as C#4 in leadMelodySteps, never Db4', () => {
    const prev = useAppStore.getState();
    useAppStore.setState({
      meterId: '4/4',
      leadMelodySteps: Array.from({ length: LEAD_TICKS_PER_BAR }, () => [] as LeadNote[]),
      leadLoopLength: 1,
      leadMelodyView: 'chromatic',
      leadMelodyOctave: 3,
      leadCursor: 0,
      recordingTrack: 'lead',
      leadPlayer: 'stopped', chordsPlayer: 'stopped', sequencerPlayer: 'stopped', fxPlayer: 'stopped',
      metronomeActive: false,
    });
    const stop = startMelodyRecordBridges({ inputStep: () => null, startClock: () => () => {} });
    const input = connect('dev-record-sharp');

    noteOn(input, 61);
    input.onmidimessage?.({ data: [0x80, 61, 0], target: input });

    const stored = useAppStore.getState().leadMelodySteps.flat().map((n) => n.note);
    expect(stored).toEqual(['C#4']);
    stop();
    resetNoteInputListeners();
    useAppStore.setState({
      recordingTrack: null,
      leadMelodySteps: prev.leadMelodySteps,
      leadMelodyOctave: prev.leadMelodyOctave,
      leadCursor: prev.leadCursor,
    });
  });

  test('the note-input bus announces the sharp name too', () => {
    const events: NoteInputEvent[] = [];
    subscribeNoteInput((e) => events.push(e));
    const input = connect('dev-bus-sharp');
    noteOn(input, 70); // A#4 / Bb4
    expect(events[0]?.note).toBe('A#4');
    resetNoteInputListeners();
  });
});

describe('a CC edit reaches the engine exactly once, through engineSync', () => {
  test('filterCutoff (CC 74): one updateSynthPatch for synth, same tick', () => {
    startEngineSync();
    __flushCcFramesForTests();
    const updateSynthPatch = spyOn(audioEngine, 'updateSynthPatch').mockImplementation(() => {});
    const input = connect('dev-cc-single-path');

    input.onmidimessage?.({ data: [0xb0, 74, 64], target: input });

    const calls = updateSynthPatch.mock.calls.filter(([, , source]) => source === 'synth');
    expect(calls).toHaveLength(1);
    expect(nextPatch(calls[0]).patch.synth.filter.cutoffHz).toBe(Math.round(20 * Math.pow(1000, 64 / 127)));
    updateSynthPatch.mockRestore();
    stopEngineSync();
  });
});
