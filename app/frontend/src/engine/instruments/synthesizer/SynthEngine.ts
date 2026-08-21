/* eslint-disable @typescript-eslint/member-ordering */
import { BaseInstrumentEngine } from "../shared/BaseInstrumentEngine";
import type { EngineAudioContext, InstrumentEngineConfig, SynthState } from "../shared/types";
export type { SynthState };
import { Arpeggiator } from "./utils/Arpeggiator";
import { getOptimalAudioConfig } from "@/engine/audio";
import { throttle } from "@/shared/utils/performanceUtils";
import { SynthParamManager } from "./SynthParamManager";
import { PolySynth, Filter, FrequencyEnvelope, Gain, setContext, getContext, getTransport, now, start } from "tone";
import type { ArpMode } from "./utils/Arpeggiator";
import type { NoteEvent, NoteStopEvent } from "@/engine/instruments/noteEvent";
import { DEFAULT_SYNTH_GAIN_DB, defaultSynthState } from "./constants";
import { createSynthesizer, isNoiseOscillator, type ToneSynthInstance } from "./SynthFactory";
import { getCalibratedTrimDb } from "../shared/calibration/getCalibratedTrimDb";
import { SynthLfoController } from "./SynthLfoController";
import { SynthOutputSaturationStage } from "./utils/voiceSumSaturation";
import { dbToGain, toDecibels } from "@/shared/audio/gainUnits";

/**
 * Point-in-time copy of the synth chain's node refs — used both to restore/dispose on a failed
 * rebuild (updateSynthParams) and, as a plain teardown, by disposeSynthChain itself.
 */
interface SynthChainSnapshot {
  synthRef: ToneSynthInstance | null;
  filterRef: Filter | null;
  filterEnvelopeRef: FrequencyEnvelope | null;
  gainRef: Gain | null;
  outputStage: SynthOutputSaturationStage | null;
}

export class SynthEngine extends BaseInstrumentEngine {
  private audioContext: EngineAudioContext | null = null;
  private synthRef: ToneSynthInstance | null = null;
  private filterRef: Filter | null = null;
  private filterEnvelopeRef: FrequencyEnvelope | null = null;
  private gainRef: Gain | null = null;
  private outputStage: SynthOutputSaturationStage | null = null;
  private readonly lfoController = new SynthLfoController();
  private arpeggiator: Arpeggiator | null = null;

  private synthState: SynthState = { ...defaultSynthState };
  private lastBPM: number = 0;

  private readonly activeNotes = new Map<string, unknown>();
  private readonly sustainedNotes = new Set<unknown>();
  private readonly keyHeldNotes = new Set<string>();
  private sustain = false;

  private noteStack: string[] = [];
  private currentNote: string | null = null;
  private filterEnvelopeActive = false;
  private filterEnvelopePendingTimeout: ReturnType<typeof setTimeout> | null =
    null;
  /** Audio-timeline instant the filter envelope was last *scheduled* to attack at, so every
   * note of a simultaneously-scheduled chord retriggers it only once. Null on the live path. */
  private scheduledFilterEnvelopeTime: number | null = null;
  private readonly pendingReleases = new Map<string, ReturnType<typeof setTimeout>>();

  private readonly throttledParamUpdate = throttle((params: Partial<SynthState>) => {
    this.updateSynthParamsInternal(params);
  }, 8);

  constructor(config: InstrumentEngineConfig) {
    super(config);
    this.synthState.volume = getCalibratedTrimDb(config.instrumentName) ?? DEFAULT_SYNTH_GAIN_DB;
  }

  getSynthState(): SynthState {
    return { ...this.synthState };
  }

  getActiveVoiceCount(): number {
    return this.activeNotes.size;
  }

  async load(_context?: EngineAudioContext): Promise<void> {
    this.isLoading = true;
    this.isLoaded = false;

    try {
      this.audioContext = await this.getInstrumentAudioContext();

      setContext(this.audioContext);
      await start();

      const audioConfig = getOptimalAudioConfig();
      getContext().lookAhead = audioConfig.TONE_CONTEXT.lookAhead;

      this.filterRef = new Filter({
        frequency: this.synthState.filterFrequency,
        Q: this.synthState.filterResonance,
        type: "lowpass",
      });

      this.gainRef = new Gain(dbToGain(toDecibels(this.synthState.volume)));

      if (this.config.instrumentName.startsWith("analog_")) {
        this.filterEnvelopeRef = new FrequencyEnvelope({
          attack: this.synthState.filterAttack,
          decay: this.synthState.filterDecay,
          sustain: this.synthState.filterSustain,
          release: this.synthState.filterRelease,
          baseFrequency: this.synthState.filterFrequency,
          octaves: 4,
        });
        this.filterEnvelopeRef.connect(this.filterRef.frequency);
      }

      this.synthRef = createSynthesizer(this.config.instrumentName, this.synthState);

      {
        // filterRef and gainRef are always created by this point (lines 104, 110)
        this.synthRef.connect(this.filterRef!);
        this.filterRef!.connect(this.gainRef!);

        this.outputStage = new SynthOutputSaturationStage();
        this.gainRef!.connect(this.outputStage.voiceSumGain);

        const destinationNode = await this.getMixerDestinationNode();
        if (destinationNode) {
          try {
            this.outputStage.saturator.connect(destinationNode);
          } catch {
            this.outputStage.saturator.toDestination();
          }
        } else {
          this.outputStage.saturator.toDestination();
        }

        // Resync the freshly-constructed stage's gain against whatever activeNotes.size already
        // is at this moment — 0 on first load (harmless, matches the constructor's default unity
        // gain), but non-zero on a mid-performance rebuild (updateSynthParams's isNeedsRebuild
        // path calls stopAllNotes() first, which does NOT evict sustain-held notes still tracked
        // in activeNotes while the pedal is down) — without this, a fresh stage always starts at
        // gain 1.0 regardless of how many voices are actually still sounding, producing a one-off
        // gain jump on the next note-on (DEV-299 final-review Finding 5).
        this.updateVoiceSumGain();
      }

      this.updateSynthParamsInternal(this.synthState);

      this.arpeggiator = new Arpeggiator({
        triggerNote: (note: string) => {
          if (this.synthRef) {
            try {
              if (this.synthRef instanceof PolySynth) {
                this.synthRef.triggerAttack(note, now(), 0.7);
              } else {
                this.synthRef.triggerAttack(note, now(), 0.7);
                if (this.filterEnvelopeRef) {
                  this.filterEnvelopeRef.triggerAttack(now());
                  this.filterEnvelopeActive = true;
                }
              }
            } catch {
              // Ignore errors
            }
          }
        },
        releaseNote: (note: string) => {
          if (this.synthRef) {
            try {
              if (this.synthRef instanceof PolySynth) {
                this.synthRef.triggerRelease(note, now());
              } else {
                this.synthRef.triggerRelease(undefined);
                if (this.filterEnvelopeRef && this.filterEnvelopeActive) {
                  this.filterEnvelopeRef.triggerRelease(now());
                  this.filterEnvelopeActive = false;
                }
              }
            } catch {
              // Ignore errors
            }
          }
        },
        getBPM: () => getTransport().bpm.value,
      });

      this.arpeggiator.updateParams({
        enabled: this.synthState.arpEnabled,
        mode: this.synthState.arpMode as ArpMode,
        subdivision: this.synthState.arpSubdivision,
        octaveRange: this.synthState.arpOctaveRange,
        gate: this.synthState.arpGate,
        latch: this.synthState.arpLatch,
      });

      this.isLoaded = true;
    } finally {
      this.isLoading = false;
    }
  }

  private isPolyphonic(): boolean {
    return this.config.instrumentName.endsWith("_poly");
  }

  private isMusicalNote(note: string): boolean {
    const musicalNotePattern = /^[A-Ga-g][#b]?\d+$/;
    return musicalNotePattern.test(note);
  }

  /**
   * `time` (seconds on the audio-context timeline) is optional and normally absent: every live
   * room caller plays notes the instant the key/pad is hit, and gets the existing "schedule at
   * now()" behavior. It is honored when supplied so a whole sequence of notes can be scheduled
   * up front against future timestamps — required by the offline calibration render (DEV-311),
   * where the entire pattern must be scheduled before `OfflineAudioContext.startRendering()`
   * because the render completes without ever advancing wall-clock time.
   */
  playNote({ note, velocity = 0.7, time }: NoteEvent): void {
    if (!this.synthRef || !this.isLoaded) return;
    const noteStr = String(note);
    if (!this.isMusicalNote(noteStr)) return;

    const isPoly = this.isPolyphonic();

    if (this.arpeggiator && this.synthState.arpEnabled && !isPoly) {
      this.arpeggiator.noteOn(noteStr);
      return;
    }

    this.clearPendingNote(noteStr);

    if (isPoly) {
      this.playPolySynthNote(noteStr, velocity, time);
    } else {
      this.playMonoSynthNote(noteStr, velocity, time);
    }
  }

  private playPolySynthNote(note: string, velocity: number, time?: number): void {
    const attackTime = time ?? now();
    try {
      if (this.activeNotes.has(note)) {
        try {
          this.synthRef!.triggerRelease(note, attackTime);
        } catch {
          /* ignore */
        }
        this.activeNotes.delete(note);
        this.sustainedNotes.delete(note);
        this.keyHeldNotes.delete(note);
      }
      this.clearPendingNote(note);

      this.synthRef!.triggerAttack(note, attackTime, velocity);

      this.activeNotes.set(note, () => {
        try {
          if (this.synthRef && this.synthRef instanceof PolySynth) {
            this.synthRef.triggerRelease(note, now());
          }
        } catch {
          /* ignore */
        }
      });

      this.keyHeldNotes.add(note);

      this.triggerFilterEnvelopeAttack(velocity, time);
      this.updateVoiceSumGain();
    } catch {
      this.activeNotes.delete(note);
      this.sustainedNotes.delete(note);
      this.keyHeldNotes.delete(note);
    }
  }

  /**
   * Retriggers the analog filter envelope for a new polyphonic note-on.
   *
   * Without an explicit `time` this releases immediately and defers the attack by one macrotask,
   * so the two land at strictly increasing instants. It also coalesces a chord: every note-on in
   * the same tick clears the previous pending timeout, so exactly one attack fires.
   *
   * A wall-clock `setTimeout` is useless during an offline render (which finishes before any real
   * timer fires), so a caller supplying a `time` gets the attack scheduled straight onto the
   * audio timeline. That path must preserve both properties above:
   *
   * - **No paired release.** A release and an attack at the *same* audio timestamp cancel out and
   *   the filter never opens — `triggerAttack` already cancels and re-ramps the envelope, so the
   *   release is both unnecessary and harmful here.
   * - **Coalesce by timestamp.** Every note of a scheduled chord arrives with one identical
   *   `time`; only the first should retrigger the envelope, mirroring the live path's single
   *   deferred attack.
   */
  private triggerFilterEnvelopeAttack(velocity: number, time?: number): void {
    if (!this.filterEnvelopeRef || !this.config.instrumentName.startsWith("analog_")) return;

    if (this.filterEnvelopePendingTimeout) {
      clearTimeout(this.filterEnvelopePendingTimeout);
      this.filterEnvelopePendingTimeout = null;
    }

    if (time !== undefined) {
      if (this.scheduledFilterEnvelopeTime === time) return;
      this.scheduledFilterEnvelopeTime = time;
      this.filterEnvelopeRef.triggerAttack(time, velocity);
      this.filterEnvelopeActive = true;
      return;
    }

    this.scheduledFilterEnvelopeTime = null;
    if (this.filterEnvelopeActive) this.filterEnvelopeRef.triggerRelease(now());

    this.filterEnvelopePendingTimeout = setTimeout(() => {
      this.filterEnvelopePendingTimeout = null;
      if (this.filterEnvelopeRef) {
        this.filterEnvelopeRef.triggerAttack(now(), velocity);
        this.filterEnvelopeActive = true;
      }
    }, 0);
  }

  private playMonoSynthNote(note: string, velocity: number, time?: number): void {
    try {
      this.keyHeldNotes.add(note);
      this.noteStack = this.noteStack.filter((n) => n !== note);
      this.noteStack.push(note);
      const topNote = this.noteStack[this.noteStack.length - 1];

      if (topNote === note) {
        const voice = this.synthRef!;
        if (
          this.currentNote &&
          "setNote" in voice &&
          typeof voice.setNote === "function"
        ) {
          voice.setNote(note);
          this.activeNotes.delete(this.currentNote);
        } else {
          this.synthRef!.triggerAttack(note, time, velocity);
          if (this.filterEnvelopeRef) {
            this.filterEnvelopeRef.triggerAttack(time);
            this.filterEnvelopeActive = true;
          }
        }
        this.currentNote = note;
        this.activeNotes.set(note, () => this.handleMonoSynthRelease(note));
      }
    } catch {
      /* ignore */
    }
  }

  /** See `playNote` for why `time` is optional and what supplying it means. */
  stopNote({ note, time }: NoteStopEvent): void {
    if (!this.synthRef || !this.isLoaded) return;
    const noteStr = String(note);

    const isPoly = this.isPolyphonic();

    if (this.arpeggiator && this.synthState.arpEnabled && !isPoly) {
      this.arpeggiator.noteOff(noteStr);
      return;
    }

    const releaseTime = time ?? now();
    const isKeyHeld = this.keyHeldNotes.has(noteStr);
    if (isKeyHeld) {
      this.keyHeldNotes.delete(noteStr);
      if (this.sustain) {
        this.sustainedNotes.add(noteStr);
      } else {
        if (this.synthRef instanceof PolySynth) {
          this.synthRef.triggerRelease(noteStr, releaseTime);
          this.activeNotes.delete(noteStr);
        } else {
          this.handleMonoSynthRelease(noteStr, time);
        }
      }
    } else {
      if (this.synthRef instanceof PolySynth) {
        this.synthRef.triggerRelease(noteStr, releaseTime);
      } else {
        this.handleMonoSynthRelease(noteStr, time);
      }
      this.sustainedNotes.delete(noteStr);
      this.activeNotes.delete(noteStr);
    }
    this.updateVoiceSumGain();
  }

  private handleMonoSynthRelease(noteToRelease: string, time?: number): void {
    if (!this.synthRef || this.synthRef instanceof PolySynth) return;
    if (!this.noteStack.includes(noteToRelease)) return;
    this.activeNotes.delete(noteToRelease);
    this.noteStack = this.noteStack.filter((n) => n !== noteToRelease);
    this.keyHeldNotes.delete(noteToRelease);

    const remainingHeldKeys = Array.from(this.keyHeldNotes);
    if (remainingHeldKeys.length > 0) {
      const mostRecent = remainingHeldKeys[remainingHeldKeys.length - 1];
      if (!mostRecent) {
        return;
      }
      try {
        if (
          "setNote" in this.synthRef &&
          typeof this.synthRef.setNote === "function"
        ) {
          this.synthRef.setNote(mostRecent);
        } else {
          this.synthRef.triggerAttack(mostRecent, time);
        }
        this.currentNote = mostRecent;
        this.activeNotes.set(mostRecent, () =>
          this.handleMonoSynthRelease(mostRecent),
        );

        if (
          this.filterEnvelopeRef &&
          this.config.instrumentName.startsWith("analog_")
        ) {
          this.filterEnvelopeRef.triggerAttack(time ?? now(), 0.7);
        }
      } catch {
        /* ignore */
      }
    } else {
      this.synthRef.triggerRelease(time);
      this.currentNote = null;
      if (this.filterEnvelopeRef && this.filterEnvelopeActive) {
        this.filterEnvelopeRef.triggerRelease(time ?? now());
        this.filterEnvelopeActive = false;
      }
    }
  }

  stopAllNotes(): void {
    if (!this.isLoaded) return;

    // The arpeggiator has to be stopped explicitly, and first. With arp enabled `playNote`
    // hands the note straight to it and returns, so the note never reaches `activeNotes` --
    // which means the loop below, which is driven entirely by `activeNotes`, can never reach
    // the arpeggiator no matter how many notes are sounding. That is why stopping the Arrange
    // transport left an arpeggiated track playing until its switch was toggled off by hand.
    //
    // `releaseAll` rather than `noteOff` because this is a global stop: latch is a performance
    // feature, not a reason to keep sounding after the transport has stopped.
    this.arpeggiator?.releaseAll();

    const notes = Array.from(this.activeNotes.keys());
    notes.forEach((note) => this.stopNote({ note }));
  }

  setVolume(volume: number): void {
    if (this.gainRef) {
      this.gainRef.gain.value = dbToGain(toDecibels(volume));
    }
  }

  /**
   * Sets portamento (glide) time in seconds on the underlying synth voice(s).
   * Delegates to the shared SynthParamManager so polyphonic and monophonic
   * voices are handled consistently. No-op if the synth is not yet built.
   */
  setPortamento(seconds: number): void {
    if (!this.synthRef) return;
    this.synthState = { ...this.synthState, portamento: seconds };
    SynthParamManager.applyPortamento(this.synthRef, seconds);
  }

  setSustain(sustain: boolean): void {
    this.sustain = sustain;
    if (!sustain) {
      const sustainedToRelease = Array.from(this.sustainedNotes).filter(
        (note) => !this.keyHeldNotes.has(note as string),
      );

      if (sustainedToRelease.length > 0) {
        if (this.synthRef instanceof PolySynth) {
          sustainedToRelease.forEach((note) => {
            this.synthRef!.triggerRelease(note as string, now());
            this.activeNotes.delete(note as string);
          });
        } else {
          const voice = this.synthRef!;
          const remainingHeldKeys = Array.from(this.keyHeldNotes);
          if (remainingHeldKeys.length > 0) {
            const mostRecent = remainingHeldKeys[remainingHeldKeys.length - 1];
            if (!mostRecent) {
              return;
            }
            try {
              if ("setNote" in voice && typeof voice.setNote === "function") {
                voice.setNote(mostRecent);
              } else {
                voice.triggerAttack(mostRecent);
              }
              this.currentNote = mostRecent;
              this.activeNotes.set(mostRecent, () =>
                this.handleMonoSynthRelease(mostRecent),
              );
            } catch {
              /* ignore */
            }
          } else {
            voice.triggerRelease();
            this.currentNote = null;
            if (this.filterEnvelopeRef && this.filterEnvelopeActive) {
              this.filterEnvelopeRef.triggerRelease(now());
              this.filterEnvelopeActive = false;
            }
          }
          sustainedToRelease.forEach((note) => this.activeNotes.delete(note as string));
        }
      }
      this.updateVoiceSumGain();

      this.sustainedNotes.clear();
    }
  }

  private clearPendingNote(note: string): void {
    const releaseTimeout = this.pendingReleases.get(note);
    if (releaseTimeout) {
      clearTimeout(releaseTimeout);
      this.pendingReleases.delete(note);
    }
  }

  updateBPM(bpm: number): void {
    if (bpm > 0) {
      getTransport().bpm.value = bpm;
      this.lfoController.syncToTempo(this.synthState);
      if (
        bpm !== this.lastBPM &&
        this.synthState.arpEnabled &&
        this.arpeggiator?.isRunning
      ) {
        this.arpeggiator.onBPMChanged(bpm);
      }
      this.lastBPM = bpm;
    }
  }

  async updateSynthParams(params: Partial<SynthState>): Promise<void> {
    const prevState = { ...this.synthState };
    const nextState = { ...this.synthState, ...params };
    const isNeedsRebuild =
      isNoiseOscillator(prevState.oscillatorType) !==
      isNoiseOscillator(nextState.oscillatorType);

    this.synthState = nextState;

    if (isNeedsRebuild && this.synthRef) {
      // Save old oscillator chain before attempting rebuild
      const oldChain = this.snapshotSynthChain();

      try {
        await this.stopAllNotes();
        this.disposeSynthChain();
        await this.load(); // Quick rebuild since context is already started
      } catch {
        // Rebuild failed: restore references, revert state, and clean up the failed disposals
        this.restoreSynthChain(oldChain);
        this.synthState = prevState;
        this.disposeSynthChainSnapshot(oldChain);
        return;
      }
    }

    try {
      this.throttledParamUpdate(params);
      if (this.config.isLocalUser && this.config.onSynthParamsChange) {
        this.config.onSynthParamsChange(params);
      }
    } catch {
      this.synthState = prevState;
    }
  }

  private updateSynthParamsInternal(params: Partial<SynthState>): void {
    if (!this.synthRef || !this.filterRef || !this.gainRef) return;
    try {
      const synth = this.synthRef;

      if (params.volume !== undefined) {
        this.gainRef.gain.value = dbToGain(toDecibels(params.volume));
      }

      if (params.filterFrequency !== undefined) {
        this.filterRef.frequency.value = params.filterFrequency;
        if (this.filterEnvelopeRef)
          this.filterEnvelopeRef.baseFrequency = params.filterFrequency;
      }
      if (params.filterResonance !== undefined)
        this.filterRef.Q.value = params.filterResonance;

      if (this.filterEnvelopeRef) {
        if (params.filterAttack !== undefined)
          this.filterEnvelopeRef.attack = params.filterAttack;
        if (params.filterDecay !== undefined)
          this.filterEnvelopeRef.decay = params.filterDecay;
        if (params.filterSustain !== undefined)
          this.filterEnvelopeRef.sustain = params.filterSustain;
        if (params.filterRelease !== undefined)
          this.filterEnvelopeRef.release = params.filterRelease;
      }

      if (params.portamento !== undefined)
        SynthParamManager.applyPortamento(this.synthRef, params.portamento);

      if (synth instanceof PolySynth) {
        SynthParamManager.updatePolySynthParams(synth, params);
      } else {
        SynthParamManager.updateMonoSynthParams(synth, params);
      }

      this.lfoController.update(this.synthState, this.synthRef, this.filterRef);

      if (this.arpeggiator) {
        const arpParams: {
          enabled?: boolean;
          mode?: ArpMode;
          subdivision?: string;
          octaveRange?: number;
          gate?: number;
          latch?: boolean;
        } = {};
        if (params.arpEnabled !== undefined)
          arpParams.enabled = params.arpEnabled;
        if (params.arpMode !== undefined)
          arpParams.mode = params.arpMode as ArpMode;
        if (params.arpSubdivision !== undefined)
          arpParams.subdivision = params.arpSubdivision;
        if (params.arpOctaveRange !== undefined)
          arpParams.octaveRange = params.arpOctaveRange;
        if (params.arpGate !== undefined) arpParams.gate = params.arpGate;
        if (params.arpLatch !== undefined) arpParams.latch = params.arpLatch;
        if (Object.keys(arpParams).length > 0)
          this.arpeggiator.updateParams(arpParams);
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * Recomputes the 1/√N voice-sum gain from the live active-voice count. Mono synths are
   * hard-coded to 1 rather than reading activeNotes.size — see Decision 1 in the DEV-299 plan for
   * why mono's own activeNotes bookkeeping isn't a safe voice-count source (stale entries on
   * non-portamento note switches, harmless for playback but wrong for this fix's math).
   */
  private updateVoiceSumGain(): void {
    const voiceCount = this.synthRef instanceof PolySynth ? this.activeNotes.size : 1;
    this.outputStage?.updateVoiceCount(voiceCount);
  }

  /** Point-in-time copy of the current chain refs, for the rebuild-failure restore/dispose path. */
  private snapshotSynthChain(): SynthChainSnapshot {
    return {
      synthRef: this.synthRef,
      filterRef: this.filterRef,
      filterEnvelopeRef: this.filterEnvelopeRef,
      gainRef: this.gainRef,
      outputStage: this.outputStage,
    };
  }

  /** Restores chain refs from a snapshot taken before a failed rebuild attempt. */
  private restoreSynthChain(snapshot: SynthChainSnapshot): void {
    this.synthRef = snapshot.synthRef;
    this.filterRef = snapshot.filterRef;
    this.filterEnvelopeRef = snapshot.filterEnvelopeRef;
    this.gainRef = snapshot.gainRef;
    this.outputStage = snapshot.outputStage;
  }

  /** Disposes every node in a chain snapshot, tolerating already-null/already-disposed nodes. */
  private disposeSynthChainSnapshot(snapshot: SynthChainSnapshot): void {
    const disposables: Array<{ dispose: () => void } | null> = [
      snapshot.synthRef,
      snapshot.filterRef,
      snapshot.filterEnvelopeRef,
      snapshot.gainRef,
      snapshot.outputStage,
    ];
    for (const node of disposables) {
      try {
        node?.dispose();
      } catch {
        /* ignore */
      }
    }
  }

  private disposeSynthChain(): void {
    this.disposeSynthChainSnapshot(this.snapshotSynthChain());
    this.lfoController.dispose();

    this.synthRef = null;
    this.filterRef = null;
    this.filterEnvelopeRef = null;
    this.gainRef = null;
    this.outputStage = null;
  }

  getAudioNode(): AudioNode | null {
    return this.outputStage
      ? (this.outputStage.saturator as unknown as AudioNode)
      : this.gainRef
        ? (this.gainRef as unknown as AudioNode)
        : null;
  }

  scheduleParameterChange(
    paramName: string,
    value: number,
    time: number,
    transitionTime?: number,
  ): void {
    if (!this.isLoaded) return;

    let targetParam: Record<string, unknown> | null = null;
    let scheduledValue = value;
    if (paramName === "volume" && this.gainRef) {
      targetParam = this.gainRef.gain as unknown as Record<string, unknown>;
      scheduledValue = dbToGain(toDecibels(value)); // AudioParams are always linear
    } else if (paramName === "filterFrequency" && this.filterRef) {
      targetParam = this.filterRef.frequency as unknown as Record<string, unknown>;
      if (this.filterEnvelopeRef) {
        this.filterEnvelopeRef.baseFrequency = value;
      }
    } else if (paramName === "filterResonance" && this.filterRef) {
      targetParam = this.filterRef.Q as unknown as Record<string, unknown>;
    }

    if (targetParam) {
      try {
        const schedTime = time > 0 ? time : now();
        if (transitionTime != null && transitionTime > 0) {
          (targetParam as unknown as { rampTo: (value: number, time: number, startTime?: number) => void }).rampTo(scheduledValue, transitionTime, schedTime);
        } else {
          (targetParam as unknown as { setValueAtTime: (value: number, time: number) => void }).setValueAtTime(scheduledValue, schedTime);
        }
      } catch (error) {
        console.warn(
          `[SynthEngine] Failed to schedule param change for ${paramName}:`,
          error,
        );
      }
    }
  }

  destroy(): void {
    this.stopAllNotes();
    this.isLoaded = false;

    this.activeNotes.clear();
    this.sustainedNotes.clear();
    this.keyHeldNotes.clear();
    this.noteStack = [];
    this.currentNote = null;
    this.filterEnvelopeActive = false;
    if (this.filterEnvelopePendingTimeout)
      clearTimeout(this.filterEnvelopePendingTimeout);

    this.pendingReleases.forEach((t) => clearTimeout(t));
    this.pendingReleases.clear();

    this.disposeSynthChain();

    if (this.arpeggiator) {
      this.arpeggiator.dispose();
      this.arpeggiator = null;
    }

    this.audioContext = null;
  }
}
