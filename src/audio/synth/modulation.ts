/**
 * Audio-clock envelope automation for the subtractive engine (design:
 * docs/superpowers/specs/2026-09-14-synth-engine-and-presets-design.md).
 *
 * Every schedule here is audio-clock automation only — never a wall-clock
 * timer (`setTimeout`, `Date.now`) — and every time argument is an exact
 * audio-clock time the caller already knows (a note-on/note-off instant),
 * not `ctx.currentTime` read again inside this module. That is what lets
 * these functions run unchanged under an `OfflineAudioContext`, which is
 * what the offline mixdown render needs.
 *
 * `scheduleAdsr`/`schedulePitchEnvelope` deliberately use ONLY
 * `linearRampToValueAtTime`, never `exponentialRampToValueAtTime`. The nine
 * `ModTarget`s this engine's ENV2 routes can reach (`src/types/synth.ts`)
 * carry signed deltas in four different units — semitones, dB, a normalized
 * resonance delta, pan — every one of which can legitimately be negative or
 * cross zero. An exponential ramp requires same-sign, non-zero endpoints
 * throughout, so it cannot express most of those routes at all; a linear
 * ramp can, and a linear ramp can also land on an exact 0, which is what
 * lets `releaseScheduledParam` reach genuine silence (see its own doc below)
 * rather than the asymptotic near-zero `setTargetAtTime(0, …)` leaves behind
 * — the exact bug the dsp-audio skill's LFO-volume-target note warns about.
 */

/**
 * The subset of `AudioParam` these primitives schedule against. A real
 * `AudioParam` (e.g. an oscillator's `detune`, a gain's `gain`) satisfies
 * this structurally — it has every member here plus many more, and
 * TypeScript's structural typing only requires the ones actually used — so
 * production code passes a real node's param unchanged. Tests pass the
 * small fake `fakeAutomationParam` (`src/audio/engineTestHelpers.ts`) built
 * to implement exactly this surface instead of the DOM's much larger
 * `AudioParam` interface.
 */
export interface AutomationParam {
  value: number;
  setValueAtTime(value: number, startTime: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
  cancelScheduledValues(startTime: number): void;
}

/**
 * Envelope segment lengths in seconds, plus the 0..1 sustain fraction.
 * Deliberately its own shape rather than `AdsrParams` (`src/types/synth.ts`,
 * fields `attack`/`decay`/`sustain`/`release`) — this module's field names
 * spell out their unit so a caller scheduling an audio-clock time next to
 * one never has to remember which bare-named field is in seconds. The voice
 * graph (`subtractiveVoice.ts`) adapts a patch's `ampEnvelope`/`modEnvelope`
 * into this shape at the call site; `releaseSeconds` travels on the type for a caller's convenience but
 * `scheduleAdsr` itself never reads it — release is a separate, later call
 * (`releaseScheduledParam`) because it fires at note-off, an audio-clock
 * time this function's caller cannot know when it schedules the attack.
 */
export interface EnvelopeTiming {
  attackSeconds: number;
  decaySeconds: number;
  sustain: number;
  releaseSeconds: number;
}

/**
 * The two absolute values an envelope moves between: `base` is the value
 * before attack and the value decay/sustain never falls below, `peak` is
 * the value attack reaches. Sustain holds at `base + (peak - base) *
 * envelope.sustain` — a fraction of the base-to-peak span, matching how
 * `AdsrParams.sustain` is documented everywhere else in this codebase.
 */
export interface EnvelopeLevels {
  base: number;
  peak: number;
}

/**
 * Schedules attack + decay-to-sustain on `param`, starting at the exact
 * audio-clock time `at`. Does not schedule a release and does not cancel any
 * prior automation on `param` — a caller retriggering before a previous
 * envelope finished must cancel first (the voice graph decides whether that
 * is right for a given voice mode; a fresh poly voice never needs to).
 *
 * An attack of 0 seconds cannot be a zero-duration ramp (a ramp needs two
 * distinct times), so it is a single `setValueAtTime(peak, at)` instead — the
 * value simply starts at `peak`. A decay of 0 seconds behaves the same way:
 * if the sustain level differs from `peak` the jump is a `setValueAtTime` at
 * the same instant decay would otherwise have ended; if it does not differ,
 * nothing further needs scheduling.
 */
export function scheduleAdsr(
  param: AutomationParam,
  envelope: EnvelopeTiming,
  levels: EnvelopeLevels,
  at: number,
): void {
  const { base, peak } = levels;
  const attackSeconds = Math.max(0, envelope.attackSeconds);
  const decaySeconds = Math.max(0, envelope.decaySeconds);
  const sustainLevel = base + (peak - base) * envelope.sustain;
  const attackEndsAt = at + attackSeconds;
  const decayEndsAt = attackEndsAt + decaySeconds;

  if (attackSeconds > 0) {
    param.setValueAtTime(base, at);
    param.linearRampToValueAtTime(peak, attackEndsAt);
  } else {
    param.setValueAtTime(peak, at);
  }

  if (decaySeconds > 0) {
    param.linearRampToValueAtTime(sustainLevel, decayEndsAt);
  } else if (sustainLevel !== peak) {
    param.setValueAtTime(sustainLevel, decayEndsAt);
  }
}

/** Cents per semitone — pitch is scheduled in cents on `detune`, never as a frequency ratio. */
/** One semitone in cents — the scale every pitch route converts through. */
export const CENTS_PER_SEMITONE = 100;

/**
 * `scheduleAdsr` specialised for a pitch route: `semitones` (the route's
 * signed `ModRoute` amount for `pitch-all`/`osc1-pitch`/`osc2-pitch`) is
 * converted to cents before scheduling, and the envelope always runs from a
 * `base` of 0 cents (no pitch offset) up to `peak` cents — the modulation
 * amount itself, not an absolute pitch. The voice graph schedules this
 * directly onto the target oscillator's `detune`, which it keeps clear of
 * static tuning (all of that lands on `frequency`) precisely so this
 * envelope's base of 0 is the oscillator's true unmodulated pitch — and so a
 * node the LFO connects to the same param SUMS with this contour instead of
 * fighting it.
 */
export function schedulePitchEnvelope(
  param: AutomationParam,
  envelope: EnvelopeTiming,
  semitones: number,
  at: number,
): void {
  scheduleAdsr(param, envelope, { base: 0, peak: semitones * CENTS_PER_SEMITONE }, at);
}

/**
 * The value `scheduleAdsr` leaves on a param at the audio-clock time `at`,
 * computed rather than read.
 *
 * This is the exact inverse of the scheduling above and must stay in lockstep
 * with it: same `Math.max(0, …)` clamps, same sustain formula, same treatment
 * of a zero-length attack or decay. It exists because a release can be
 * SCHEDULED AHEAD — the sequencer books a note-off before the note-on has even
 * sounded — and there is no way to read a future value off an `AudioParam`:
 * per the Web Audio spec `param.value` reports the value at `ctx.currentTime`
 * and nothing else. `src/audio/masterRack.ts`'s `cancelAndHold` says the same
 * thing in its `fallbackValue` doc, and the legacy voice path passes its own
 * computed sustain level for exactly this reason.
 *
 * Before `startedAt` the answer is `base`: nothing has been scheduled yet, and
 * `base` is where both envelopes sit at rest (silence for the amp, the
 * unmodulated value for a route).
 */
export function envelopeValueAt(
  envelope: EnvelopeTiming,
  levels: EnvelopeLevels,
  startedAt: number,
  at: number,
): number {
  const { base, peak } = levels;
  const attackSeconds = Math.max(0, envelope.attackSeconds);
  const decaySeconds = Math.max(0, envelope.decaySeconds);
  const sustainLevel = base + (peak - base) * envelope.sustain;
  if (at < startedAt) return base;
  const attackEndsAt = startedAt + attackSeconds;
  if (attackSeconds > 0 && at < attackEndsAt) {
    return base + (peak - base) * ((at - startedAt) / attackSeconds);
  }
  const decayEndsAt = attackEndsAt + decaySeconds;
  if (decaySeconds > 0 && at < decayEndsAt) {
    return peak + (sustainLevel - peak) * ((at - attackEndsAt) / decaySeconds);
  }
  return sustainLevel;
}

/**
 * Releases `param` to exact silence (0) over `seconds`, starting from
 * `heldValue` — what the param holds at the exact audio-clock time `at`,
 * mid-attack, mid-decay or already at sustain, it does not matter which.
 *
 * `heldValue` is passed IN and is required. It was `param.value` read inside,
 * which is correct only when `at` is `ctx.currentTime`; a note-off scheduled
 * ahead (which is what every sequenced note is) would anchor the release at
 * the value the param holds NOW and step there audibly. `envelopeValueAt`
 * above is what a caller computes it with.
 *
 * Deliberately NOT `cancelAndHoldAtTime`, which would insert the hold point
 * for free: Firefox does not implement it (`src/audio/masterRack.ts`'s
 * `cancelAndHold` carries the same workaround for the legacy engine), and —
 * verified there against an `OfflineAudioContext` render — it inserts NO hold
 * point at all when nothing is scheduled at or after `at`, so a release
 * beginning after the envelope has reached sustain would silently start its
 * ramp from the end of the decay instead of from `at`. A computed anchor has
 * neither problem and needs no capability branch, which is also what keeps
 * this module identical under an `OfflineAudioContext`.
 *
 * `contourStartedAt` is when the curve this release INTERRUPTS was scheduled
 * to begin — the note-on instant for a release anchored on the envelope, or
 * the previous release's own start for one chained off it. It is REQUIRED, and
 * that is a scar rather than a style: it is what makes the re-draw below
 * happen, and a default of "don't re-draw" is precisely the defect this
 * argument was added to close.
 *
 * THE RE-DRAW, which is the whole subtlety of this function.
 * `cancelScheduledValues(at)` runs first so the release does not fight the
 * still-queued attack or decay ramp — but it removes every event at time
 * >= `at`, and a ramp is only anchored by its END event. Removing that end
 * event removes the whole ramp, including the part before `at`. In realtime
 * that used to be harmless reasoning — the past has already been rendered, so
 * nothing can retroactively change it — and the reasoning was WRONG, because
 * the cancel does not run at `at`. It runs when `triggerSynthNoteOff` is
 * called, and every sequenced player books its note-off in the same breath as
 * its note-on, one `CLOCK_LOOKAHEAD` (0.1 s) ahead of the note sounding
 * (`chordPlayback.ts`, `arpPlayback.ts`, `voiceManager.ts`). So for every
 * sequenced note — which is most of what this app plays — the attack and decay
 * ramps were erased before a sample of them had been rendered, and the param
 * held its pre-ramp value FLAT for the whole note, then stepped down at the
 * release. Measured on the amp envelope: +4.1 dB, with the ENV2 filter and
 * pitch contours flattened the same way. Only a live key-up was ever safe.
 *
 * A single `linearRampToValueAtTime(heldValue, at)`, laid down after the cancel
 * and before the anchor, restores it EXACTLY — not approximately. Three facts
 * make "exactly" the right word:
 *  - `scheduleAdsr` draws nothing but straight lines, deliberately (see this
 *    module's top comment), so the erased curve is a straight line;
 *  - the events that SURVIVE the cancel end at the last breakpoint before
 *    `at`, and a straight line from that breakpoint to (`at`, `heldValue`) is
 *    the same straight line the cancel removed;
 *  - `heldValue` is computed by `envelopeValueAt`, which is `scheduleAdsr`'s
 *    own inverse and is pinned to it by this module's tests.
 * If either envelope ever gains a curved segment, this re-draw stops being
 * exact and has to become a `setValueCurveAtTime` — that is the tripwire, and
 * it is why the straight-line rule above is not merely a convenience.
 *
 * It is skipped when `at <= contourStartedAt`: nothing survived the cancel to
 * ramp FROM, and no time has elapsed for a segment to exist in. That case is
 * reachable and is not an edge — a sequencer books a note-off ahead, then a
 * loop load calls `stopSource` at the current time, which is earlier.
 *
 * `setValueAtTime(heldValue, at)` then re-anchors the curve at that instant
 * before the release ramp starts from it — kept even when the re-draw already
 * lands there, because it is what states the release's starting value in the
 * skipped case too. The final `linearRampToValueAtTime(base, …)` is what
 * reaches genuine silence and terminates — the two things
 * `setTargetAtTime(0, …)` alone never does (see this module's top comment).
 */
export function releaseScheduledParam(
  param: AutomationParam,
  at: number,
  seconds: number,
  heldValue: number,
  contourStartedAt: number,
): void {
  releaseScheduledParamTo(param, at, seconds, 0, heldValue, contourStartedAt);
}

/**
 * `releaseScheduledParam` generalised to a `base` other than silence, for the
 * ENV2 destinations whose unmodulated value is NOT zero — a filter cutoff, a
 * Q, an oscillator level, a pan position. Releasing one of those to 0 would
 * not be "stop modulating", it would be "close the filter to 0 Hz" or "mute
 * the oscillator"; what note-off means for a modulation route is that the
 * contour walks back to where the patch says the destination sits with no
 * modulation at all.
 *
 * The two names are kept apart rather than collapsed into one defaulted
 * argument: `releaseScheduledParam` means "release to silence", which is a
 * claim about the amp envelope that must stay true and must stay readable at
 * its call site. Reaching silence by leaving an argument off is how the
 * whole-bus-release defect recorded in ADR-0017 came to exist.
 */
export function releaseScheduledParamTo(
  param: AutomationParam,
  at: number,
  seconds: number,
  base: number,
  heldValue: number,
  contourStartedAt: number,
): void {
  param.cancelScheduledValues(at);
  // Re-draw the segment the cancel erased. See `releaseScheduledParam`'s
  // docblock for why one straight line restores it exactly, and why skipping
  // it when nothing preceded `at` is correct rather than a missed case.
  if (at > contourStartedAt) param.linearRampToValueAtTime(heldValue, at);
  param.setValueAtTime(heldValue, at);
  param.linearRampToValueAtTime(base, at + Math.max(0, seconds));
}
