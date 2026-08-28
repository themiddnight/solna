import { Note } from 'tonal';
import { audioEngine } from '../audio/engine';
import { useAppStore } from './store';

let started = false;

// Applies one CC message through the enabled CC mapping for that number:
// writes the store, then pushes the same value into the engine so the change
// is audible immediately (engineSync fires only on a store VALUE change).
function applyCcMapping(ccNumber: number, ccValue: number): void {
  const s = useAppStore.getState();
  const mapping = s.midiMappings.find(
    (m) => m.enabled && m.type === 'cc' && m.ccNumber === ccNumber
  );
  if (!mapping) return;

  const normalized = ccValue / 127;
  if (mapping.targetKey === 'masterVolume') {
    s.setMasterVolume(normalized);
    audioEngine.setMasterVolume(normalized);
  } else if (mapping.targetKey === 'filterCutoff') {
    const hz = 20 * Math.pow(1000, normalized);
    const updated = { ...s.synthParams, filterCutoff: Math.round(hz) };
    s.setSynthParams(updated);
    audioEngine.updateSynthParams(updated, 'synth');
  } else if (mapping.targetKey === 'filterResonance') {
    const res = normalized * 20;
    const updated = { ...s.synthParams, filterResonance: Number(res.toFixed(1)) };
    s.setSynthParams(updated);
    audioEngine.updateSynthParams(updated, 'synth');
  } else if (mapping.targetKey === 'attack') {
    const atk = 0.001 + normalized * 1.999;
    const updated = { ...s.synthParams, attack: Number(atk.toFixed(3)) };
    s.setSynthParams(updated);
    audioEngine.updateSynthParams(updated, 'synth');
  } else if (mapping.targetKey === 'release') {
    const rel = 0.01 + normalized * 4.99;
    const updated = { ...s.synthParams, release: Number(rel.toFixed(3)) };
    s.setSynthParams(updated);
    audioEngine.updateSynthParams(updated, 'synth');
  } else if (mapping.targetKey === 'oscType') {
    const types = ['sine', 'triangle', 'sawtooth', 'square'] as const;
    const idx = Math.min(types.length - 1, Math.floor(normalized * types.length));
    const updated = { ...s.synthParams, oscType: types[idx] };
    s.setSynthParams(updated);
    audioEngine.updateSynthParams(updated, 'synth');
  }
}

// The MIDI listener lives on the store side of the engine bridge (layering
// rule 1 forbids src/audio/ from importing the store): the handler reads live
// MIDI state from the store (input selection, mappings, learn target) and
// writes back through store actions, while audio flows only through engine
// methods. Engine methods no-op before init(), so messages arriving ahead of
// the first user click are harmless.
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
            const noteName = Note.fromMidi(data1);
            if (!noteName) return;
            const params = s.synthParams;
            const velocity = data2;
            if (command === 0x90 && velocity > 0) {
              audioEngine.triggerSynthNoteOn(noteName, params, velocity / 127, undefined, 'synth', 1);
            } else {
              audioEngine.triggerSynthNoteOff(noteName, 0.3, undefined, 'synth');
            }
          }
        } else if (command === 0xB0) {
          applyCcMapping(data1, data2);
        }
      };

      const setupInputs = (acc: MIDIAccess) => {
        for (const input of acc.inputs.values()) {
          input.onmidimessage = handleMessage;
        }
      };

      setupInputs(access);
      access.onstatechange = () => {
        setupInputs(access);
      };
    })
    .catch((err) => {
      console.warn('[MIDI] access not available:', err);
    });
}
