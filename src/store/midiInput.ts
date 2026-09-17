import { midiToFlatName } from '@/musicCore';
import { createFrameCoalescer } from '@/utils/frameCoalescer';
import { audioEngine } from '../audio/engine';
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
  };
}

const heldNotes = createHeldNoteTracker();
let knownInputIds: string[] = [];

// A hardware fader sweep transmits CC byte-pairs at a rate comparable to or
// higher than a mouse drag, with no draft/preview stage of its own —
// `applyCcMapping` used to call a store setter (and, for the synth-patch
// branches, `audioEngine.updateSynthPatch` directly) on every single message.
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
// Every branch below routes its store write (and, for the synth-patch
// branches, its direct `audioEngine.updateSynthPatch` call) through
// `ccFrames.push(mapping.targetKey, ...)` rather than calling it unconditionally:
// the FIRST message for a target inside an animation-frame window still lands
// synchronously (a MIDI Learn assignment or a single nudge is never delayed),
// and only a REPEAT on the same target inside that window defers to the next
// frame, applying the latest value. `masterVolume` writes the store and STOPS
// there: engineSync subscribes to that exact field with `fireImmediately`, and
// this bridge is itself started from inside `startEngineSync`, so the
// subscription provably exists before any CC can arrive. Pushing
// `setMasterVolume(faderDbToGain(db))` here as well would duplicate the one
// dB->linear boundary — two call sites that must agree about the taper
// forever, for a value the subscription was already going to deliver on the
// same tick.

/**
 * Writes one CC-mapped control into the Lead patch and pushes the result to
 * the store AND straight to the engine.
 *
 * `edit` returns the new `SubtractiveParams`; the common block and the
 * provenance are carried through untouched, so a CC sweep can never widen
 * into a field it does not map. The previous patch goes to the engine beside
 * the next one, because `updateSynthPatch` diffs them to decide which
 * continuous controls actually moved.
 */
function writeLeadSynth(edit: (synth: SubtractiveParams) => SubtractiveParams): void {
  const s = useAppStore.getState();
  const previous = s.synthParams;
  const next: ActiveSynth<'subtractive'> = {
    ...previous,
    patch: { ...previous.patch, synth: edit(previous.patch.synth) },
  };
  s.setSynthParams(next);
  audioEngine.updateSynthPatch(previous, next, 'synth');
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
export function startMidiInputBridge(): void {
  if (started || typeof navigator === 'undefined' || !('requestMIDIAccess' in navigator)) {
    return;
  }
  started = true;

  (navigator as Navigator & { requestMIDIAccess?: () => Promise<MIDIAccess> })
    .requestMIDIAccess?.()
    .then((access) => {
      if (!access) return;

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

        // Check if MIDI Learn is active for CC
        const learnId = s.midiLearnTargetId;
        if (learnId && command === 0xB0) {
          const ccNum = data1;
          s.updateMidiMapping(learnId, { ccNumber: ccNum, type: 'cc' });
          s.setMidiLearnTargetId(null);
          return;
        }

        const mappings = s.midiMappings;

        if (command === 0x90 || command === 0x80) {
          const noteMapping = mappings.find((m) => m.enabled && m.type === 'note');
          if (noteMapping) {
            const noteName = midiToFlatName(data1);
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
          synthPlaybackNoteOff(voiceId, note, 0.05);
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
    })
    .catch((err) => {
      console.warn('[MIDI] access not available:', err);
    });
}
