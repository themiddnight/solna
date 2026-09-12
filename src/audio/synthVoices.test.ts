import { describe, expect, spyOn, test } from 'bun:test';
import { freshEngine, makeEngine } from './testFakes';
import { SYNTH } from './engineTestHelpers';

/**
 * Synth voice lifecycle: note on/off, release, stop, dedup, caps and reshaping.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- the engine exports no
   internals; these tests drive the private subsystem fields and the
   unexported constructor via casts. */

describe('scheduled chord hits', () => {
  test('a second same-note hit does not cancel the first voice envelope at scheduling time', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // A multi-hit chord pattern schedules all hits in one burst, e.g. two
    // hits of the same note 0.5 s apart, each released shortly after.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.25, 'chord');
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.5, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.75, 'chord');

    // The first voice's envelope may only be cancelled by its OWN scheduled
    // release (t0 + 0.25). A cancel at t0 means the dedup released the still-
    // tracked first voice immediately, silencing the hit before it sounds.
    const firstVoiceGain = ctx._gains[0].gain;
    expect(firstVoiceGain.cancels).not.toContain(t0);
    expect(firstVoiceGain.cancels).toContain(t0 + 0.25);
  });
});

describe('live param updates', () => {
  test('a chord voice scheduled ahead stays tracked so param updates reach it', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 2, 'chord');

    const voice = (engine as any).synthVoices.activeVoices.get('chord:C4');
    expect(voice).toBeTruthy();

    engine.updateSynthParams({ ...SYNTH, oscType: 'sine' }, 'chord');
    expect(voice.oscs[0].type).toBe('sine');
  });

  test('updateSynthParams leaves a voice whose release has already started', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 - 1, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0, 'chord');

    const voice = (engine as any).synthVoices.activeVoices.get('chord:C4');
    expect(voice).toBeTruthy();

    engine.updateSynthParams({ ...SYNTH, oscType: 'triangle' }, 'chord');
    expect(voice.oscs[0].type).toBe('sawtooth');
  });

  test('updateSynthParams leaves a voice scheduled in the future untouched', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // A voice starting 1 s ahead with its full envelope (attack ramps and the
    // note-off release) already planned.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 1, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 3, 'chord');

    const voice = (engine as any).synthVoices.activeVoices.get('chord:C4');
    expect(voice).toBeTruthy();

    engine.updateSynthParams({ ...SYNTH, oscType: 'sine' }, 'chord');

    // Re-targeting a not-yet-started voice would cancel its planned envelope;
    // it must keep the params it was scheduled with.
    expect(voice.oscs[0].type).toBe('sawtooth');
    expect(voice.filter.frequency.cancels).not.toContain(t0);
  });
});

describe('pending release re-arming', () => {
  // A sustained chord is one long voice whose note-off sits seconds ahead on
  // the audio clock. Its release ramp is planned at note-on time, so turning
  // the Release knob mid-chord only reaches it if the pending ramp is re-armed.
  test('re-arms a release ramp that has not started with the new release time', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 4, 'chord');

    const vca = ctx._gains[0].gain;
    vca.ramps.length = 0;

    engine.updateSynthParams({ ...SYNTH, release: 2 }, 'chord');

    expect(vca.ramps.at(-1)).toEqual({ v: 0.00001, t: t0 + 4 + 2 });
  });

  test('restores the filter release ramp a live timbre update would otherwise cancel', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 4, 'chord');

    const voice = (engine as any).synthVoices.activeVoices.get('chord:C4');
    voice.filter.frequency.ramps.length = 0;

    engine.updateSynthParams({ ...SYNTH, filterCutoff: 800 }, 'chord');

    // cancelAndHold at currentTime wipes the planned filter release; the
    // re-arm puts it back, now targeting the newly set cutoff.
    expect(voice.filter.frequency.ramps.at(-1)).toEqual({
      v: 800,
      t: t0 + 4 + SYNTH.filterRelease,
    });
  });

  test('leaves a release that has already started alone', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 - 2, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 - 1, 'chord');

    const vca = ctx._gains[0].gain;
    vca.ramps.length = 0;

    engine.updateSynthParams({ ...SYNTH, release: 2 }, 'chord');

    // Re-targeting a fade already in flight would make it jump.
    expect(vca.ramps).toEqual([]);
  });

  test('a live param update reaches the sounding voice even when a later same-note hit replaced it in the dedup map', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // Chord pattern with a repeated note: the second hit is pre-scheduled, so
    // the dedup map points at it while the first hit is the one sounding now.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.3, 'chord');
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.5, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.8, 'chord');

    // The first hit is sounding right now (t0 + 0.15 < its release at t0 + 0.3).
    ctx.currentTime = t0 + 0.15;
    engine.updateSynthParams({ ...SYNTH, oscType: 'sine' }, 'chord');

    const voices = Array.from(
      (engine as any).synthVoices.sourceVoices.get('chord') as Set<{ startTime: number; oscs: { type: string }[] }>,
    );
    const sounding = voices.filter((v) => v.startTime <= ctx.currentTime);
    expect(sounding.length).toBe(1);
    expect(sounding[0].oscs[0].type).toBe('sine');
  });

  test('retriggering a live synth note still releases the old voice immediately', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'synth', 1, 'live');
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'synth', 1, 'live');

    const oldVoiceGain = ctx._gains[0].gain;
    expect(oldVoiceGain.cancels).toContain(t0);
  });
});

describe('bass retrigger', () => {
  test('same-note retrigger releases the old voice at the new note start, not immediately', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C2', SYNTH, 0.8, t0, 'bass', 1, 'live');
    engine.triggerSynthNoteOff('C2', SYNTH.release, t0 + 1, 'bass');
    engine.triggerSynthNoteOn('C2', SYNTH, 0.8, t0 + 0.5, 'bass', 1, 'live');

    // The old voice stays tracked until its teardown (mono needs that), and
    // its release must be aimed at the new note's start (t0 + 0.5) — never at
    // scheduling time (t0).
    const oldVoice = (engine as any).synthVoices.activeVoices.get('bass:C2');
    expect(oldVoice).toBeTruthy();
    const oldVoiceGain = ctx._gains[0].gain;
    expect(oldVoiceGain.cancels).toContain(t0 + 0.5);
    expect(oldVoiceGain.cancels).not.toContain(t0);
  });

  // peakGain is velocity * 0.4 * scaleFactor; sustainLevel is that times the
  // patch's Sustain. Written out rather than imported because the point of
  // these two tests is that the gain must never be RE-ANCHORED at this value.
  const PEAK_GAIN = 0.8 * 0.4;
  const SUSTAIN_LEVEL = PEAK_GAIN * SYNTH.sustain;

  test('a second release on an already-fading voice never lifts its gain back to sustain', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // attack 0.02 + decay 0.4, so the amp envelope is past sustain by t0 + 0.42
    // and every release below takes releaseVoice's "past the envelope" branch.
    engine.triggerSynthNoteOn('C2', SYNTH, 0.8, t0, 'bass', 1, 'live');
    const gain = ctx._gains[0].gain;

    engine.triggerSynthNoteOff('C2', 0.05, t0 + 1, 'bass');
    expect(gain.valueAt(t0 + 1.05)).toBeLessThan(1e-4);

    // The voice stays tracked until its teardown timer fires, so a later kill
    // still finds it — by then it has faded to SILENCE. Anchoring it at
    // sustainLevel there jumps the gain from silence to full in ONE sample:
    // a click on every note, loudest with Sustain at max. The in-flight (here,
    // finished) release ramp is what the second release must hold instead.
    engine.triggerSynthNoteOff('C2', 0.05, t0 + 2, 'bass');
    expect(gain.valueAt(t0 + 2)).toBeLessThan(1e-4);
    for (const e of gain.events.filter((ev) => ev.t >= t0 + 2)) {
      expect(e.v).toBeLessThan(SUSTAIN_LEVEL);
    }
  });

  test('a new bass note re-kills only the bass voices that are not already fading', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const bassVoices = () =>
      Array.from((engine as any).synthVoices.sourceVoices.get('bass') as Set<any>);

    // C2 is released and left to fade; E2 is held with its note-off still
    // ahead on the clock.
    engine.triggerSynthNoteOn('C2', SYNTH, 0.8, t0, 'bass', 1, 'live');
    engine.triggerSynthNoteOff('C2', 0.05, t0 + 0.5, 'bass');
    engine.triggerSynthNoteOn('E2', SYNTH, 0.8, t0 + 1, 'bass', 1, 'live');
    engine.triggerSynthNoteOff('E2', SYNTH.release, t0 + 5, 'bass');

    const c2 = bassVoices().find((v) => v.noteName === 'C2');
    const e2 = bassVoices().find((v) => v.noteName === 'E2');

    engine.triggerSynthNoteOn('G2', SYNTH, 0.8, t0 + 2, 'bass', 1, 'live');

    // C2's release has already STARTED: killing it again would only reset its
    // teardown timer and re-run its ramps.
    expect(c2.gains[0].gain.cancels).not.toContain(t0 + 2);
    // E2's release is still AHEAD of the new note, so monophony needs it cut
    // short there — otherwise a long scheduled note rings under the new one.
    expect(e2.gains[0].gain.cancels).toContain(t0 + 2);
  });
});

describe("source stop (preview release)", () => {
  test('stopSource releases the sounding hit and hard-silences future-scheduled pattern hits', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // A multi-hit pattern pre-schedules all hits at once (as
    // scheduleBarInvariantEvents does): two same-note hits plus another note.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.25, 'chord');
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.5, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.75, 'chord');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.8, t0 + 0.5, 'chord', 1, 'live');
    engine.triggerSynthNoteOn('F2', SYNTH, 0.8, t0, 'bass', 1, 'live');

    const chordVoicesBefore = Array.from(
      (engine as any).synthVoices.sourceVoices.get('chord') as Set<{ startTime: number; gains: { gain: { cancels: number[]; events: { v: number }[] } }[] }>,
    );
    expect(chordVoicesBefore).toHaveLength(3);
    const soundingVoice = chordVoicesBefore.find((v) => v.startTime <= t0)!;
    const futureVoices = chordVoicesBefore.filter((v) => v.startTime > t0);
    expect(futureVoices).toHaveLength(2);

    // Releasing the preview must cut the whole chord pattern immediately.
    engine.stopSource('chord', 0.15);

    // The sounding hit gets a normal release ramp, cancelled at now.
    expect(soundingVoice.gains[0].gain.cancels).toContain(t0);

    // A future hit's oscillators have not started: a release RAMP on it
    // finishes before they do, leaving the GainNode at its intrinsic 1.0 (the
    // ~3x-peak pop this task fixes). It is hard-silenced and torn out of
    // tracking instead, so it must not remain in sourceVoices.
    const chordVoicesAfter = (engine as any).synthVoices.sourceVoices.get('chord') as Set<unknown>;
    expect(chordVoicesAfter.size).toBe(1);
    expect(chordVoicesAfter.has(soundingVoice)).toBe(true);
    for (const v of futureVoices) {
      expect(chordVoicesAfter.has(v)).toBe(false);
      expect(v.gains[0].gain.cancels).toContain(t0);
      expect(v.gains[0].gain.events.at(-1)!.v).toBe(0);
    }

    // The bass voice is untouched.
    const bassVoices = (engine as any).synthVoices.sourceVoices.get('bass') as Set<{ gains: { gain: { cancels: number[] } }[] }>;
    expect(bassVoices.size).toBe(1);
    for (const v of bassVoices) {
      expect(v.gains[0].gain.cancels).not.toContain(t0);
    }
  });

  // stopSource delegates to the shared stopVoicesOf body with `owner`
  // deliberately `undefined`. If that ever changed to pass a literal owner
  // instead, every other stopSource test here uses only 'live' voices and
  // would still pass — this is the one that would catch it.
  test('stopSource releases every owner on the bus, not just one', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.8, t0, 'chord', 1, 'sequencer');

    const chordVoices = Array.from(
      (engine as any).synthVoices.sourceVoices.get('chord') as Set<{ owner: string; releaseScheduledAt?: number }>,
    );
    expect(chordVoices).toHaveLength(2);
    const liveVoice = chordVoices.find((v) => v.owner === 'live')!;
    const sequencerVoice = chordVoices.find((v) => v.owner === 'sequencer')!;
    expect(liveVoice.releaseScheduledAt).toBeUndefined();
    expect(sequencerVoice.releaseScheduledAt).toBeUndefined();

    engine.stopSource('chord', 0.15);

    expect(liveVoice.releaseScheduledAt).toBe(t0);
    expect(sequencerVoice.releaseScheduledAt).toBe(t0);
  });
});

describe("source stop against a fading voice and a short release", () => {

  // Rapid preview clicks: every click stops the source before re-triggering,
  // so a stop lands on voices that are already fading from the PREVIOUS stop.
  // Re-releasing those re-arms their teardown timer, which is what kept a
  // silent voice in sourceVoices for as long as clicks kept arriving.
  test('a stop leaves a voice already fading at least as fast alone', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    const voice = Array.from(
      (engine as any).synthVoices.sourceVoices.get('chord') as Set<any>,
    )[0];

    engine.stopSource('chord', 0.15);
    const teardownAt = voice.teardownAt;
    const cancelCount = voice.gains[0].gain.cancels.length;

    ctx.currentTime = t0 + 0.05;
    engine.stopSource('chord', 0.15);

    expect(voice.teardownAt).toBe(teardownAt);
    expect(voice.gains[0].gain.cancels).toHaveLength(cancelCount);
  });

  test('a stop shorter than the pending release still cuts the voice', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    const voice = Array.from(
      (engine as any).synthVoices.sourceVoices.get('chord') as Set<any>,
    )[0];

    engine.stopSource('chord', 2);
    const teardownAt = voice.teardownAt;

    engine.stopSource('chord', 0.05);

    expect(voice.teardownAt).toBeLessThan(teardownAt);
    expect(voice.gains[0].gain.ramps.at(-1).t).toBe(t0 + 0.05);
  });

  // The symptom this guards: past maxVoicesPerSource, stealOldestVoice can
  // only steal voices with no release planned — which are the notes of the
  // chord being played RIGHT NOW — so every click but the last note went
  // silent and the preview collapsed to a single note.
  // Real timers, and ctx.currentTime advanced in lockstep with them: the
  // teardown that drains a released voice out of sourceVoices runs on the wall
  // clock, so a synchronous loop would show the same unbounded growth whether
  // the bug is present or not.
  test('repeated held previews keep sounding the whole chord', async () => {
    const { engine, ctx } = freshEngine();
    const notes = ['C4', 'E4', 'G4', 'B4'];
    const step = async (seconds: number) => {
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      ctx.currentTime += seconds;
    };
    const chordVoices = () => (engine as any).synthVoices.sourceVoices.get('chord') as Set<any>;

    // Eight presses a second — playChordLegato stops the source on the press
    // and ChordView stops it again on the release.
    for (let click = 0; click < 10; click++) {
      engine.stopSource('chord', 0.05);
      for (const note of notes) engine.triggerSynthNoteOn(note, SYNTH, 0.8, undefined, 'chord', 1, 'live');
      const sounding = Array.from(chordVoices()).filter(
        (v) => v.releaseScheduledAt === undefined,
      );
      expect(sounding.map((v) => v.noteName).sort()).toEqual([...notes].sort());
      await step(0.06);
      engine.stopSource('chord', 0.15);
      await step(0.06);
    }

    await step(0.4);
    expect(chordVoices().size).toBe(0);
  });
});

describe('scheduled source stop (soft stop on a bar line)', () => {
  test('a future time anchors the release there, not at currentTime', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime; // 10

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.5, 'chord', 1, 'live');

    // Schedule the stop a bar ahead, the way a soft stop does.
    const stopAt = t0 + 2;
    engine.stopSource('chord', 0.4, stopAt);

    const voices = Array.from(
      (engine as any).synthVoices.sourceVoices.get('chord') as Set<{
        releaseScheduledAt: number;
        gains: { gain: { cancels: number[] } }[];
      }>,
    );
    expect(voices).toHaveLength(1);
    expect(voices[0].releaseScheduledAt).toBe(stopAt);
    // releaseVoice cancels the envelope at the SAME anchor it ramps from.
    expect(voices[0].gains[0].gain.cancels).toContain(stopAt);
    expect(voices[0].gains[0].gain.cancels).not.toContain(t0);
  });

  test('omitting time keeps the existing immediate behaviour', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    engine.stopSource('chord', 0.02);

    const voices = Array.from(
      (engine as any).synthVoices.sourceVoices.get('chord') as Set<{ releaseScheduledAt: number }>,
    );
    expect(voices[0].releaseScheduledAt).toBe(t0);
  });
});

describe('releaseSoundingVoices', () => {
  test('a voice the clock scheduled ahead keeps its envelope', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // The arpeggiator schedules the next note on a future 16th and pairs it
    // with its own note-off, so the voice already ends by itself.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0 + 0.5, 'synth', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.6, 'synth');

    // The key comes up before that note sounds.
    engine.releaseSoundingVoices('synth', 0.1, 'live');

    // Cancelling at t0 would wipe the scheduled attack and the note would
    // never be heard — only its own release at t0 + 0.6 may touch it.
    const scheduledVoiceGain = ctx._gains[0].gain;
    expect(scheduledVoiceGain.cancels).not.toContain(t0);
    expect(scheduledVoiceGain.cancels).toContain(t0 + 0.6);
  });

  test('a voice that is already sounding is released', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0, 'synth', 1, 'live');
    engine.releaseSoundingVoices('synth', 0.1, 'live');

    const soundingVoiceGain = ctx._gains[0].gain;
    expect(soundingVoiceGain.cancels).toContain(t0);
  });

  test('a future voice with no release of its own is still released', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // No paired note-off: nothing would ever end this voice, so it must not
    // be skipped or it would drone forever.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0 + 0.5, 'synth', 1, 'live');
    engine.releaseSoundingVoices('synth', 0.1, 'live');

    expect(ctx._gains[0].gain.cancels).toContain(t0);
  });

  test('voices of other sources are left alone', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0, 'synth', 1, 'live');
    engine.releaseSoundingVoices('chord', 0.1, 'live');

    expect(ctx._gains[0].gain.cancels).not.toContain(t0);
  });

  test('leaves a voice of another owner untouched', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // Two players on ONE bus — the exact situation this whole change exists
    // for. The lead track's engine source is 'synth' and the arp plays
    // whichever bus focusTrack names, so an arp key-up used to cut the
    // melody track's sounding note short.
    // Different note names: the same-note dedup would release the first
    // voice before the second existed, and there would be nothing to assert.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0, 'synth', 1, 'arp');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.9, t0, 'synth', 1, 'sequencer');

    const voices = [...((engine as any).synthVoices.sourceVoices.get('synth') as Set<any>)];
    const arpVoice = voices.find((v) => v.owner === 'arp');
    const seqVoice = voices.find((v) => v.owner === 'sequencer');

    // The NEGATIVE half is the load-bearing one: a test that only checks the
    // arp voice got its ramp stays green with the owner filter deleted.
    const seqGain = seqVoice.gains[0].gain;
    const before = {
      events: seqGain.events.length,
      targets: seqGain.targets.length,
      cancels: seqGain.cancels.length,
    };

    engine.releaseSoundingVoices('synth', 0.1, 'arp');

    // Asserting on the recorded arrays, never valueAt(): release ramps use
    // setTargetAtTime and fakeParam.valueAt THROWS on such a timeline.
    expect(arpVoice.gains[0].gain.cancels).toContain(t0);
    expect(arpVoice.releaseScheduledAt).toBe(t0);

    expect(seqGain.events.length).toBe(before.events);
    expect(seqGain.targets.length).toBe(before.targets);
    expect(seqGain.cancels.length).toBe(before.cancels);
    expect(seqVoice.releaseScheduledAt).toBeUndefined();
  });

  test("another owner's future-scheduled voice is not hard-silenced", () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // A future voice with no release of its own is the case the owner-blind
    // path hard-silences via silenceVoiceNow — which also removes it from
    // sourceVoices, so the sequencer's next note would never sound.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0 + 0.5, 'synth', 1, 'sequencer');

    engine.releaseSoundingVoices('synth', 0.1, 'arp');

    const voices = [...((engine as any).synthVoices.sourceVoices.get('synth') as Set<any>)];
    expect(voices.length).toBe(1);
    expect(voices[0].gains[0].gain.cancels).not.toContain(t0);
  });

  test('stopSource still kills a scheduled voice, so pattern previews stop dead', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0 + 0.5, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.6, 'chord');
    engine.stopSource('chord', 0.1);

    expect(ctx._gains[0].gain.cancels).toContain(t0);
  });
});

describe('stopOwnedVoices', () => {
  test("leaves another owner's sounding voice untouched", () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0, 'synth', 1, 'sequencer');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.9, t0, 'synth', 1, 'live');

    const voices = [...((engine as any).synthVoices.sourceVoices.get('synth') as Set<any>)];
    const seqVoice = voices.find((v) => v.owner === 'sequencer');
    const liveVoice = voices.find((v) => v.owner === 'live');

    const liveGain = liveVoice.gains[0].gain;
    const before = {
      events: liveGain.events.length,
      targets: liveGain.targets.length,
      cancels: liveGain.cancels.length,
    };

    engine.stopOwnedVoices('synth', 'sequencer', 0.02);

    expect(seqVoice.gains[0].gain.cancels).toContain(t0);
    expect(seqVoice.releaseScheduledAt).toBe(t0);

    // The load-bearing half: stopping a melody grid must not cut the key the
    // player is holding down. No new automation of ANY kind on that voice.
    expect(liveGain.events.length).toBe(before.events);
    expect(liveGain.targets.length).toBe(before.targets);
    expect(liveGain.cancels.length).toBe(before.cancels);
    expect(liveVoice.releaseScheduledAt).toBeUndefined();
  });

  test("leaves another owner's future-scheduled voice in place", () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // This is the case a whole-bus stop DESTROYS: stopSource hard-silences a
    // future voice through silenceVoiceNow, which also drops it from
    // sourceVoices — so an arp note the clock has already queued would never
    // sound, and it is unrecoverable rather than merely early.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0 + 0.5, 'synth', 1, 'arp');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.9, t0, 'synth', 1, 'sequencer');

    const arpVoice = [...((engine as any).synthVoices.sourceVoices.get('synth') as Set<any>)]
      .find((v) => v.owner === 'arp');
    const arpGain = arpVoice.gains[0].gain;
    const beforeEvents = arpGain.events.length;

    engine.stopOwnedVoices('synth', 'sequencer', 0.02);

    expect(arpGain.events.length).toBe(beforeEvents);
    expect(arpGain.cancels).not.toContain(t0);
  });

  test('an unknown source and a context-less engine are both no-ops', () => {
    const { engine } = freshEngine();
    expect(() => engine.stopOwnedVoices('nope', 'arp', 0.02)).not.toThrow();
    const bare = makeEngine();
    expect(() => bare.stopOwnedVoices('synth', 'arp', 0.02)).not.toThrow();
  });
});

describe('scheduled same-note dedup', () => {
  test('a scheduled repeat cuts the previous voice at the new note start, not at currentTime', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.1, 'synth', 1, 'live');
    const first = (engine as any).synthVoices.activeVoices.get('synth:C4');
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.5, 'synth', 1, 'live');

    // The bass path at engine.ts:394 forwards `time`; this one did not, so the
    // old voice was cut up to a full 100 ms lookahead before the new one began.
    expect(first.releaseScheduledAt).toBe(t0 + 0.5);
  });
});

describe('releasing a voice that has not started', () => {
  test('stopSource hard-silences a future voice instead of ramping it', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.1, 'chord', 1, 'live');
    const voice = (engine as any).synthVoices.activeVoices.get('chord:C4');
    const vca = voice.gains[0].gain;
    // The note-on's own attack/decay ramps already sit in `ramps`; clear them
    // so the assertion below is about ramps stopSource itself schedules.
    vca.ramps.length = 0;

    engine.stopSource('chord', 0.1);

    // A release RAMP on a voice whose oscillators start at t0 + 0.1 finishes
    // before the note begins; the node then holds its last value and the hit
    // sounds at full level. Hard silence is the only correct treatment.
    expect(vca.events.at(-1)!.v).toBe(0);
    expect(vca.events.at(-1)!.t).toBe(t0);
    expect(vca.ramps).toHaveLength(0);
  });

  test('a future voice is torn down, not left tracked', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.1, 'chord', 1, 'live');
    engine.stopSource('chord', 0.1);

    expect((engine as any).synthVoices.sourceVoices.get('chord').size).toBe(0);
    expect((engine as any).synthVoices.activeVoices.has('chord:C4')).toBe(false);
  });

  test('a sounding voice still gets its release ramp', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 - 1, 'chord', 1, 'live');
    const vca = (engine as any).synthVoices.activeVoices.get('chord:C4').gains[0].gain;
    vca.ramps.length = 0;

    engine.stopSource('chord', 0.1);

    expect(vca.ramps.at(-1)).toEqual({ v: 0.00001, t: t0 + 0.1 });
  });

  test('releaseSoundingVoices hard-silences a future voice with no release of its own', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.1, 'synth', 1, 'live');
    const vca = (engine as any).synthVoices.activeVoices.get('synth:C4').gains[0].gain;
    // The note-on's own attack/decay ramps already sit in `ramps`; clear them
    // so the assertion below is about ramps releaseSoundingVoices schedules.
    vca.ramps.length = 0;

    engine.releaseSoundingVoices('synth', 0.1, 'live');

    expect(vca.ramps).toHaveLength(0);
    expect(vca.events.at(-1)!.v).toBe(0);
  });

  test('releaseSoundingVoices still leaves a future voice that already has a release', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.1, 'synth', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.3, 'synth');
    const vca = (engine as any).synthVoices.activeVoices.get('synth:C4').gains[0].gain;
    const before = vca.events.length;

    engine.releaseSoundingVoices('synth', 0.1, 'live');

    expect(vca.events.length).toBe(before);
  });
});

describe('re-planning a pending release', () => {
  test('a bass mono-kill keeps its 0.05 s release when the patch says 2 s', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const pad = { ...SYNTH, release: 2 };

    engine.triggerSynthNoteOn('C2', pad, 0.8, t0 - 1, 'bass', 1, 'live');
    const first = (engine as any).synthVoices.activeVoices.get('bass:C2');
    // The new bass note releases the old one with the mono-kill's 0.05 s.
    engine.triggerSynthNoteOn('E2', pad, 0.8, t0 + 1, 'bass', 1, 'live');
    expect(first.releaseTime).toBe(0.05);

    first.gains[0].gain.ramps.length = 0;
    engine.updateSynthParams(pad, 'bass');

    // Re-arming from params.release would stretch the kill to 2 s and let the
    // "stopped" note ring under the new one — bass monophony leaks.
    const ramp = first.gains[0].gain.ramps.at(-1);
    expect(ramp).toBeTruthy();
    expect(ramp!.t).toBeCloseTo(t0 + 1 + 0.05, 9);
  });

  test('a note released with the patch release re-arms with the NEW patch release', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 4, 'chord');
    const vca = (engine as any).synthVoices.activeVoices.get('chord:C4').gains[0].gain;
    vca.ramps.length = 0;

    engine.updateSynthParams({ ...SYNTH, release: 2 }, 'chord');

    // The pre-existing behaviour (engine.test.ts:275) must survive: a note-off
    // taken from params.release tracks the knob.
    expect(vca.ramps.at(-1)).toEqual({ v: 0.00001, t: t0 + 4 + 2 });
  });
});

describe('voice lifetime backstop', () => {
  // maxVoiceLifetimeMs is overridden via the same private-field cast
  // testFakes.ts documents (ctx, activeVoices, etc.) — waiting out the real
  // 30 s default would make this test take 30 s for no added coverage.
  test('a note-on with no matching note-off is torn down after maxVoiceLifetimeMs', async () => {
    const { engine, ctx } = freshEngine();
    (engine as any).synthVoices.maxVoiceLifetimeMs = 20;
    engine.triggerSynthNoteOn('C4', { ...SYNTH, filterRelease: 0.01 }, 0.8, ctx.currentTime, 'synth', 1, 'live');
    const voice = (engine as any).synthVoices.activeVoices.get('synth:C4');
    const stopped = spyOn(voice.oscs[0], 'stop');

    // Guard fires at 20 ms and calls releaseVoice(voice, 0.05, now), which
    // arms its own teardown timer of (max(0.05, 0.01) + 0.1) * 1000 = 150 ms
    // — wait past both.
    await new Promise((r) => setTimeout(r, 300));

    expect(stopped).toHaveBeenCalled();
    expect((engine as any).synthVoices.activeVoices.has('synth:C4')).toBe(false);
  });

  test('a voice released normally before the guard fires is never released twice', async () => {
    const { engine, ctx } = freshEngine();
    (engine as any).synthVoices.maxVoiceLifetimeMs = 50;
    engine.triggerSynthNoteOn(
      'C4',
      { ...SYNTH, release: 0.01, filterRelease: 0.01 },
      0.8,
      ctx.currentTime,
      'synth',
      1,
      'live',
    );
    const voice = (engine as any).synthVoices.activeVoices.get('synth:C4');
    const stopped = spyOn(voice.oscs[0], 'stop');

    // The real note-off's releaseScheduledAt is set synchronously, well
    // before the 50 ms guard fires, so the guard must see it and no-op.
    engine.triggerSynthNoteOff('C4', 0.01, undefined, 'synth');
    await new Promise((r) => setTimeout(r, 250));

    expect(stopped).toHaveBeenCalledTimes(1);
  });

  test('a still-scheduled future voice is not touched by an already-expired guard', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).synthVoices.maxVoiceLifetimeMs = 30_000;
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime + 5, 'synth', 1, 'live');
    const voice = (engine as any).synthVoices.activeVoices.get('synth:C4');

    expect(voice.lifetimeGuardTimer).toBeDefined();
    expect(voice.releaseScheduledAt).toBeUndefined();
  });

  test('a guard timer whose voice is no longer the current one for its key does not release it', async () => {
    const { engine, ctx } = freshEngine();
    (engine as any).synthVoices.maxVoiceLifetimeMs = 20;
    engine.triggerSynthNoteOn('C4', { ...SYNTH, filterRelease: 0.01 }, 0.8, ctx.currentTime, 'synth', 1, 'live');
    const staleVoice = (engine as any).synthVoices.activeVoices.get('synth:C4');
    const staleStopped = spyOn(staleVoice.oscs[0], 'stop');

    // Force the exact stale state the identity check exists for: something
    // other than a normal release/retrigger has swapped the map entry for
    // this key out from under staleVoice, WITHOUT going through
    // triggerSynthNoteOff, so staleVoice.releaseScheduledAt is still
    // undefined when the guard fires. Every real caller today releases the
    // outgoing voice synchronously before overwriting the entry, so this can
    // only be reached in a test by writing the map directly.
    const replacement = { ...staleVoice };
    (engine as any).synthVoices.activeVoices.set('synth:C4', replacement);
    expect(staleVoice.releaseScheduledAt).toBeUndefined();

    // Wait past the 20 ms guard AND the ~150 ms teardown delay releaseVoice
    // would arm if it ran (max(release, filterRelease) + 0.1 s, scaled to
    // ms). Without the activeVoices identity check, the guard would see
    // releaseScheduledAt still undefined and release staleVoice anyway, even
    // though it is no longer the voice this key refers to.
    await new Promise((r) => setTimeout(r, 300));

    expect(staleStopped).not.toHaveBeenCalled();
  });

  test('a voice released by the guard is no longer reshapeable during its release tail', async () => {
    const { engine, ctx } = freshEngine();
    (engine as any).synthVoices.maxVoiceLifetimeMs = 20;
    engine.triggerSynthNoteOn('C4', { ...SYNTH, filterRelease: 0.01 }, 0.8, ctx.currentTime, 'synth', 1, 'live');
    const voice = (engine as any).synthVoices.activeVoices.get('synth:C4');

    // Wait past the 20 ms guard but well inside the ~150 ms teardown window
    // releaseVoice arms (max(0.05, 0.01) + 0.1 s), so the voice is still
    // tracked and mid release tail when we probe it.
    await new Promise((r) => setTimeout(r, 60));

    const sustainBefore = voice.sustainLevel;
    engine.applySynthVelocityScale(0.3, 'synth');

    expect((engine as any).synthVoices.reshapeableVoices()).not.toContain(voice);
    expect(voice.sustainLevel).toBe(sustainBefore);
  });
});

describe('voice cap', () => {
  test('exceeding maxVoicesPerSource steals the oldest already-started voice', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).synthVoices.maxVoicesPerSource = 3;
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    engine.triggerSynthNoteOn('D4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    const oldest = (engine as any).synthVoices.activeVoices.get('synth:C4');
    expect(oldest.releaseScheduledAt).toBeUndefined();

    engine.triggerSynthNoteOn('F4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');

    expect(oldest.releaseScheduledAt).toBeDefined();
    const newest = (engine as any).synthVoices.activeVoices.get('synth:F4');
    expect(newest.releaseScheduledAt).toBeUndefined();
  });

  test('a voice scheduled into the future is never stolen', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).synthVoices.maxVoicesPerSource = 2;
    const future = ctx.currentTime + 5;
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, future, 'synth', 1, 'live');
    engine.triggerSynthNoteOn('D4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');

    const futureVoice = (engine as any).synthVoices.activeVoices.get('synth:C4');
    const middleVoice = (engine as any).synthVoices.activeVoices.get('synth:D4');
    expect(futureVoice.releaseScheduledAt).toBeUndefined();
    expect(middleVoice.releaseScheduledAt).toBeDefined();
  });

  test('a second steal after the first one picks a different, newer voice', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).synthVoices.maxVoicesPerSource = 2;
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    engine.triggerSynthNoteOn('D4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    const first = (engine as any).synthVoices.activeVoices.get('synth:C4');
    const firstReleasedAt = first.releaseScheduledAt;
    expect(firstReleasedAt).toBeDefined();

    engine.triggerSynthNoteOn('G4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');

    const second = (engine as any).synthVoices.activeVoices.get('synth:D4');
    expect(second.releaseScheduledAt).toBeDefined();
    expect(first.releaseScheduledAt).toBe(firstReleasedAt);
    const newest = (engine as any).synthVoices.activeVoices.get('synth:G4');
    expect(newest.releaseScheduledAt).toBeUndefined();
  });

  test('a voice already releasing is never stolen a second time', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).synthVoices.maxVoicesPerSource = 2;
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    engine.triggerSynthNoteOff('C4', 0.3, ctx.currentTime, 'synth');
    const releasing = (engine as any).synthVoices.activeVoices.get('synth:C4');
    const releasedAt = releasing.releaseScheduledAt;

    engine.triggerSynthNoteOn('D4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');

    expect(releasing.releaseScheduledAt).toBe(releasedAt);
  });
});

describe('bass mono kill iterates the bass voice set, not every active voice', () => {
  test('a new bass note releases the previous bass voice and leaves other sources alone', () => {
    const { engine, ctx } = freshEngine();
    const e = engine as any;

    e.synthVoices.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'chord', 1, 'live');
    e.synthVoices.triggerSynthNoteOn('E4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    e.synthVoices.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'bass', 1, 'live');

    const oldBass = e.synthVoices.activeVoices.get('bass:C2');
    expect(oldBass).toBeTruthy();
    expect(oldBass.releaseScheduledAt).toBeUndefined();

    e.synthVoices.triggerSynthNoteOn('G2', SYNTH, 0.8, ctx.currentTime, 'bass', 1, 'live');

    // The previous bass voice was released...
    expect(oldBass.releaseScheduledAt).toBe(ctx.currentTime);
    // ...and nothing else was touched.
    expect(e.synthVoices.activeVoices.get('chord:C4').releaseScheduledAt).toBeUndefined();
    expect(e.synthVoices.activeVoices.get('synth:E4').releaseScheduledAt).toBeUndefined();
  });

  test('a bass voice whose release has already started is not re-released', () => {
    const { engine, ctx } = freshEngine();
    const e = engine as any;

    e.synthVoices.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'bass', 1, 'live');
    e.synthVoices.triggerSynthNoteOff('C2', 0.2, ctx.currentTime, 'bass');
    const dying = e.synthVoices.activeVoices.get('bass:C2');
    const cancelsBefore = dying.gains[0].gain.cancels.length;

    e.synthVoices.triggerSynthNoteOn('G2', SYNTH, 0.8, ctx.currentTime, 'bass', 1, 'live');

    expect(dying.gains[0].gain.cancels.length).toBe(cancelsBefore);
  });

  test('a bass voice whose release is scheduled in the FUTURE is still cut short', () => {
    const { engine, ctx } = freshEngine();
    const e = engine as any;

    e.synthVoices.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'bass', 1, 'live');
    // Release planned one second ahead — a long scheduled note that would
    // otherwise ring through the new one and break monophony.
    e.synthVoices.triggerSynthNoteOff('C2', 0.2, ctx.currentTime + 1, 'bass');
    const pending = e.synthVoices.activeVoices.get('bass:C2');
    expect(pending.releaseScheduledAt).toBe(ctx.currentTime + 1);

    e.synthVoices.triggerSynthNoteOn('G2', SYNTH, 0.8, ctx.currentTime, 'bass', 1, 'live');

    expect(pending.releaseScheduledAt).toBe(ctx.currentTime);
  });

  test('a superseded bass voice of the same note is not double-released', () => {
    // sourceVoices keeps every live-or-releasing voice; activeVoices keeps
    // only the latest per key. Iterating sourceVoices without the identity
    // guard would call triggerSynthNoteOff('C2') twice for the same note.
    const { engine, ctx } = freshEngine();
    const e = engine as any;

    e.synthVoices.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'bass', 1, 'live');
    const superseded = e.synthVoices.activeVoices.get('bass:C2');
    e.synthVoices.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'bass', 1, 'live');
    const current = e.synthVoices.activeVoices.get('bass:C2');
    expect(current).not.toBe(superseded);

    const currentCancels = current.gains[0].gain.cancels.length;
    e.synthVoices.triggerSynthNoteOn('G2', SYNTH, 0.8, ctx.currentTime, 'bass', 1, 'live');

    // Exactly one release reached the current C2 voice.
    expect(current.gains[0].gain.cancels.length).toBe(currentCancels + 1);
  });

  test('a sourceVoices entry whose activeVoices slot was reassigned to a different real voice is left alone', () => {
    // The identity guard exists for a write path that has never shipped on
    // this branch: something replacing the activeVoices slot for a `bass:`
    // key with a different voice without going through triggerSynthNoteOff
    // (the only real path, which always sets releaseScheduledAt on the OLD
    // occupant first). Constructed directly here via the sanctioned
    // (engine as any) cast, since no real note-on/note-off sequence reaches
    // this state: a full real voice is planted in the slot the stale
    // sourceVoices entry still believes is its own.
    const { engine, ctx } = freshEngine();
    const e = engine as any;

    e.synthVoices.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'bass', 1, 'live');
    const stale = e.synthVoices.activeVoices.get('bass:C2');
    expect(stale.releaseScheduledAt).toBeUndefined();

    // A real voice, built the normal way but under a different source so
    // creating it does not run the bass mono-kill against `stale`.
    e.synthVoices.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    const occupant = e.synthVoices.activeVoices.get('synth:C2');
    const occupantCancelsBefore = occupant.gains[0].gain.cancels.length;

    // Reassign the bass:C2 slot to this unrelated real voice, bypassing
    // triggerSynthNoteOff entirely.
    e.synthVoices.activeVoices.set('bass:C2', occupant);

    e.synthVoices.triggerSynthNoteOn('G2', SYNTH, 0.8, ctx.currentTime, 'bass', 1, 'live');

    // The identity guard must refuse to act on `stale` because it no longer
    // matches its own activeVoices slot — and, critically, must not release
    // whatever real voice DOES occupy that slot either.
    expect(occupant.releaseScheduledAt).toBeUndefined();
    expect(occupant.gains[0].gain.cancels.length).toBe(occupantCancelsBefore);
  });
});

describe('voice provenance', () => {
  test('the owner passed at note-on is stored on the voice', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'synth', 1, 'arp');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.8, t0, 'synth', 1, 'sequencer');

    const voices = [...((engine as any).synthVoices.sourceVoices.get('synth') as Set<any>)];
    // Two voices, two owners: the field is per-voice, not per-source. A
    // per-source record would make both read the same and every scoped
    // release in Tasks 3 and 4 either a no-op or a whole-bus stop.
    expect(voices.map((v) => v.owner).sort()).toEqual(['arp', 'sequencer']);
    expect(voices.find((v) => v.noteName === 'C4').owner).toBe('arp');
    expect(voices.find((v) => v.noteName === 'E4').owner).toBe('sequencer');
  });
});
