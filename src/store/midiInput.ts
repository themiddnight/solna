import { midiToSharpName } from '@/musicCore';
import { createFrameCoalescer } from '@/utils/frameCoalescer';
import type { VoiceId } from '../audio/synth/voiceId';
import type { ActiveSynth, SubtractiveParams } from '../types/synth';
import { synthPlaybackNoteOff, synthPlaybackNoteOn } from '../audio/playback/synthPlayback';
import { useAppStore } from './store';
// A MIDI CC is a fader position (0..127 normalised to 0..1), not a dB ramp:
// it must land on the SAME taper VolumeFader draws, or the two controls for
// one value disagree about what "half" means. sliderPosTodB is the fader's
// own exported inverse for exactly that reason; the ban on calling it
// elsewhere is about reimplementing the taper, not about this one
// legitimate second caller.
// eslint-disable-next-line no-restricted-imports
import { sliderPosTodB } from '../utils/gainUnits';

let started = false;

// Shared by both places a MIDI-held note is released without a real note-off
// message: a device disconnect (flushInputNotes) and the tab-blur/
// visibilitychange backstop below. One constant keeps a stranded voice's
// fade identical whichever path caught it.
const MIDI_RELEASE_SEC = 0.05;

// Diffs two id lists and returns the ones that dropped out. Pure so the
// device-disconnect trigger below is unit-testable without a real
// MIDIAccess object.
export function computeDisconnectedInputIds(
  previousIds: readonly string[],
  currentIds: readonly string[],
): string[] {
  const current = new Set(currentIds);
  return previousIds.filter((id) => !current.has(id));
}

/** A note a device is still holding, and the voice it started. */
export interface HeldMidiNote {
  note: string;
  voiceId: VoiceId | null;
}

// Tracks which notes are currently on, per input device id, so a device
// that disappears mid-note (unplugged, put to sleep, a USB hub dropping
// out) can have its stuck notes released even though its note-off will
// never arrive.
//
// Keyed by note name and VALUED by the voice that note started: the flush
// below has to release those exact voices, and the MIDI bus is the lead
// bus, shared with the on-screen keyboard, the arp and the melody grid.
export function createHeldNoteTracker() {
  const notesByInput = new Map<string, Map<string, VoiceId | null>>();
  return {
    noteOn(inputId: string, note: string, voiceId: VoiceId | null): void {
      let notes = notesByInput.get(inputId);
      if (!notes) {
        notes = new Map();
        notesByInput.set(inputId, notes);
      }
      notes.set(note, voiceId);
    },
    /** The voice this note started, and forgets it. `null` if it was never tracked. */
    noteOff(inputId: string, note: string): VoiceId | null {
      const notes = notesByInput.get(inputId);
      const voiceId = notes?.get(note) ?? null;
      notes?.delete(note);
      return voiceId;
    },
    release(inputId: string): HeldMidiNote[] {
      const notes = notesByInput.get(inputId);
      if (!notes) return [];
      const held = Array.from(notes, ([note, voiceId]) => ({ note, voiceId }));
      notesByInput.delete(inputId);
      return held;
    },
    /** Every held note across every tracked input, forgetting all of them. Used
     * by the window-blur/visibilitychange backstop, which has no single
     * input id to target. */
    releaseAll(): HeldMidiNote[] {
      const held: HeldMidiNote[] = [];
      for (const notes of notesByInput.values()) {
        for (const [note, voiceId] of notes) held.push({ note, voiceId });
      }
      notesByInput.clear();
      return held;
    },
  };
}

const heldNotes = createHeldNoteTracker();
let knownInputIds: string[] = [];

// A hardware fader sweep transmits CC byte-pairs at a rate comparable to or
// higher than a mouse drag, with no draft/preview stage of its own —
// `applyCcMapping` used to call a store setter on every single message.
// `midiInput.ts` is a plain store/event-bridge module with no component
// tree, so Task 4's `useSynthPatchDraft` (a React hook) does not apply here;
// `store/beatPreview.ts`'s module-level `createFrameCoalescer` is the actual
// prior art for "preview immediately, coalesce repeats to one per animation
// frame" outside a component. Keyed per `targetKey` (see `ccFrames` uses
// below), so two different CC targets moved in the same frame — a hardware
// controller with two faders bound to `filterCutoff` and `masterVolume` — each
// still get their own immediate-then-coalesced push; only repeated messages to
// the SAME target within one frame collapse to the latest value.
const ccFrames = createFrameCoalescer();

/**
 * Test-only escape hatch: applies whatever `ccFrames` is still holding and
 * cancels its armed frame, synchronously. `ccFrames` is module-scope and
 * therefore shared across every test in the same process — without this, a
 * CC test that pushes to the same `targetKey` as a test that ran moments
 * earlier can land inside that earlier test's still-armed real-timer window
 * (the coalescer falls back to a bare `setTimeout` outside a browser) and get
 * silently deferred instead of applied immediately, flipping "leading edge"
 * assertions for reasons that have nothing to do with the test itself. No
 * production caller needs this: the app never tears down `ccFrames`.
 */
export function __flushCcFramesForTests(): void {
  ccFrames.flush();
}

// Applies one CC message through the enabled CC mapping for that number.
//
// Every branch below routes its store write through
// `ccFrames.push(mapping.targetKey, ...)` rather than calling it unconditionally:
// the FIRST message for a target inside an animation-frame window still lands
// synchronously (a MIDI Learn assignment or a single nudge is never delayed),
// and only a REPEAT on the same target inside that window defers to the next
// frame, applying the latest value. Every branch — the synth-patch ones and
// `masterVolume` alike — writes the store and STOPS there: engineSync
// subscribes to each of those fields with `fireImmediately`, and this bridge is
// itself started from inside `startEngineSync`, so the subscription provably
// exists before any CC can arrive. Pushing `setMasterVolume(faderDbToGain(db))`
// here as well would duplicate the one dB->linear boundary — two call sites
// that must agree about the taper forever, for a value the subscription was
// already going to deliver on the same tick; a direct `updateSynthPatch` would
// likewise push every synth edit to the engine twice.

/**
 * Writes one CC-mapped control into the Lead patch. The store write is the
 * whole job: engineSync's patch subscription pushes it to the engine on the
 * same tick (its frame coalescer is leading-edge), diffing against what it
 * last APPLIED.
 *
 * `edit` returns the new `SubtractiveParams`; the common block and the
 * provenance are carried through untouched, so a CC sweep can never widen
 * into a field it does not map.
 */
function writeLeadSynth(edit: (synth: SubtractiveParams) => SubtractiveParams): void {
  const s = useAppStore.getState();
  const previous = s.synthParams;
  const next: ActiveSynth<'subtractive'> = {
    ...previous,
    patch: { ...previous.patch, synth: edit(previous.patch.synth) },
  };
  s.setSynthParams(next);
}

function applyCcMapping(ccNumber: number, ccValue: number): void {
  const s = useAppStore.getState();
  const mapping = s.midiMappings.find(
    (m) => m.enabled && m.type === 'cc' && m.ccNumber === ccNumber
  );
  if (!mapping) return;

  const normalized = ccValue / 127;
  if (mapping.targetKey === 'masterVolume') {
    // Onto the FADER TAPER, not a linear dB ramp: a CC knob at its midpoint
    // must land where the on-screen fader's midpoint lands, or the two
    // controls for one value disagree about what "half" means. CC 0 is the
    // bottom of the taper, which is silence — the same silence the fader's
    // bottom detent gives, because both go through faderDbToGain.
    ccFrames.push('masterVolume', () => s.setMasterVolume(sliderPosTodB(normalized)));
  } else if (mapping.targetKey === 'filterCutoff') {
    const hz = 20 * Math.pow(1000, normalized);
    ccFrames.push('filterCutoff', () =>
      writeLeadSynth((synth) => ({ ...synth, filter: { ...synth.filter, cutoffHz: Math.round(hz) } })));
  } else if (mapping.targetKey === 'filterResonance') {
    // The whole CC range onto the whole knob range. Resonance is a unitless
    // 0..1 synth control now, not the `Q` the biquad adapter maps it onto, so
    // the old `normalized * 20` would have pinned every CC above 1/20 of
    // travel to maximum.
    ccFrames.push('filterResonance', () =>
      writeLeadSynth((synth) => ({
        ...synth,
        filter: { ...synth.filter, resonance: Number(normalized.toFixed(3)) },
      })));
  } else if (mapping.targetKey === 'attack') {
    const atk = 0.001 + normalized * 1.999;
    ccFrames.push('attack', () =>
      writeLeadSynth((synth) => ({
        ...synth,
        ampEnvelope: { ...synth.ampEnvelope, attack: Number(atk.toFixed(3)) },
      })));
  } else if (mapping.targetKey === 'release') {
    const rel = 0.01 + normalized * 4.99;
    ccFrames.push('release', () =>
      writeLeadSynth((synth) => ({
        ...synth,
        ampEnvelope: { ...synth.ampEnvelope, release: Number(rel.toFixed(3)) },
      })));
  } else if (mapping.targetKey === 'oscType') {
    const types = ['sine', 'triangle', 'sawtooth', 'square'] as const;
    const idx = Math.min(types.length - 1, Math.floor(normalized * types.length));
    // Slot 1 only. A CC that re-voiced both oscillators would collapse the
    // two-oscillator patch into one sound on the first knob move.
    ccFrames.push('oscType', () =>
      writeLeadSynth((synth) => ({
        ...synth,
        oscillators: [{ ...synth.oscillators[0], waveform: types[idx] }, synth.oscillators[1]],
      })));
  }
}

/**
 * Calls `connect` if MIDI permission is already granted, and again whenever it
 * becomes granted later (site settings, or the prompt MIDI settings raised);
 * never prompts itself (R350). Resolves the state it read — `'unknown'` when
 * the Permissions API cannot answer for `midi`, which connects nothing: the
 * first MIDI settings open asks instead.
 */
export async function connectWhenMidiGranted(
  permissions: Pick<Permissions, 'query'> | undefined,
  connect: () => void,
): Promise<PermissionState | 'unknown'> {
  if (!permissions) return 'unknown';
  let status: PermissionStatus;
  try {
    status = await permissions.query({ name: 'midi' });
  } catch {
    return 'unknown';
  }
  if (status.state === 'granted') connect();
  status.addEventListener('change', () => {
    if (status.state === 'granted') connect();
  });
  return status.state;
}

/**
 * One `requestMIDIAccess()` for however many callers ask: the first call
 * requests and hands a granted access to `onAccess` once; later calls share
 * the same promise. A rejected request (prompt dismissed or denied) is
 * forgotten, so the next MIDI settings open asks again.
 */
export function createMidiAccessRequester(
  request: () => Promise<MIDIAccess>,
  onAccess: (access: MIDIAccess) => void,
): () => Promise<MIDIAccess> {
  let pending: Promise<MIDIAccess> | null = null;
  return () => {
    if (!pending) {
      const attempt = request();
      pending = attempt;
      attempt.then(onAccess, (err: unknown) => {
        if (pending === attempt) pending = null;
        console.warn('[MIDI] access not available:', err);
      });
    }
    return pending;
  };
}

type MidiNavigator = Navigator & { requestMIDIAccess?: (options?: MIDIOptions) => Promise<MIDIAccess> };

let requester: (() => Promise<MIDIAccess>) | null = null;

/**
 * The session's one MIDIAccess, shared by the input bridge and the MIDI
 * settings device list (R350); `null` where the browser has no Web MIDI.
 * Calling it may raise the browser's permission prompt, so only the MIDI
 * settings open and an already-granted permission call it.
 *
 * Chrome logs a "Deprecated feature used" issue (NoSysexWebMIDIWithoutPermission:
 * "Web MIDI will ask a permission to use even if the sysex is not specified")
 * on the first request, and it cannot be silenced from here: Blink reports it,
 * once per page, for any secure-context requestMIDIAccess() without
 * `sysex: true`, even when permission is already granted (navigator_web_midi.cc,
 * crbug.com/1420307). The only way out is `{ sysex: true }`, which asks for the
 * stronger "control and reprogram your MIDI devices" permission — Solna reads
 * notes and CCs only, so it keeps the plain request and accepts the notice.
 * A visitor who never grants MIDI never makes the request, so never sees it.
 */
export function requestMidiAccess(): Promise<MIDIAccess> | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as MidiNavigator;
  const request = nav.requestMIDIAccess;
  if (!request) return null;
  requester ??= createMidiAccessRequester(() => request.call(nav), connectMidiInputs);
  return requester();
}

// The MIDI listener lives on the store side of the engine bridge (layering
// rule 1 forbids src/audio/ from importing the store): the handler reads live
// MIDI state from the store (input selection, mappings, learn target) and
// writes back through store actions, while audio flows only through the
// playback wrappers. Notes go through synthPlaybackNoteOn/Off rather than
// audioEngine directly: that wrapper is where a performed note is announced
// on the note-input bus, so a device that skipped it would be audible but
// invisible to anything watching for played notes. Engine methods no-op
// before init(), so messages arriving ahead of the first user click are
// harmless.
//
// Started once with the engine sync, it never prompts (R350): it connects at
// load only when MIDI permission is already granted. Otherwise the first MIDI
// settings open asks, through the same requestMidiAccess(), and a grant lands
// here.
export function startMidiInputBridge(): void {
  if (started || typeof navigator === 'undefined' || !('requestMIDIAccess' in navigator)) {
    return;
  }
  started = true;
  void connectWhenMidiGranted(navigator.permissions, () => {
    void requestMidiAccess();
  });
}

// Wires a granted access: every input's messages, the held-note flushes and
// the device-change handler. Runs once per session — requestMidiAccess()
// resolves at most one access.
function connectMidiInputs(access: MIDIAccess): void {
  // eslint-disable-next-line complexity -- one MIDI message dispatcher: status-byte branches for note/CC/learn, now plus the R336 suspension gate; splitting would scatter one message's decode
  const handleMessage = (event: MIDIMessageEvent) => {
    const data = event.data;
    if (!data || data.length < 3) return;
    const s = useAppStore.getState();
    const selectedId = s.selectedMidiInputId;
    const sourceInput = event.target as MIDIInput | null;
    if (selectedId && selectedId !== 'all' && sourceInput && sourceInput.id !== selectedId) {
      return;
    }
    s.triggerMidiActivity();
    const status = data[0];
    const command = status & 0xF0;
    const data1 = data[1];
    const data2 = data[2];

    // R336: while the vibe picker previews, a note-on would play over the
    // audition and a CC would edit state Cancel is about to wipe. A
    // note-off still passes, so a key held across the open releases.
    if (s.noteInputSuspended && (command === 0xB0 || (command === 0x90 && data2 > 0))) return;

    // Check if MIDI Learn is active for CC
    const learnId = s.midiLearnTargetId;
    if (learnId && command === 0xB0) {
      const ccNum = data1;
      s.updateMidiMapping(learnId, { ccNumber: ccNum, type: 'cc' });
      s.setMidiLearnTargetId(null);
      return;
    }

    const mappings = s.midiMappings;

    // Sharp-spelled: this name becomes a stored lead note when Rec is armed, and persisted names are ROOTS-spelled.
    if (command === 0x90 || command === 0x80) {
      const noteMapping = mappings.find((m) => m.enabled && m.type === 'note');
      if (noteMapping) {
        const noteName = midiToSharpName(data1);
        if (!noteName) return;
        const synth = s.synthParams;
        const velocity = data2;
        const inputId = sourceInput?.id ?? '';
        if (command === 0x90 && velocity > 0) {
          heldNotes.noteOn(
            inputId,
            noteName,
            synthPlaybackNoteOn(noteName, synth, velocity / 127, undefined, 'synth'),
          );
        } else {
          synthPlaybackNoteOff(heldNotes.noteOff(inputId, noteName), noteName, 0.3);
        }
      }
    } else if (command === 0xB0) {
      applyCcMapping(data1, data2);
    }
  };

  const flushInputNotes = (inputId: string): void => {
    heldNotes.release(inputId).forEach(({ note, voiceId }) => {
      synthPlaybackNoteOff(voiceId, note, MIDI_RELEASE_SEC);
    });
  };

  const setupInputs = (acc: MIDIAccess) => {
    const currentIds: string[] = [];
    for (const input of acc.inputs.values()) {
      input.onmidimessage = handleMessage;
      currentIds.push(input.id);
    }
    // Defense in depth only: an id missing from the fresh enumeration
    // means an implementation that drops disconnected ports from the map
    // (the spec's "should not appear" text is non-normative, so this is
    // permitted but not guaranteed). Chromium does not do this — it
    // keeps the port and only flips its `state` — so the statechange
    // handler below is the detection path that actually fires there.
    // `heldNotes.release` empties an input's set on first call, so a
    // device caught by both paths is flushed once, not twice.
    for (const goneId of computeDisconnectedInputIds(knownInputIds, currentIds)) {
      flushInputNotes(goneId);
    }
    knownInputIds = currentIds;
  };

  setupInputs(access);

  // A held physical MIDI key is released only by a real 0x80 message or
  // the disconnect flush above — neither fires on a tab freeze, aggressive
  // background-tab throttling, or OS sleep, so a note can drone until the
  // same note or a project reload clears it. useInputDeck's
  // useHeldNoteRelease backstops the computer-keyboard/on-screen-keyboard
  // input the same way for the same reason; this mirrors it for the
  // separate `heldNotes` tracker MIDI uses. `window`/`document` are
  // guarded because this module runs under Bun's test runtime, which has
  // neither.
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const releaseAllHeldMidiNotes = () => {
      heldNotes.releaseAll().forEach(({ note, voiceId }) => {
        synthPlaybackNoteOff(voiceId, note, MIDI_RELEASE_SEC);
      });
    };
    window.addEventListener('blur', releaseAllHeldMidiNotes);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) releaseAllHeldMidiNotes();
    });
  }

  access.onstatechange = (event) => {
    // A reused port id must keep resolving to the same MIDIPort across
    // connect/disconnect (WebAudio/web-midi-api#79), so Chromium never
    // erases a disconnected input from `acc.inputs` — it only sets
    // `port.state`. That leaves the map diff in setupInputs() unable to
    // ever see this case; the event's own port is the only place a
    // disconnect is observable there.
    const port = event.port;
    if (port && port.type === 'input' && port.state === 'disconnected') {
      flushInputNotes(port.id);
    }
    setupInputs(access);
  };
}
