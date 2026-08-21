/* eslint-disable @typescript-eslint/naming-convention */
import { Frequency } from "tone";

export type ArpMode = "up" | "down" | "upDown" | "downUp" | "random";

interface ArpConfig {
  triggerNote: (note: string) => void;
  releaseNote: (note: string) => void;
  getBPM: () => number;
}

export class Arpeggiator {
  // Public fields (declared before private fields per member-ordering)
  isRunning: boolean = false;
  enabled: boolean = false;
  mode: ArpMode = "up";
  subdivision: string = "8n";
  octaveRange: number = 1;
  gate: number = 0.5;
  latch: boolean = false;

  private heldNotes: string[] = [];
  private latchedNotes: string[] = [];
  private currentIndex: number = 0;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private gateTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private scheduledTimeouts: ReturnType<typeof setTimeout>[] = [];
  private lastPlayedNote: string | null = null;
  private readonly config: ArpConfig;

  constructor(config: ArpConfig) {
    this.config = config;
  }

  noteOn(note: string): void {
    if (!this.enabled) return;

    // Latch: if all keys were released and a new key comes in, replace the pattern
    const wasEmpty = this.heldNotes.length === 0;

    if (!this.heldNotes.includes(note)) {
      this.heldNotes.push(note);
      this.heldNotes.sort((a, b) => {
        const midiA = Frequency(a).toMidi();
        const midiB = Frequency(b).toMidi();
        return midiA - midiB;
      });
    }

    if (this.latch) {
      if (wasEmpty) {
        // New chord started — clear old latched pattern and begin fresh
        this.latchedNotes = [note];
        this.currentIndex = 0;
      } else if (!this.latchedNotes.includes(note)) {
        // Additional note within the same chord — add to pattern
        this.latchedNotes.push(note);
        this.latchedNotes.sort((a, b) => {
          const midiA = Frequency(a).toMidi();
          const midiB = Frequency(b).toMidi();
          return midiA - midiB;
        });
      }
    }

    if (!this.isRunning) {
      this.start();
    }
  }

  noteOff(note: string): void {
    if (!this.enabled) return;

    // Always track physical key state
    this.heldNotes = this.heldNotes.filter((n) => n !== note);

    // When latch is OFF, stop if no keys held
    if (!this.latch && this.heldNotes.length === 0) {
      this.stop();
    }
    // When latch is ON, latchedNotes keeps the pattern alive — don't stop
  }

  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    if (this.gateTimeoutId) {
      clearTimeout(this.gateTimeoutId);
      this.gateTimeoutId = null;
    }

    // Clear all pending scheduled timeouts to prevent memory leaks
    this.scheduledTimeouts.forEach(t => clearTimeout(t));
    this.scheduledTimeouts = [];

    if (this.lastPlayedNote) {
      this.config.releaseNote(this.lastPlayedNote);
      this.lastPlayedNote = null;
    }

    this.currentIndex = 0;
  }

  /**
   * Unconditional "all notes off": stops the pattern and forgets both the physically held
   * notes and the latched ones.
   *
   * `noteOff` deliberately keeps playing while latch is on — that is what latch is for — and
   * `stop` leaves the note lists intact so a later `noteOn` can resume. Neither is right when
   * the thing driving the arpeggiator has gone away (the transport stopped, the synth chain is
   * about to be torn down and rebuilt). In those cases the pattern has to end regardless of
   * latch, and must not come back on the next key.
   */
  releaseAll(): void {
    this.stop();
    this.heldNotes = [];
    this.latchedNotes = [];
  }

  onBPMChanged(_bpm: number): void {
    if (!this.isRunning) return;

    // Clear all pending scheduled timeouts before rescheduling with new BPM
    this.scheduledTimeouts.forEach(t => clearTimeout(t));
    this.scheduledTimeouts = [];

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    if (this.gateTimeoutId) {
      clearTimeout(this.gateTimeoutId);
      this.gateTimeoutId = null;
    }

    this.tick();
  }

  updateParams(params: {
    enabled?: boolean;
    mode?: ArpMode;
    subdivision?: string;
    octaveRange?: number;
    gate?: number;
    latch?: boolean;
  }): void {
    if (params.enabled !== undefined) {
      const wasEnabled = this.enabled;
      this.enabled = params.enabled;

      if (!this.enabled && wasEnabled) {
        this.stop();
        this.heldNotes = [];
        this.latchedNotes = [];
      }
    }

    if (params.mode !== undefined) {
      this.mode = params.mode;
      this.currentIndex = 0;
    }

    if (params.subdivision !== undefined) {
      this.subdivision = params.subdivision;
    }

    if (params.octaveRange !== undefined) {
      this.octaveRange = params.octaveRange;
      this.currentIndex = 0;
    }

    if (params.gate !== undefined) {
      this.gate = Math.max(0.05, Math.min(1.0, params.gate));
    }

    if (params.latch !== undefined) {
      const wasLatch = this.latch;
      this.latch = params.latch;

      if (this.latch && !wasLatch) {
        this.latchedNotes = [...this.heldNotes];
      } else if (!this.latch && wasLatch) {
        this.latchedNotes = [];
        if (this.heldNotes.length === 0) {
          this.stop();
        }
      }
    }
  }

  dispose(): void {
    this.stop();
    // Ensure all pending timeouts are cleared
    this.scheduledTimeouts.forEach(t => clearTimeout(t));
    this.scheduledTimeouts = [];
    this.heldNotes = [];
    this.latchedNotes = [];
  }

  // Private methods
  private start(): void {
    if (this.isRunning) return;
    if (this.heldNotes.length === 0) return;

    this.isRunning = true;
    this.currentIndex = 0;

    this.tick();
  }

  private tick(): void {
    if (!this.isRunning) return;

    const bpm = this.config.getBPM();
    const intervalMs = this.subdivisionToMs(this.subdivision, bpm);
    const gateMs = Math.max(10, intervalMs * this.gate);

    if (this.lastPlayedNote) {
      this.config.releaseNote(this.lastPlayedNote);
    }

    const nextNote = this.getNextNote();
    if (nextNote) {
      this.config.triggerNote(nextNote);
      this.lastPlayedNote = nextNote;

      this.gateTimeoutId = setTimeout(() => {
        if (this.lastPlayedNote === nextNote) {
          this.config.releaseNote(nextNote);
        }
      }, gateMs);
      this.scheduledTimeouts.push(this.gateTimeoutId);
    }

    this.timeoutId = setTimeout(() => {
      this.tick();
    }, intervalMs);
    this.scheduledTimeouts.push(this.timeoutId);
  }

  private getNextNote(): string | null {
    const activeNotes = this.latch ? this.latchedNotes : this.heldNotes;
    if (activeNotes.length === 0) return null;

    const totalNotes = activeNotes.length * this.octaveRange;
    let noteIndex: number;
    let octaveOffset: number;

    if (this.mode === "random") {
      const randomIndex = Math.floor(Math.random() * totalNotes);
      noteIndex = randomIndex % activeNotes.length;
      octaveOffset = Math.floor(randomIndex / activeNotes.length);
    } else if (this.mode === "up") {
      const flatIndex = this.currentIndex % totalNotes;
      noteIndex = flatIndex % activeNotes.length;
      octaveOffset = Math.floor(flatIndex / activeNotes.length);
      this.currentIndex++;
    } else if (this.mode === "down") {
      const flatIndex = (totalNotes - 1 - (this.currentIndex % totalNotes));
      noteIndex = flatIndex % activeNotes.length;
      octaveOffset = Math.floor(flatIndex / activeNotes.length);
      this.currentIndex++;
    } else if (this.mode === "upDown") {
      const cycleLength = totalNotes * 2 - 2;
      if (cycleLength <= 0) {
        noteIndex = 0;
        octaveOffset = 0;
      } else {
        const position = this.currentIndex % cycleLength;
        const flatIndex = position < totalNotes ? position : (totalNotes - 2 - (position - totalNotes));
        noteIndex = flatIndex % activeNotes.length;
        octaveOffset = Math.floor(flatIndex / activeNotes.length);
        this.currentIndex++;
      }
    } else {
      // downUp mode — all other cases exhausted by the union type
      const cycleLength = totalNotes * 2 - 2;
      if (cycleLength <= 0) {
        noteIndex = 0;
        octaveOffset = 0;
      } else {
        const position = this.currentIndex % cycleLength;
        const flatIndex = position < totalNotes ? (totalNotes - 1 - position) : (position - totalNotes + 1);
        noteIndex = flatIndex % activeNotes.length;
        octaveOffset = Math.floor(flatIndex / activeNotes.length);
        this.currentIndex++;
      }
    }

    const baseNote = activeNotes[noteIndex];
    if (!baseNote) {
      return null;
    }
    if (octaveOffset === 0) {
      return baseNote;
    }

    const baseMidi = Frequency(baseNote).toMidi();
    const transposedMidi = baseMidi + (octaveOffset * 12);
    return Frequency(transposedMidi, "midi").toNote();
  }

  private subdivisionToMs(subdivision: string, bpm: number): number {
    if (bpm <= 0) bpm = 120;

    const beatsPerSecond = bpm / 60;
    let baseValue: number;
    let multiplier = 1;

    let sub = subdivision;

    if (sub.endsWith(".")) {
      multiplier = 1.5;
      sub = sub.slice(0, -1);
    } else if (sub.endsWith("t")) {
      multiplier = 2 / 3;
      sub = sub.slice(0, -1);
    }

    if (sub.endsWith("m")) {
      const barsVal = parseInt(sub.slice(0, -1), 10);
      const bars = Number.isNaN(barsVal) || barsVal <= 0 ? 1 : barsVal;
      baseValue = bars * 4;
    } else if (sub.endsWith("n")) {
      const noteValueVal = parseInt(sub.slice(0, -1), 10);
      const noteValue = Number.isNaN(noteValueVal) || noteValueVal <= 0 ? 4 : noteValueVal;
      baseValue = 4 / noteValue;
    } else {
      const parsed = parseFloat(sub);
      if (!isNaN(parsed)) {
        return Math.max(50, 1000 / parsed);
      }
      baseValue = 1;
    }

    const durationInBeats = baseValue * multiplier;
    const durationInSeconds = durationInBeats / beatsPerSecond;
    const durationInMs = durationInSeconds * 1000;

    return Math.max(50, durationInMs);
  }
}
