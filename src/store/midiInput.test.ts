import { beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
import {
  resetNoteInputListeners,
  subscribeNoteInput,
  type NoteInputEvent,
} from '../audio/playback/noteInputBus';
import { computeDisconnectedInputIds, createHeldNoteTracker, startMidiInputBridge } from './midiInput';

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
  test('release returns every note currently on for that input and clears it', () => {
    const tracker = createHeldNoteTracker();
    tracker.noteOn('dev-1', 'C4');
    tracker.noteOn('dev-1', 'E4');
    tracker.noteOn('dev-2', 'G3');

    expect(tracker.release('dev-1').sort()).toEqual(['C4', 'E4']);
    expect(tracker.release('dev-1')).toEqual([]);
    expect(tracker.release('dev-2')).toEqual(['G3']);
  });

  test('noteOff removes a note before it would be released', () => {
    const tracker = createHeldNoteTracker();
    tracker.noteOn('dev-1', 'C4');
    tracker.noteOff('dev-1', 'C4');

    expect(tracker.release('dev-1')).toEqual([]);
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

describe('startMidiInputBridge releases held notes on disconnect (state flip — Chromium shape)', () => {
  test('a note held at disconnect is released', () => {
    const triggerSynthNoteOff = spyOn(audioEngine, 'triggerSynthNoteOff').mockClear();
    const input = connect('dev-a');
    noteOn(input, 60); // C4

    disconnectByStateFlip(input);

    expect(triggerSynthNoteOff.mock.calls.map((call) => call[0])).toEqual(['C4']);
    triggerSynthNoteOff.mockRestore();
  });

  test('several held notes are all released', () => {
    const triggerSynthNoteOff = spyOn(audioEngine, 'triggerSynthNoteOff').mockClear();
    const input = connect('dev-b');
    noteOn(input, 60); // C4
    noteOn(input, 64); // E4

    disconnectByStateFlip(input);

    expect(triggerSynthNoteOff.mock.calls.map((call) => call[0]).sort()).toEqual(['C4', 'E4']);
    triggerSynthNoteOff.mockRestore();
  });

  test('a disconnect with nothing held fires no release', () => {
    const triggerSynthNoteOff = spyOn(audioEngine, 'triggerSynthNoteOff').mockClear();
    const input = connect('dev-c');

    disconnectByStateFlip(input);

    expect(triggerSynthNoteOff).not.toHaveBeenCalled();
    triggerSynthNoteOff.mockRestore();
  });
});

describe('startMidiInputBridge releases held notes on disconnect (map removal fallback)', () => {
  test('a note held is released when the port is removed from the map instead of flipped', () => {
    const triggerSynthNoteOff = spyOn(audioEngine, 'triggerSynthNoteOff').mockClear();
    const input = connect('dev-d');
    noteOn(input, 67); // G4

    disconnectByRemoval(input);

    expect(triggerSynthNoteOff.mock.calls.map((call) => call[0])).toEqual(['G4']);
    triggerSynthNoteOff.mockRestore();
  });

  test('a device caught by both the state flip and the map removal is flushed once, not twice', () => {
    const triggerSynthNoteOff = spyOn(audioEngine, 'triggerSynthNoteOff').mockClear();
    const input = connect('dev-e');
    noteOn(input, 60); // C4

    // Some implementation could plausibly fire the event AND drop the map
    // entry for the same disconnect; both detection paths must agree on a
    // single flush.
    disconnectByStateFlip(input);
    access.inputs.delete(input.id);
    access.onstatechange?.({ port: input });

    expect(triggerSynthNoteOff.mock.calls.map((call) => call[0])).toEqual(['C4']);
    triggerSynthNoteOff.mockRestore();
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
