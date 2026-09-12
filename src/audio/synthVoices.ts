import { SynthParams } from '../types';
import { noteFrequency } from '../utils/musicTheory';
import { DEFAULT_VELOCITY, ENV_FLOOR, SILENCE, clampCutoff } from './constants';
import type { VoiceOwner } from './voiceOwner';
import { synthTrimGainFor } from './trims';
import type { EngineHooks, MasterRack } from './masterRack';

interface SynthVoice {
  oscs: OscillatorNode[];
  gains: GainNode[];
  filter: BiquadFilterNode;
  filterCutoff: number;
  filterRelease: number;
  lfo?: OscillatorNode;
  lfoGain?: GainNode;
  lfoTarget?: SynthParams['lfoTarget'];
  // A unity gain in SERIES between the VCA and the source bus, existing purely
  // so a 'volume' LFO can multiply the amp envelope instead of summing into it.
  // Always created: a connected node's signal is added to a param's automation,
  // so wiring the LFO straight to gains[0].gain made the release never reach
  // silence and inverted phase on the downswing. Kept out of `gains` because
  // gains[0]/gains[1] are positional (main VCA / sub level).
  tremoloGain: GainNode;
  // Pending teardown for an LFO whose depth just went to zero.
  lfoTeardownTimer?: ReturnType<typeof setTimeout>;
  // Third source alongside osc1/oscSub, created only when noiseVolume > 0.
  // Tracked separately from `oscs` because an AudioBufferSourceNode is not an
  // OscillatorNode, and separately from `gains` because gains[0]/gains[1] are
  // positional (main VCA / sub level).
  noise?: AudioBufferSourceNode;
  noiseGain?: GainNode;
  sustainLevel: number;
  // The amp envelope's peak, kept so a live Sustain change can recompute the
  // sustain level (sustainLevel alone can't be divided back out).
  peakGain: number;
  // When each envelope reaches its sustain segment. Past these points the
  // value is exactly sustainLevel / filterSustainCutoff, which is what lets
  // releaseVoice anchor a release that lands beyond all scheduled automation.
  ampEnvEndsAt: number;
  filterEnvEndsAt: number;
  filterSustainCutoff: number;
  envelopeScale: number;
  source: string;
  // Which PLAYER created this voice. Written once, at the single construction
  // site below, which is the only moment that means "this player now owns a
  // voice here" — never recomputed, so a release cannot be misrouted by a
  // focus change or a transport start that happened after note-on.
  owner: VoiceOwner;
  noteName: string;
  startTime: number;
  releaseScheduledAt?: number;
  // When an amp release ramp was last STARTED for this voice. Distinct from
  // releaseScheduledAt, which triggerSynthNoteOff overwrites BEFORE calling
  // releaseVoice: this one is the previous release as seen from inside
  // releaseVoice, which is what tells a second release that the voice is
  // already fading and must not be re-anchored to its sustain level.
  ampReleaseAt?: number;
  // The release time this voice was ACTUALLY released with. A pending release
  // re-planned by updateSynthParams must reuse it, not the current patch's —
  // the bass mono-kill uses 0.05 s and the same-note dedup 0.3 s, and stretching
  // either to a pad's 2 s release lets a "stopped" note ring under the new one.
  releaseTime?: number;
  // Node teardown is a timer sized to the release tail. Re-planning a release
  // that has not started must replace that timer, not add a second one.
  teardownTimer?: ReturnType<typeof setTimeout>;
  // Wall-clock backstop for a note-off that never arrives (window blur while
  // a key is held, a MIDI device unplugged mid-note, a touch interrupted by
  // the OS — see useInputDeck.ts, Keyboard.tsx and midiInput.ts). Cleared in
  // teardownVoiceNodes alongside lfoTeardownTimer so a normal release cannot
  // let this fire a second time.
  lifetimeGuardTimer?: ReturnType<typeof setTimeout>;
  /**
   * AUDIO-clock time this voice's nodes should be torn down.
   *
   * teardownTimer is a wall-clock setTimeout while the envelope it waits on
   * runs on the audio clock. When the context is suspended, currentTime
   * freezes and the timer keeps counting, so teardown fires before the release
   * ramp has run and the note is gone on resume. rearmVoiceTeardowns() uses
   * this to re-derive the delay from the audio clock after a resume.
   */
  teardownAt?: number;
}

/**
 * Synth voice allocation: note-on/off, the three release paths, voice stealing, the
 * lifetime backstops, LFO wiring and live param reshaping. It connects into the master
 * rack's per-source taps and owns no node of the master graph.
 */
export class SynthVoices {
  // Active voices tracking. activeVoices keys `${source}:${noteName}` and only
  // keeps the LATEST voice per key; sourceVoices keeps every live or still-
  // scheduled voice per source so a whole layer can be silenced at once.
  //
  // DEFERRED, deliberately: keying by source and note means two OWNERS on one
  // bus share one voice slot. If the melody grid plays C4 on 'synth' while a
  // key holding C4 is down, the dedup at the top of triggerSynthNoteOn releases
  // the held note's voice. The note is CUT SHORT, not left droning — the dedup
  // releases the older voice correctly — which is why this is a musical wart
  // and not a stuck-voice bug. Giving each owner its own slot means revisiting
  // the same-note dedup, the bass mono-kill, voice stealing and
  // updateSynthParams, all of which the existing tests pin to today's one-slot
  // behaviour; that is a larger change than per-voice provenance justified.
  // Recorded HERE, at the cause, not at the arp, which is merely one place it
  // can be noticed.
  private activeVoices = new Map<string, SynthVoice>();
  sourceVoices = new Map<string, Set<SynthVoice>>();

  // Ceiling on how long a voice can sit in activeVoices without a note-off,
  // in real wall-clock ms (not audio-clock seconds — this must keep counting
  // even if ctx.currentTime stalls). An instance field, not a module
  // constant, so a test can shrink it instead of waiting out 30 real seconds.
  private maxVoiceLifetimeMs = 30_000;

  // Generous per-source ceiling. Bounds worst-case node count from a fast
  // arp with a long release, where dozens of voices can otherwise pile up
  // faster than maxVoiceLifetimeMs alone drains them.
  private maxVoicesPerSource = 24;

  /**
   * A per-source OVERRIDE of the derived synth trim, as a linear gain, and the
   * only reason this map still exists.
   *
   * The trim itself is no longer pushed: `triggerSynthNoteOn` derives it from
   * `params.preset`, which every caller already holds at the line that reads
   * it, so a source can no longer carry a trim that disagrees with the patch it
   * is playing. That used to be pushed from eleven call sites — four in
   * `applySliceState`, one per synth-params subscription, and three in
   * `presetPreview` purely because all three preview functions share one
   * PREVIEW_SOURCE and a persistent map would otherwise hand an audition the
   * PREVIOUS audition's trim. None of those exist any more, and the staleness
   * they defended against is structurally impossible rather than merely
   * defended: there is no window in which the map and `params.preset` can
   * disagree, because the trim is computed from `params.preset` itself.
   *
   * What remains is the offline calibration harness
   * (`scripts/calibration/renderOffline.ts`), which is the one caller that
   * legitimately needs a trim OTHER than the derived one: it renders each
   * preset UNTRIMMED to measure the level the trim table is then computed
   * from, and a derivation it cannot switch off would make that measurement
   * circular. It sets the override on its own `'calibration'` source. Nothing
   * in the app writes this map, so an entry is only ever the harness saying
   * "ignore the table for this render".
   */
  private presetTrims = new Map<string, number>();

  /**
   * Reused output buffer for reshapeableVoices. Instance-scoped so the
   * fake-context engines the test harness builds never share one, and
   * cleared-and-refilled per call rather than reallocated: this runs on
   * every updateSynthParams and every equal-power rebalance, i.e. at
   * knob-drag and note-on rate. Bounded by concurrent voice count, which the
   * voice-lifetime guard and stealOldestVoice already cap, so it never grows
   * past a small, stable size.
   */
  private readonly reshapeScratch: SynthVoice[] = [];

  /**
   * The context `bind()` stored. `BaseAudioContext`, not `AudioContext`: an offline
   * render binds an `OfflineAudioContext`, which has every node factory this subsystem
   * uses but no `close()`. Null until `init()`/`bindContext` hands one over — which is
   * what keeps every setter here a no-op before init.
   */
  private ctx: BaseAudioContext | null = null;

  /**
   * The rack supplies every destination a voice connects to — the per-source taps,
   * the noise buffer and the master dry path — and the hooks are the idle-suspend
   * seams (arm the countdown, wake a suspended context, narrow it to a realtime one).
   */
  constructor(
    private readonly masterRack: MasterRack,
    private readonly hooks: EngineHooks,
  ) {}

  /** Binds the context this subsystem builds its nodes and schedules against. */
  bind(ctx: BaseAudioContext): void {
    this.ctx = ctx;
  }

  /**
   * LFO amount per target, in the target param's own units: Hz for cutoff,
   * cents for pitch, and a unitless 0..1 multiplier deviation for tremolo.
   * 0.2 keeps the tremolo VCA in 0.8..1.2 so it never goes negative.
   */
  private static lfoDepthFor(params: SynthParams): number {
    if (params.lfoTarget === 'cutoff') return params.lfoDepth * 1500;
    if (params.lfoTarget === 'pitch') return params.lfoDepth * 50;
    return Math.min(1, params.lfoDepth) * 0.2;
  }

  /**
   * Re-derive every pending teardown delay from the audio clock.
   *
   * While the context is suspended, currentTime freezes and the wall-clock
   * teardown timers keep counting, so on resume they are due immediately and
   * a note in the middle of a 2 s release is torn down mid-ramp. Called on
   * every resume — this engine's idle wake AND init()'s existing resume path,
   * which covers a browser-initiated backgrounded-tab suspend.
   */
  rearmVoiceTeardowns(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const voices of this.sourceVoices.values()) {
      for (const voice of voices) {
        if (voice.teardownTimer === undefined || voice.teardownAt === undefined) continue;
        clearTimeout(voice.teardownTimer);
        voice.teardownTimer = setTimeout(
          () => this.finishVoiceTeardown(voice),
          Math.max(0, voice.teardownAt - now) * 1000,
        );
      }
    }
  }

  /** The body the teardown timer runs — shared by releaseVoice and the re-arm. */
  private finishVoiceTeardown(voice: SynthVoice): void {
    const voiceKey = `${voice.source}:${voice.noteName}`;
    // Only delete the map entry if this voice is still the current one — a
    // same-note retrigger overwrites the entry before this timeout fires. The
    // voice's own nodes are always torn down regardless.
    if (this.activeVoices.get(voiceKey) === voice) {
      this.activeVoices.delete(voiceKey);
    }
    this.sourceVoices.get(voice.source)?.delete(voice);
    this.teardownVoiceNodes(voice);
  }

  // Bass is monophonic like a real bass: kill any other sounding bass voice
  // BEFORE creating the new one.
  //
  // Iterates sourceVoices.get('bass') — the set that already holds exactly
  // the bass voices — rather than snapshotting the WHOLE activeVoices map on
  // every bass note-on and filtering it down by key prefix. During an arp
  // that map holds every chord, lead and preview voice too.
  //
  // The identity guard restores the old semantics exactly: activeVoices kept
  // only the LATEST voice per key, so a superseded same-note voice was never
  // visited. sourceVoices keeps every live-or-releasing voice, so without
  // this check a superseded voice would send a second, duplicate note-off
  // for the same note name — which triggerSynthNoteOff resolves against the
  // CURRENT voice, releasing it twice.
  //
  // The set is snapshotted with Array.from for the same reason the map used
  // to be: triggerSynthNoteOff reaches releaseVoice, and a future change
  // there that deletes from sourceVoices synchronously must not invalidate
  // this iteration. The copy is now over ~1-2 bass voices, not ~50.
  //
  // Pass `time` so a live previous voice's release ramp starts exactly when
  // the new note starts (not immediately); the release timeout already
  // accounts for the future `time` in its delay math.
  private killPreviousBassVoice(time?: number): void {
    if (!this.ctx) return;
    const killAt = time ?? this.ctx.currentTime;
    const bassVoices = this.sourceVoices.get('bass');
    if (!bassVoices) return;
    for (const tracked of Array.from(bassVoices)) {
      if (this.activeVoices.get(`bass:${tracked.noteName}`) !== tracked) continue;
      // A voice whose release has already STARTED is on its way out;
      // killing it again only resets its teardown timer and re-runs the
      // ramps. A release still ahead on the clock is a different case and
      // must be cut short here, or a long scheduled note would ring
      // through the new one and break monophony.
      if (tracked.releaseScheduledAt !== undefined && tracked.releaseScheduledAt <= killAt) continue;
      this.triggerSynthNoteOff(tracked.noteName, 0.05, time, 'bass', true);
    }
  }

  /**
   * `owner` is REQUIRED and deliberately un-defaulted. Same rule, and the
   * same recorded reason, as `applySynthVelocityScale`'s required `source`:
   * that bug existed precisely because a call site could leave the argument off
   * and silently re-acquire reach over every voice. A default here would let
   * the next call site do it again, with no type error to see — and an
   * unlabelled voice is a voice no scoped release can ever exclude.
   */
  triggerSynthNoteOn(
    noteName: string,
    params: SynthParams,
    velocity = DEFAULT_VELOCITY,
    time: number | undefined,
    source: string,
    scaleFactor: number,
    owner: VoiceOwner,
  ): void {
    if (!this.ctx || !this.masterRack.dryGain) return;
    // wakeIfIdle() re-arms the idle countdown itself on every reachable path
    // (see its body) — a second explicit markActivity() call here was a
    // redundant clearTimeout+setTimeout pair on every single note-on. Every
    // caller reaches this choke point, including MIDI input, which triggers
    // notes directly with no init()/gesture path of its own.
    this.hooks.wakeIfIdle();
    const freq = noteFrequency(noteName, params.octave);
    const now = time ?? this.ctx.currentTime;

    if (source === 'bass') this.killPreviousBassVoice(time);

    // Stop an existing live voice of the same note. Skipped when the existing
    // voice already has its release planned (pre-scheduled pattern hits or the
    // bass mono kill above): re-releasing at scheduling time would truncate
    // its envelope.
    const existing = this.activeVoices.get(`${source}:${noteName}`);
    if (!existing?.releaseScheduledAt) {
      this.triggerSynthNoteOff(noteName, 0.3, time, source, true);
    }

    // Primary Oscillator
    const osc1 = this.ctx.createOscillator();
    osc1.type = params.oscType;
    osc1.frequency.setValueAtTime(freq, now);
    osc1.detune.setValueAtTime(params.detune, now);

    // Sub Oscillator
    const oscSub = this.ctx.createOscillator();
    oscSub.type = 'sine';
    oscSub.frequency.setValueAtTime(freq / 2, now);

    // Filter
    const filter = this.ctx.createBiquadFilter();
    filter.type = params.filterType;
    filter.frequency.setValueAtTime(params.filterCutoff, now);
    filter.Q.setValueAtTime(params.filterResonance, now);

    // Filter Envelope (VCF ADSR). The ramps use a floored attack, so the
    // "envelope has reached sustain" marker below must use the SAME floored
    // value — synthPresets ships attack: 0.002, under both floors, and a marker
    // computed from the raw value lands before the ramp ends, sending a release
    // inside that window down releaseVoice's past-the-envelope branch.
    const attack = Math.max(0.005, params.attack);
    const filterAttack = Math.max(0.01, params.filterAttack);
    const { peak: filterPeak, sustain: filterSustainLevel } = this.filterEnvLevels(params);
    filter.frequency.exponentialRampToValueAtTime(filterPeak, now + filterAttack);
    filter.frequency.exponentialRampToValueAtTime(filterSustainLevel, now + filterAttack + params.filterDecay);

    // Amplitude Envelope
    const gainNode = this.ctx.createGain();
    const subGain = this.ctx.createGain();
    subGain.gain.value = params.subOscVolume;

    // Derived here, not pushed ahead of time: `params` is in hand and
    // `params.preset` is the exact key `synthTrimGainFor` wants, so the trim is
    // a pure function of the note being played rather than per-source state a
    // caller had to remember to refresh. `presetTrims` is consulted only as an
    // explicit override and is empty in the app — see that field's docblock.
    const trim = this.presetTrims.get(source) ?? synthTrimGainFor(params.preset);
    const peakGain = velocity * 0.4 * scaleFactor * trim;
    gainNode.gain.setValueAtTime(ENV_FLOOR, now);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(0.001, peakGain), now + attack);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(ENV_FLOOR, peakGain * params.sustain), now + attack + params.decay);

    // Tremolo VCA: envelope -> tremoloGain -> bus. The LFO drives THIS node's
    // gain, so amp envelope and tremolo multiply. Unity when unused.
    const tremoloGain = this.ctx.createGain();
    tremoloGain.gain.value = 1;

    // LFO
    const { lfo, lfoGain } = this.createVoiceLfo(params, filter, osc1, tremoloGain, now);

    // Noise source — a third source alongside osc1/oscSub, feeding the same VCF
    // and VCA so the filter and amp envelopes shape it like any other source.
    // Created only when the preset asks for it (same lazy pattern as the LFO;
    // updateSynthParams adds one to a live voice if the knob comes up), and
    // created after the amp envelope so gains[0]/gains[1] stay main/sub.
    const noiseNodes = this.createNoiseNodes(params.noiseVolume, filter, now);

    // Connect nodes
    osc1.connect(filter);
    oscSub.connect(subGain);
    subGain.connect(filter);

    filter.connect(gainNode);
    gainNode.connect(tremoloGain);

    // Route through the per-source tap, and from there the bus (both lazily
    // created), to dry/effects. The tap is unity and exists only so a scope
    // can read this layer before its fader — see sourceTaps.
    tremoloGain.connect(this.masterRack.getSourceTap(source));

    osc1.start(now);
    oscSub.start(now);

    const voice: SynthVoice = {
      ...noiseNodes,
      oscs: [osc1, oscSub],
      gains: [gainNode, subGain],
      filter,
      filterCutoff: params.filterCutoff,
      filterRelease: params.filterRelease,
      lfo,
      lfoGain,
      lfoTarget: params.lfoTarget,
      tremoloGain,
      sustainLevel: peakGain * params.sustain,
      peakGain,
      ampEnvEndsAt: now + attack + params.decay,
      filterEnvEndsAt: now + filterAttack + params.filterDecay,
      filterSustainCutoff: filterSustainLevel,
      envelopeScale: scaleFactor,
      source,
      owner,
      noteName,
      startTime: now,
      releaseScheduledAt: undefined,
    };
    const voicesOfSource = this.registerVoice(source, noteName, voice);

    this.armVoiceLifetimeGuard(voice, `${source}:${noteName}`);

    if (voicesOfSource.size > this.maxVoicesPerSource) {
      this.stealOldestVoice(voicesOfSource, voice, now);
    }
  }

  /**
   * Tracks a freshly built voice under its `` `${source}:${noteName}` `` key and
   * adds it to its source's set, creating that set on first use. Returns the set,
   * because the caller's voice-cap check is a read of it.
   *
   * The key is still per-note (one voice per key), so two players sounding the
   * same note on one bus still cut each other short — recorded at `activeVoices`,
   * and deliberately deferred.
   */
  private registerVoice(source: string, noteName: string, voice: SynthVoice): Set<SynthVoice> {
    this.activeVoices.set(`${source}:${noteName}`, voice);
    let voicesOfSource = this.sourceVoices.get(source);
    if (!voicesOfSource) {
      voicesOfSource = new Set();
      this.sourceVoices.set(source, voicesOfSource);
    }
    voicesOfSource.add(voice);
    return voicesOfSource;
  }

  /**
   * The per-voice LFO: an oscillator and a depth gain, wired to whichever
   * destination `params.lfoTarget` names. Both are `undefined` when the depth
   * knob sits at zero — the same "created lazily, on the note or from the live
   * knob path" shape the noise source uses (see updateVoiceLfo).
   *
   * Tremolo is the reason the depth gain drives a NODE's gain rather than the
   * amp envelope: wired to `tremoloGain.gain` it MULTIPLIES with the envelope
   * instead of replacing it.
   *
   * `this.ctx` is non-null at every call site, both of which return early
   * without one — the assertion is that guarantee, not a hope.
   */
  private createVoiceLfo(
    params: SynthParams,
    filter: BiquadFilterNode,
    osc1: OscillatorNode,
    tremoloGain: GainNode,
    now: number,
  ): { lfo: OscillatorNode | undefined; lfoGain: GainNode | undefined } {
    let lfo: OscillatorNode | undefined;
    let lfoGain: GainNode | undefined;
    if (params.lfoDepth > 0) {
      lfo = this.ctx!.createOscillator();
      lfo.frequency.value = params.lfoRate;
      lfoGain = this.ctx!.createGain();
      lfoGain.gain.value = SynthVoices.lfoDepthFor(params);
      lfo.connect(lfoGain);

      if (params.lfoTarget === 'cutoff') {
        lfoGain.connect(filter.frequency);
      } else if (params.lfoTarget === 'pitch') {
        lfoGain.connect(osc1.detune);
      } else {
        lfoGain.connect(tremoloGain.gain);
      }
      lfo.start(now);
    }
    return { lfo, lfoGain };
  }

  /**
   * Backstop: force this voice through the normal release path after
   * maxVoiceLifetimeMs of wall-clock time if nothing ever releases it. The two
   * `this.activeVoices.get(voiceKey) !== voice` / releaseScheduledAt checks make
   * this a no-op on every voice that was released normally — see
   * teardownVoiceNodes, which clears this timer on every real teardown path.
   */
  private armVoiceLifetimeGuard(voice: SynthVoice, voiceKey: string): void {
    // Offline, every voice gets an explicit release at schedule time, so the
    // guard can never fire — and arming it anyway would leave thousands of
    // pending wall-clock timers alive past the end of the render.
    if (!this.hooks.realtimeCtx()) return;
    voice.lifetimeGuardTimer = setTimeout(() => {
      if (this.activeVoices.get(voiceKey) !== voice) return;
      if (voice.releaseScheduledAt !== undefined) return;
      if (!this.ctx) return;
      const releasedAt = this.ctx.currentTime;
      // Same requirement as stealOldestVoice below: releaseVoice() does not
      // set releaseScheduledAt itself, and this voice is still in
      // sourceVoices. Leaving it undefined would keep it reshapeable through
      // its 0.05 s release tail, so a knob move or new note-on landing in
      // that window re-targets it toward sustain right as teardown stops the
      // oscillator — an audible click on a voice that is meant to be dying.
      voice.releaseScheduledAt = releasedAt;
      voice.releaseTime = 0.05;
      this.releaseVoice(voice, 0.05, releasedAt);
    }, this.maxVoiceLifetimeMs);
  }

  // Steals the oldest already-started, not-yet-releasing voice of a source
  // once its count exceeds maxVoicesPerSource. `startTime > now` is excluded
  // — stealing a voice scheduled ahead would cancel a planned envelope, the
  // same hazard releaseVoice's own comments describe for reshapeableVoices.
  private stealOldestVoice(voicesOfSource: Set<SynthVoice>, incoming: SynthVoice, now: number): void {
    let oldest: SynthVoice | undefined;
    for (const tracked of voicesOfSource) {
      if (tracked === incoming) continue;
      if (tracked.startTime > now) continue;
      if (tracked.releaseScheduledAt !== undefined) continue;
      if (!oldest || tracked.startTime < oldest.startTime) oldest = tracked;
    }
    if (!oldest) return;
    // releaseVoice() does not set releaseScheduledAt on its own — only
    // triggerSynthNoteOff and the hard-silence paths do. Set it here, or the
    // `releaseScheduledAt !== undefined` guard above never excludes the voice
    // this loop just stole, and the same voice gets re-stolen on every
    // note-on over the cap while newer voices run unbounded.
    oldest.releaseScheduledAt = now;
    oldest.releaseTime = 0.02;
    this.releaseVoice(oldest, 0.02, now);
  }

  // Synthesizer Note Off
  triggerSynthNoteOff(noteName: string, releaseTime = 0.3, time?: number, source = 'synth', pinRelease = false): void {
    if (!this.ctx) return;
    const voice = this.activeVoices.get(`${source}:${noteName}`);
    if (!voice) return;

    const now = time ?? this.ctx.currentTime;
    // All voices stay tracked until teardown so live param updates can reach
    // sounding (or still-scheduled) voices; the same-note dedup in
    // triggerSynthNoteOn skips voices whose release is already planned here.
    voice.releaseScheduledAt = now;
    // `pinRelease` marks a release the ENGINE chose (bass mono-kill 0.05 s,
    // same-note dedup 0.3 s). Those must survive a live Release-knob change;
    // a normal note-off leaves releaseTime unset so the knob still reaches it.
    voice.releaseTime = pinRelease ? releaseTime : undefined;
    this.releaseVoice(voice, releaseTime, now);
  }

  // Shared node-teardown sequence for a voice that is being fully torn down —
  // used both by releaseVoice's delayed timeout (nodes stopped with no time
  // argument, since the release tail has already finished by the time it
  // fires) and by the hard-silence paths (stopSource/releaseSoundingVoices on
  // a future voice, and a live stopSource) which stop everything AT `when`.
  // Each node is wrapped in its own try/catch so one already-stopped node
  // can't prevent the rest of the voice from being torn down.
  private teardownVoiceNodes(voice: SynthVoice, when?: number): void {
    if (voice.lifetimeGuardTimer !== undefined) clearTimeout(voice.lifetimeGuardTimer);
    if (voice.lfoTeardownTimer !== undefined) clearTimeout(voice.lfoTeardownTimer);
    voice.oscs.forEach((osc) => {
      try {
        if (when !== undefined) osc.stop(when); else osc.stop();
        osc.disconnect();
      } catch { /* ignore */ }
    });
    voice.gains.forEach((g) => {
      try { g.disconnect(); } catch { /* ignore */ }
    });
    try { voice.filter.disconnect(); } catch { /* ignore */ }
    try { voice.tremoloGain.disconnect(); } catch { /* ignore */ }
    if (voice.lfo) {
      try {
        if (when !== undefined) voice.lfo.stop(when); else voice.lfo.stop();
        voice.lfo.disconnect();
      } catch { /* ignore */ }
    }
    if (voice.lfoGain) {
      try { voice.lfoGain.disconnect(); } catch { /* ignore */ }
    }
    if (voice.noise) {
      try {
        if (when !== undefined) voice.noise.stop(when); else voice.noise.stop();
        voice.noise.disconnect();
      } catch { /* ignore */ }
    }
    if (voice.noiseGain) {
      try { voice.noiseGain.disconnect(); } catch { /* ignore */ }
    }
  }

  /**
   * When a release of `releaseTime` starting at `now` would leave this voice
   * ready to tear down: past the AMP release ramp, plus a slop. The single
   * definition both releaseVoice (which plans it) and stopSource (which
   * compares against a voice's existing plan) read.
   *
   * The amp ramp alone, deliberately — this used to wait for the longer of the
   * amp and filter tails. Past the amp ramp the voice sits at SILENCE, so the
   * filter tail is inaudible and only the polyphony slot is still held: the
   * factory presets ship filterRelease around 0.5 s against a 0.05 s preview
   * stop, which kept ten times more dead voices alive than there was sound to
   * justify and put a fast-clicked preview over maxVoicesPerSource.
   */
  private plannedTeardownAt(releaseTime: number, now: number): number {
    return now + Math.max(0.01, releaseTime) + 0.1;
  }

  // Silences one voice: cancels its envelopes, ramps amp/filter down, and
  // tears the nodes down after the release tail.
  private releaseVoice(voice: SynthVoice, releaseTime: number, now: number): void {
    if (!this.ctx) return;
    const mainGain = voice.gains[0];
    // A voice can be released twice: the bass mono-kill runs over every tracked
    // bass voice on every note-on, and updateSynthParams re-plans a pending
    // release. The second release must hold whatever the FIRST release ramp
    // left behind — never the sustain level. Anchoring a voice that has already
    // faded lifts its gain from SILENCE back to sustain in a single sample,
    // which is an audible click on every note, and one that scales with the
    // Sustain knob. `<` not `<=`: updateSynthParams re-plans a release AT its
    // own scheduled time, and that re-plan does still need the anchor.
    const alreadyFading = voice.ampReleaseAt !== undefined && voice.ampReleaseAt < now;
    // Computed up front (outside the try below) because a throw partway
    // through AudioParam scheduling must never leave the voice without a
    // teardown plan — these values are pure arithmetic and cannot throw,
    // so the `finally` block can always use them.
    const filterRelease = Math.max(0.01, voice.filterRelease);
    const teardownAt = this.plannedTeardownAt(releaseTime, now);

    try {
      // The release has to begin at the value the envelope ACTUALLY has at
      // `now`. cancelAndHoldAtTime truncates the running attack/decay ramp
      // there and keeps its interpolated value, so the fade continues from
      // where the note was. Naming a start value instead makes the param jump
      // in a single sample — and every pattern hit is released while still
      // decaying (a 16th at 120 bpm lasts 0.125 s against a 0.4 s decay), so
      // that jump was ~4 dB on the amp and 1.5x on the cutoff: an audible
      // click on every note. The fallback values below keep the old
      // approximation for engines without cancelAndHoldAtTime.
      // Fallbacks reproduce the pre-cancelAndHold approximation exactly: a
      // release scheduled ahead can't read `.value` (it reports the value at
      // currentTime, still the envelope floor), so it estimates the sustain
      // level; an immediate release reads the live value.
      const ampFallback = alreadyFading || now <= this.ctx.currentTime + 0.01
        ? Math.max(ENV_FLOOR, mainGain.gain.value)
        : Math.max(ENV_FLOOR, voice.sustainLevel);
      this.masterRack.cancelAndHold(mainGain.gain, now, ampFallback);
      // cancelAndHoldAtTime inserts NO hold point when nothing is scheduled at
      // or after `now` — verified against an OfflineAudioContext render. The
      // ramp below would then start from the end of the DECAY instead of from
      // `now`, fading a held chord out across its whole length. Past the decay
      // the value is exactly the sustain level, so anchor it there; inside the
      // envelope cancelAndHold already left an exact hold point.
      if (!alreadyFading && now >= voice.ampEnvEndsAt) {
        mainGain.gain.setValueAtTime(Math.max(ENV_FLOOR, voice.sustainLevel), now);
      }
      mainGain.gain.exponentialRampToValueAtTime(SILENCE, now + Math.max(0.01, releaseTime));

      // VCF envelope release: ramp filter back to base cutoff
      this.masterRack.cancelAndHold(voice.filter.frequency, now, clampCutoff(voice.filter.frequency.value));
      if (!alreadyFading && now >= voice.filterEnvEndsAt) {
        voice.filter.frequency.setValueAtTime(clampCutoff(voice.filterSustainCutoff), now);
      }
      voice.filter.frequency.exponentialRampToValueAtTime(clampCutoff(voice.filterCutoff), now + filterRelease);
    } catch {
      // ignore — scheduling failed partway through, but the voice still gets
      // a realtime teardown or offline audio-clock stop in `finally`.
    } finally {
      voice.ampReleaseAt = now;
      voice.teardownAt = teardownAt;
      if (voice.teardownTimer !== undefined) clearTimeout(voice.teardownTimer);
      if (this.hooks.realtimeCtx()) {
        // Realtime contexts need a wall-clock cleanup after the audio-clock
        // release. rearmVoiceTeardowns() re-derives this delay after suspend,
        // because currentTime freezes while the wall clock does not.
        const teardownDelayMs =
          (teardownAt - now + Math.max(0, now - this.ctx.currentTime)) * 1000;
        voice.teardownTimer = setTimeout(() => this.finishVoiceTeardown(voice), teardownDelayMs);
      } else {
        // An OfflineAudioContext may render slower than wall time. A timer can
        // therefore disconnect a scheduled voice before the offline timeline
        // reaches it — synth buses disappear while drum one-shots survive.
        // Stop sources on the AUDIO clock and keep the graph connected until
        // the throwaway context is discarded after rendering.
        voice.teardownTimer = undefined;
        voice.oscs.forEach((osc) => {
          try { osc.stop(teardownAt); } catch { /* already stopped */ }
        });
        if (voice.lfo) {
          try { voice.lfo.stop(teardownAt); } catch { /* already stopped */ }
        }
        if (voice.noise) {
          try { voice.noise.stop(teardownAt); } catch { /* already stopped */ }
        }
      }
    }
  }

  /**
   * Hard-silences a voice whose oscillators have not started yet.
   *
   * A release RAMP is wrong here: the ramp runs from `now` and finishes before
   * `voice.startTime`, at which point the oscillators start anyway and the amp
   * gain holds whatever value the ramp left. Worse, cancelling the note-on
   * floor event can leave the GainNode at its intrinsic 1.0, so the "released"
   * voice sounds at roughly 3x peakGain — an audible pop on every pattern stop.
   */
  private silenceVoiceNow(voice: SynthVoice, now: number): void {
    if (voice.teardownTimer !== undefined) clearTimeout(voice.teardownTimer);
    const voiceKey = `${voice.source}:${voice.noteName}`;
    try {
      voice.gains[0].gain.cancelScheduledValues(now);
      voice.gains[0].gain.setValueAtTime(0, now);
    } catch { /* ignore */ }
    if (this.activeVoices.get(voiceKey) === voice) this.activeVoices.delete(voiceKey);
    this.sourceVoices.get(voice.source)?.delete(voice);
    this.teardownVoiceNodes(voice, now);
  }

  // Immediately silences every voice of a source — sounding ones and hits
  // still scheduled in the future. Releasing a held preview stops the whole
  // pattern, not just the last scheduled hit.
  //
  // `time` anchors the release in the AudioContext's timeline so a soft stop
  // can be scheduled exactly on a bar line instead of relying on a timer.
  // releaseVoice already handles a `now` in the future.
  /**
   * Drops a source's voices that have NOT started sounding by `time`, and
   * leaves every voice that has alone — envelope, release tail and all.
   *
   * The seamless half of `stopSource`. A song-mode loop advance must not touch
   * what is already ringing (that is the outgoing loop's tail, and cutting it
   * is exactly the seam the user hears), but it must still drop the outgoing
   * loop's notes that the 0.1 s lookahead has already queued PAST the boundary
   * — those would sound over the incoming loop.
   */
  dropVoicesScheduledFrom(source: string, time: number): void {
    if (!this.ctx) return;
    const voices = this.sourceVoices.get(source);
    if (!voices) return;
    for (const voice of Array.from(voices)) {
      if (voice.startTime >= time) this.silenceVoiceNow(voice, time);
    }
  }

  /**
   * The shared body of stopSource and stopOwnedVoices: silence a source's
   * voices, including hits still scheduled ahead of the transport.
   *
   * `owner === undefined` means every voice on the bus. One body rather than
   * two, because the skip guard below is subtle, was arrived at from a real
   * bug, and a drift between two copies of it would be inaudible until it
   * wasn't.
   */
  private stopVoicesOf(
    source: string,
    releaseTime: number,
    time: number | undefined,
    owner: VoiceOwner | undefined,
  ): void {
    if (!this.ctx) return;
    const now = time ?? this.ctx.currentTime;
    const voices = this.sourceVoices.get(source);
    if (!voices) return;
    for (const voice of Array.from(voices)) {
      if (owner !== undefined && voice.owner !== owner) continue;
      if (voice.startTime > now) {
        this.silenceVoiceNow(voice, now);
        continue;
      }
      // A voice already fading toward a teardown no later than the one this
      // stop would plan is already stopping, so re-releasing it changes
      // nothing audible — but releaseVoice re-arms its teardown timer, and a
      // held preview stops its source on every press AND release. Clicking
      // faster than the tail is long therefore kept every dead voice in
      // sourceVoices indefinitely; past maxVoicesPerSource, stealOldestVoice
      // can only steal voices with no release planned — the notes of the
      // chord being pressed right now — so the preview collapsed to its last
      // note and stayed there. A SHORTER stop still falls through and cuts
      // the tail, which is what makes this a skip and not a blanket guard.
      if (
        voice.releaseScheduledAt !== undefined
        && voice.teardownAt !== undefined
        && voice.teardownAt <= this.plannedTeardownAt(releaseTime, now)
      ) continue;
      voice.releaseScheduledAt = now;
      voice.releaseTime = releaseTime;
      this.releaseVoice(voice, releaseTime, now);
    }
  }

  /**
   * Immediately silences EVERY voice of a source — sounding ones and hits still
   * scheduled in the future, whoever created them. Releasing a held preview
   * stops the whole pattern, not just the last scheduled hit.
   *
   * `time` anchors the release in the AudioContext's timeline so a soft stop
   * can be scheduled exactly on a bar line instead of relying on a timer.
   * releaseVoice already handles a `now` in the future.
   *
   * Whole-bus reach is DELIBERATELY the method with the whole-bus name.
   * loadLoop, vibes and projectSlice genuinely mean "silence this bus, whatever
   * is on it" — a project install that left a held note ringing would be worse
   * than the bug per-voice provenance closes. Anything narrower calls
   * stopOwnedVoices; it can never be reached by omitting an argument, which is
   * how the original defect came to exist.
   */
  stopSource(source: string, releaseTime = 0.1, time?: number): void {
    this.stopVoicesOf(source, releaseTime, time, undefined);
  }

  /**
   * stopSource narrowed to one owner: sounding voices AND future-scheduled hits
   * that THIS player created, and nothing else. What the melody-track sequencer
   * needs, so stopping a grid does not cut a held key or an arp note off the
   * shared bus.
   */
  stopOwnedVoices(
    source: string,
    owner: VoiceOwner,
    releaseTime = 0.1,
    time?: number,
  ): void {
    this.stopVoicesOf(source, releaseTime, time, owner);
  }

  /**
   * Re-balances every still-sounding voice OF ONE SOURCE for equal-power
   * polyphony (held notes get quieter as more join). Voices with a planned
   * release — pattern hits — keep their envelopes; envelopeScale makes
   * repeated calls relative.
   *
   * `source` is REQUIRED. This used to call `reshapeableVoices()` with no
   * argument although the parameter existed, and `reshapeableVoices(undefined)`
   * walks EVERY entry of sourceVoices — so a keyboard press re-shaped the
   * sounding chord, bass and pad voices as well as the synth's, quietly
   * ducking the accompaniment under a held keyboard chord. A required
   * parameter is what stops a later call site re-acquiring that reach by
   * simply leaving the argument off, which is how the original slipped in.
   *
   * No OWNER filter, and that is not an oversight. It already skips every voice
   * with a planned release, and sequenced voices always have one —
   * playbackNoteOff schedules the release at scheduling time — so equal-power
   * polyphony from a keyboard hold already cannot re-shape the sequencer's
   * notes. The `source` narrowing above is what this method needed; provenance
   * adds nothing on top of it.
   */
  applySynthVelocityScale(scale: number, source: string): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const voice of this.reshapeableVoices(source)) {
      if (voice.releaseScheduledAt !== undefined) continue;
      const factor = scale / voice.envelopeScale;
      if (Math.abs(factor - 1) < 0.001) continue;

      voice.envelopeScale = scale;
      voice.sustainLevel *= factor;
      // peakGain must track the rebalance too: updateSynthParams recomputes
      // the sustain level from it, and an unscaled peak would undo this.
      voice.peakGain *= factor;
      const gain = voice.gains[0].gain;
      // cancelAndHold, not cancelScheduledValues: a voice mid-attack has only
      // the note-on floor as a surviving event, so cancelling would drop the
      // rebalance to 0.0001 and glide back up — a click on every added note.
      this.masterRack.cancelAndHold(gain, now);
      gain.setTargetAtTime(Math.max(ENV_FLOOR, voice.sustainLevel), now, 0.01);
    }
  }

  /**
   * Releases only the voices of a source THAT THIS OWNER CREATED and that have
   * actually started. Unlike stopSource this leaves future-scheduled hits
   * alone, so releasing a held key in arp mode no longer cancels the envelopes
   * of notes the clock has already scheduled (which cancelled their attack and
   * made them inaudible). A future voice without a release of its own is still
   * released, otherwise it would drone forever.
   *
   * `owner` is REQUIRED and un-defaulted. Three players share the melodic
   * buses — live input, the arp, the melody-track sequencer — so an owner-blind
   * release on 'synth' or 'fx' cuts a melody track's sounding note short on an
   * arp key-up. Whole-bus reach lives in stopSource, whose name says so, and
   * must never be reachable by leaving an argument off.
   */
  releaseSoundingVoices(source: string, releaseTime: number, owner: VoiceOwner): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const voices = this.sourceVoices.get(source);
    if (!voices) return;
    for (const voice of Array.from(voices)) {
      if (voice.owner !== owner) continue;
      if (voice.startTime > now) {
        // A future hit that already owns a release keeps it: this is the arp
        // key-release path, which must not cancel notes the clock has planned.
        if (voice.releaseScheduledAt !== undefined) continue;
        // A future hit with no release of its own would drone forever, and a
        // ramp cannot silence a voice that starts after the ramp ends.
        this.silenceVoiceNow(voice, now);
        continue;
      }
      voice.releaseScheduledAt = now;
      voice.releaseTime = releaseTime;
      this.releaseVoice(voice, releaseTime, now);
    }
  }

  /**
   * Overrides the derived preset trim for one source, as a LINEAR gain.
   *
   * CALIBRATION HARNESS ONLY. `triggerSynthNoteOn` derives the trim from
   * `params.preset` on its own; the app never calls this, and adding a call
   * from `engineSync` or `presetPreview` would re-create the eleven-call-site
   * push this replaced. The harness needs it because its untrimmed render pass
   * must measure a preset with the table switched OFF (`setPresetTrim(…, 1)`),
   * which no derivation can express. See `presetTrims`.
   */
  setPresetTrim(source: string, trimGain: number): void {
    this.presetTrims.set(source, trimGain);
  }

  /**
   * The VCF envelope's two levels. Written once here because note-on
   * (triggerSynthNoteOn) and the live knob path (updateSynthParams) must agree
   * on the sustain cutoff — a release anchors to it, so a drifted copy makes
   * the filter jump at note-off.
   */
  private filterEnvLevels(params: SynthParams): { peak: number; sustain: number } {
    return {
      peak: clampCutoff(params.filterCutoff + params.filterEnvAmount),
      sustain: clampCutoff(params.filterCutoff + params.filterEnvAmount * params.filterSustain),
    };
  }

  /**
   * Every tracked voice of `source` (or all sources) that can be re-shaped
   * right now: it has started, and it is not already fading.
   *
   * Iterates sourceVoices, not activeVoices: activeVoices only keeps the
   * LATEST voice per note, so a still-sounding voice that a same-note retrigger
   * evicted would be skipped and left at the old level.
   *
   * Returns the shared scratch buffer, not a fresh array. Both call sites
   * consume it in one synchronous for...of and neither is re-entered from
   * inside that loop, so reuse is safe as long as no caller retains the
   * result past that loop — the readonly return type keeps it that way.
   */
  private reshapeableVoices(source?: string): readonly SynthVoice[] {
    const out = this.reshapeScratch;
    out.length = 0;
    if (!this.ctx) return out;
    const now = this.ctx.currentTime;
    if (source !== undefined) {
      this.collectReshapeable(this.sourceVoices.get(source), now, out);
    } else {
      for (const set of this.sourceVoices.values()) {
        this.collectReshapeable(set, now, out);
      }
    }
    return out;
  }

  /** Appends one source set's reshapeable voices to `out`. */
  private collectReshapeable(
    set: Set<SynthVoice> | undefined,
    now: number,
    out: SynthVoice[],
  ): void {
    if (!set) return;
    for (const voice of set) {
      // Voices scheduled ahead keep the envelopes they were planned with;
      // re-targeting them cancels their scheduled ramps, release included.
      if (voice.startTime > now) continue;
      // A voice already in its release tail keeps the ramp it was given.
      if (voice.releaseScheduledAt !== undefined && voice.releaseScheduledAt <= now) continue;
      out.push(voice);
    }
  }

  // Points a voice's (already-created) LFO gain at the given target and
  // scale, disconnecting it from wherever it was previously wired. The scale
  // is set with setValueAtTime, landing INSTANTLY rather than gliding: at the
  // moment of the switch `lfoGain.gain` still holds the OLD target's
  // magnitude (e.g. 750 for cutoff, 25 for pitch), and a setTargetAtTime
  // glide into the new scale would modulate the NEW target at that stale
  // magnitude for ~5 time constants — a gain blast (and the very phase
  // inversion this task removes) on a switch into 'volume', and an audible
  // blip on a switch into 'cutoff'/'pitch'.
  private connectLfoTo(voice: SynthVoice, target: SynthParams['lfoTarget'], scale: number, now: number): void {
    if (!voice.lfoGain) return;
    try { voice.lfoGain.disconnect(); } catch { /* ignore */ }
    try {
      voice.lfoGain.gain.cancelScheduledValues(now);
      voice.lfoGain.gain.setValueAtTime(scale, now);
    } catch { /* ignore */ }
    if (target === 'cutoff') {
      voice.lfoGain.connect(voice.filter.frequency);
    } else if (target === 'pitch') {
      voice.lfoGain.connect(voice.oscs[0].detune);
    } else {
      voice.lfoGain.connect(voice.tremoloGain.gain);
    }
    voice.lfoTarget = target;
  }

  /**
   * Removes an LFO whose depth has gone to zero, once the fade is inaudible.
   * setTargetAtTime is asymptotic — it never reaches exactly 0 — so without
   * this a "switched off" LFO keeps a running oscillator and a residual
   * modulation for the rest of the voice's life.
   */
  private teardownVoiceLfo(voice: SynthVoice, now: number, tc: number): void {
    if (!voice.lfoGain || voice.lfoTeardownTimer !== undefined) return;
    this.masterRack.cancelAndHold(voice.lfoGain.gain, now);
    voice.lfoGain.gain.setTargetAtTime(0, now, tc);
    voice.lfoTeardownTimer = setTimeout(() => {
      voice.lfoTeardownTimer = undefined;
      if (voice.lfo) { try { voice.lfo.stop(); voice.lfo.disconnect(); } catch { /* ignore */ } }
      if (voice.lfoGain) { try { voice.lfoGain.disconnect(); } catch { /* ignore */ } }
      voice.lfo = undefined;
      voice.lfoGain = undefined;
      voice.lfoTarget = undefined;
    }, tc * 5 * 1000); // 5 time constants ~= -43 dB
  }

  // Re-points a live voice's LFO at the current params, creating the LFO nodes
  // on the spot if the depth knob has just come up off zero.
  private updateVoiceLfo(voice: SynthVoice, params: SynthParams, now: number, tc: number): void {
    if (!this.ctx) return;
    if (params.lfoDepth <= 0) {
      this.teardownVoiceLfo(voice, now, tc);
      return;
    }

    // The knob came back up before the teardown landed: keep the same nodes.
    if (voice.lfoTeardownTimer !== undefined) {
      clearTimeout(voice.lfoTeardownTimer);
      voice.lfoTeardownTimer = undefined;
    }

    if (!voice.lfo || !voice.lfoGain) {
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = params.lfoRate;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 0;
      lfo.connect(lfoGain);
      lfo.start(now);
      voice.lfo = lfo;
      voice.lfoGain = lfoGain;
      voice.lfoTarget = undefined; // force the connect below
    }

    const depth = SynthVoices.lfoDepthFor(params);
    if (voice.lfoTarget !== params.lfoTarget) {
      // Target switch: land at the new scale instantly (see connectLfoTo).
      this.connectLfoTo(voice, params.lfoTarget, depth, now);
    } else {
      // Same target, only the depth knob moved: a glide is musically right
      // here, and an instant jump would click.
      voice.lfoGain.gain.setTargetAtTime(depth, now, tc);
    }

    voice.lfo.frequency.setTargetAtTime(params.lfoRate, now, tc);
  }

  // Live-update every sounding voice so knob tweaks are audible immediately
  // instead of only on the next note. ADSR timing values still apply to the
  // next note (standard synth behavior); release cutoff stays in sync.
  updateSynthParams(params: SynthParams, source?: string): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const tc = 0.03; // smoothing time constant in seconds

    const sustainCutoff = this.filterEnvLevels(params).sustain;

    for (const voice of this.reshapeableVoices(source)) {
      const osc = voice.oscs[0];

      osc.type = params.oscType;
      this.masterRack.cancelAndHold(osc.detune, now);
      osc.detune.setTargetAtTime(params.detune, now, tc);

      voice.filter.type = params.filterType;
      this.masterRack.cancelAndHold(voice.filter.frequency, now);
      voice.filter.frequency.setTargetAtTime(sustainCutoff, now, tc);
      this.masterRack.cancelAndHold(voice.filter.Q, now);
      voice.filter.Q.setTargetAtTime(params.filterResonance, now, tc);

      const subGain = voice.gains[1];
      this.masterRack.cancelAndHold(subGain.gain, now);
      subGain.gain.setTargetAtTime(params.subOscVolume, now, tc);

      this.updateVoiceNoise(voice, params.noiseVolume, now, tc);

      // Keep the note-off filter release ramp in sync with the new cutoff
      voice.filterCutoff = params.filterCutoff;
      voice.filterRelease = params.filterRelease;
      // The setTargetAtTime above drives the cutoff to sustainCutoff from here
      // on, so that is what a later release must anchor to.
      voice.filterSustainCutoff = sustainCutoff;
      voice.filterEnvEndsAt = Math.min(voice.filterEnvEndsAt, now);

      this.updateVoiceLfo(voice, params, now, tc);

      // Amp Sustain is a LEVEL, not a time: on a held pad the next note is
      // bars away, so applying it only at note-on makes the knob read as
      // dead. Retarget only when it actually moved — gliding the amp on every
      // cutoff tweak would cut short the attack of a percussive stab.
      const nextSustain = voice.peakGain * params.sustain;
      if (Math.abs(nextSustain - voice.sustainLevel) > 1e-6) {
        voice.sustainLevel = nextSustain;
        this.masterRack.cancelAndHold(voice.gains[0].gain, now);
        voice.gains[0].gain.setTargetAtTime(Math.max(ENV_FLOOR, nextSustain), now, tc);
      }

      // A voice sounding now whose note-off sits ahead on the clock (a
      // sustained chord, a whole-note bass) has its release ramp already
      // planned with the OLD release time and cutoff — and the cancelAndHold
      // above just wiped the filter half of it. Re-plan it: nothing has faded
      // yet, so re-arming is silent, and the Release knob reaches the note
      // that is ringing instead of only the next one. Re-plan with the
      // release the voice was ACTUALLY released with when the engine chose it
      // (bass mono-kill, same-note dedup), so a pad's long release can't
      // stretch a kill and break monophony; fall back to the patch's release
      // for a normal note-off, which must still track a live Release-knob
      // change.
      if (voice.releaseScheduledAt !== undefined && voice.releaseScheduledAt > now) {
        this.releaseVoice(voice, voice.releaseTime ?? params.release, voice.releaseScheduledAt);
      }
    }
  }

  // Builds, wires and starts the noise source used by both the note-on path and
  // the live knob path, returning the fields to merge into the voice — or an
  // empty object when the preset asks for no noise, so callers branch on nothing.
  // `target` is the voice's filter: noise is a source alongside osc1/oscSub, so
  // the VCF and its envelope shape it like any other source.
  // `loop` matters: createNoiseNode's buffer is 2 s and a pad's release runs
  // longer, so an unlooped source would fall silent mid-note.
  private createNoiseNodes(
    level: number,
    target: AudioNode,
    startAt: number,
    initialLevel: number = level,
  ): Pick<SynthVoice, 'noise' | 'noiseGain'> {
    if (!this.ctx || level <= 0) return {};
    // createNoiseNode always returns a looped source now.
    const noise = this.masterRack.createNoiseNode();
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.value = initialLevel;
    noise.connect(noiseGain);
    noiseGain.connect(target);
    noise.start(startAt);
    return { noise, noiseGain };
  }

  // Tracks the noise knob on a voice that is already sounding, adding the
  // source to a voice that started silent — the same lazy shape the LFO uses,
  // so turning the knob up is audible on the current note, not only the next.
  private updateVoiceNoise(voice: SynthVoice, level: number, now: number, tc: number): void {
    if (level <= 0) {
      if (!voice.noiseGain) return;
      this.masterRack.cancelAndHold(voice.noiseGain.gain, now);
      voice.noiseGain.gain.setTargetAtTime(0, now, tc);
      return;
    }
    if (!voice.noiseGain) {
      // Ramp up from silence so adding the source mid-note doesn't click. The
      // level is ENV_FLOOR rather than Number.MIN_VALUE: the old denormal was
      // there only to slip past the `level <= 0` guard, which is now expressed
      // by passing the real level and a separate starting level.
      Object.assign(voice, this.createNoiseNodes(level, voice.filter, now, ENV_FLOOR));
      if (!voice.noiseGain) return;
    }
    this.masterRack.cancelAndHold(voice.noiseGain.gain, now);
    voice.noiseGain.gain.setTargetAtTime(level, now, tc);
  }
}
