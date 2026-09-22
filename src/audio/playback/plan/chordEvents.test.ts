import { describe, expect, test } from 'bun:test';
import { cycleStepAt, equalPowerVelocityScale } from '@/audio/chordRhythms';
import type { RhythmPattern } from '@/data/chordRhythms';
import { arpStepFor } from '@/utils/timeSignature';
import type { ArpSettings } from '@/types/synth';
import { TRACK_ARP_DEFAULTS } from '@/store/initialState';
import { SUBTRACTIVE_INIT } from '@/utils/synthPresets';
import type { AudioEngine } from '@/audio/engine';
// A test, not a planner: the plan/ purity block and this file's own import-graph
// guard both cover production code only (R227, R053), so exercising the engine-
// touching `playFullHoldChord` here to pin its velocity against `fullHoldVelocity`
// is not the banned planner-calls-chordPlayback edge.
import { playFullHoldChord } from '../chordPlayback';
import {
  arpEventsForStep,
  buildChordEvents,
  chordPlanPosition,
  eventsForCycleStep,
  fullHoldVelocity,
  stepNoteWindow,
  type BarInvariantEvent,
  type StepEvent,
} from './chordEvents';

describe('stepNoteWindow', () => {
  const ev = (timeOffset: number, hold: number): StepEvent => ({ noteName: 'C4', velocity: 0.8, timeOffset, hold });

  test('stepNoteWindow clamps to chordEnd', () => {
    expect(stepNoteWindow(2, ev(0.03, 1), 2.5)).toEqual({ startSec: 2 + 0.03, endSec: 2.5 });
    expect(stepNoteWindow(2, ev(0.03, 0.1), 2.5)).toEqual({ startSec: 2 + 0.03, endSec: 2 + 0.03 + 0.1 });
  });

  test('stepNoteWindow floors the gate at 10 ms', () => {
    const start = 2 + 0.2;
    expect(stepNoteWindow(2, ev(0.2, 1), 2.1)).toEqual({ startSec: start, endSec: start + 0.01 });
  });
});

describe('fullHoldVelocity', () => {
  test("fullHoldVelocity matches playFullHoldChord's velocity for 1–6 notes", () => {
    const notes = ['C4', 'E4', 'G4', 'B4', 'D5', 'F5'];
    for (let n = 1; n <= notes.length; n += 1) {
      const velocities: number[] = [];
      const fake = {
        triggerSynthNoteOn: (_hz: number, _synth: unknown, velocity: number) => {
          velocities.push(velocity);
          return null;
        },
        triggerSynthNoteOff: () => {},
      } as unknown as AudioEngine;
      playFullHoldChord(notes.slice(0, n), structuredClone(SUBTRACTIVE_INIT), 0, 1, 'chord', fake);
      expect(velocities).toEqual(new Array<number>(n).fill(fullHoldVelocity(n)));
    }
  });
});

describe('eventsForCycleStep folds a progression step onto the cycle it is given', () => {
  const EVENTS: BarInvariantEvent[] = [
    { step: 0, noteName: 'C4', velocity: 0.8, timeOffset: 0, hold: 0.25 },
    { step: 20, noteName: 'E4', velocity: 0.7, timeOffset: 0.03, hold: 0.25 },
    { step: 12, noteName: 'G4', velocity: 0.6, timeOffset: 0, hold: 0.25, lastBarOnly: true },
  ];

  test('fires a bar-two event where a one-bar filter never would', () => {
    expect(eventsForCycleStep(EVENTS, 20, 32, false).map((e) => e.noteName)).toEqual(['E4']);
  });

  test('folds a step past the cycle seam back onto the same column', () => {
    expect(eventsForCycleStep(EVENTS, 52, 32, false).map((e) => e.noteName)).toEqual(['E4']);
  });

  test('repeats a one-bar preset cycle inside a longer progression step', () => {
    const preset: BarInvariantEvent[] = [
      { step: 4, noteName: 'E4', velocity: 0.7, timeOffset: 0, hold: 0.25 },
    ];
    expect(eventsForCycleStep(preset, 4, 16, false)).toHaveLength(1);
    expect(eventsForCycleStep(preset, 20, 16, false)).toHaveLength(1);
    expect(eventsForCycleStep(preset, 21, 16, false)).toEqual([]);
  });

  test('withholds a lastBarOnly approach until the active chord decides it', () => {
    expect(eventsForCycleStep(EVENTS, 12, 32, false)).toEqual([]);
    expect(eventsForCycleStep(EVENTS, 12, 32, true).map((e) => e.noteName)).toEqual(['G4']);
  });
});

describe('chordPlanPosition measures a step from the run origin', () => {
  // A two-bar chord that a run armed on its first bar line: progression step 0
  // through 31. The second chord of that run is armed on progression step 32.
  const PLAN = { startProgressionStep: 0, totalBars: 2 };

  test('maps a progression step to its place in the chord', () => {
    expect(chordPlanPosition(PLAN, 0)).toEqual({ isLastBar: false, stepsRemaining: 32 });
    expect(chordPlanPosition(PLAN, 4)).toEqual({ isLastBar: false, stepsRemaining: 28 });
  });

  test('flags the final bar so approach notes fire only there', () => {
    expect(chordPlanPosition(PLAN, 16)).toEqual({ isLastBar: true, stepsRemaining: 16 });
    expect(chordPlanPosition(PLAN, 31)).toEqual({ isLastBar: true, stepsRemaining: 1 });
  });

  test('returns null outside the chord span', () => {
    // 31 is the chord's last step; the next one belongs to the chord that
    // follows, which arms a plan of its own.
    expect(chordPlanPosition(PLAN, -1)).toBeNull();
    expect(chordPlanPosition(PLAN, 32)).toBeNull();
  });

  test('the second chord of a run is measured from the same origin, not from bar zero', () => {
    // Armed 32 progression steps into the run (two chords of two bars each).
    const second = { startProgressionStep: 32, totalBars: 2 };
    expect(chordPlanPosition(second, 32)).toEqual({ isLastBar: false, stepsRemaining: 32 });
    expect(chordPlanPosition(second, 48)).toEqual({ isLastBar: true, stepsRemaining: 16 });
    expect(chordPlanPosition(second, 31)).toBeNull();
  });
});

describe('a plan folds each chord and bass cycle by its own resolved width', () => {
  const BAR = 16;
  // A six-bar progression, a two-bar chord cycle (32 columns) over a
  // three-bar bass cycle (48), both resolved when the plan was armed. One
  // progression-relative step feeds both folds.
  const PLAN = {
    startProgressionStep: 0,
    totalBars: 6,
    chordCycleSteps: 2 * BAR,
    bassCycleSteps: 3 * BAR,
  };
  // The one subtraction the clock callback makes, before it publishes: the
  // clock step minus the step the run armed on. The arming state that supplies
  // the origin is pinned in useChordClockPlayback.test.ts; what is under test here
  // is what the two lanes do with the number it produces.
  const progressionStepAt = (step: number, origin = 0): number => step - origin;
  const inPlan = (step: number, origin = 0) =>
    chordPlanPosition(PLAN, progressionStepAt(step, origin));

  test('a two-bar chord custom event at column 20 fires in bar two', () => {
    const events: BarInvariantEvent[] = [
      { step: 20, noteName: 'E4', velocity: 0.7, timeOffset: 0, hold: 0.25 },
    ];
    const at = (step: number) =>
      eventsForCycleStep(events, progressionStepAt(step), PLAN.chordCycleSteps, false);

    expect(cycleStepAt(progressionStepAt(20), PLAN.chordCycleSteps)).toBe(20);
    expect(at(20).map((e) => e.noteName)).toEqual(['E4']);
    expect(at(19)).toEqual([]);
    // Column 20 is bar two of EVERY repetition, not a one-off.
    expect(at(20 + PLAN.chordCycleSteps).map((e) => e.noteName)).toEqual(['E4']);
  });

  test('a one-bar preset still repeats once per bar inside a multi-bar chord', () => {
    const preset: BarInvariantEvent[] = [
      { step: 4, noteName: 'E4', velocity: 0.7, timeOffset: 0, hold: 0.25 },
    ];
    const at = (step: number) =>
      eventsForCycleStep(preset, progressionStepAt(step), BAR, false);

    expect([4, 20, 36, 52].map((step) => at(step).length)).toEqual([1, 1, 1, 1]);
    expect(at(5)).toEqual([]);
  });

  test('independent chord and bass cycles phase from the same progression step', () => {
    const phases = [0, 16, 32, 48, 64, 80].map((step) => {
      const progressionStep = progressionStepAt(step);
      return [
        cycleStepAt(progressionStep, PLAN.chordCycleSteps),
        cycleStepAt(progressionStep, PLAN.bassCycleSteps),
      ];
    });

    expect(phases).toEqual([
      [0, 0],   // both cycles begin together
      [16, 16],
      [0, 32],  // the two-bar chord cycle wraps; the three-bar bass does not
      [16, 0],  // the bass wraps a bar later; the chord does not
      [0, 16],
      [16, 32],
    ]);
  });

  test('playback that began on a running clock starts both cycles at column zero', () => {
    // The shared clock has been counting since app start; the run armed on the
    // bar line at 112, so that tick is progression step 0 for both lanes —
    // never clock step 112, whose own bar column is 0 but whose cycle column
    // would be 112 % 32 = 16.
    const origin = 112;

    expect(inPlan(origin, origin)).not.toBeNull();
    expect(inPlan(origin + 1, origin)).not.toBeNull();
    expect([
      cycleStepAt(progressionStepAt(origin, origin), PLAN.chordCycleSteps),
      cycleStepAt(progressionStepAt(origin, origin), PLAN.bassCycleSteps),
    ]).toEqual([0, 0]);

    // One step in, both cycles are one column in.
    expect([
      cycleStepAt(progressionStepAt(origin + 1, origin), PLAN.chordCycleSteps),
      cycleStepAt(progressionStepAt(origin + 1, origin), PLAN.bassCycleSteps),
    ]).toEqual([1, 1]);
  });

  test('a custom span covering the whole cycle retriggers at column zero of the next', () => {
    const span: BarInvariantEvent[] = [
      { step: 0, noteName: 'C4', velocity: 0.8, timeOffset: 0, hold: 2 },
    ];
    const at = (step: number) =>
      eventsForCycleStep(span, progressionStepAt(step), PLAN.chordCycleSteps, false);

    expect(at(0).map((e) => e.noteName)).toEqual(['C4']); // the cycle's strike
    expect(at(31)).toEqual([]);                          // sealed until the seam
    expect(at(32).map((e) => e.noteName)).toEqual(['C4']); // seam: release, restrike
    expect(at(64).map((e) => e.noteName)).toEqual(['C4']); // and on every repetition
  });
});

describe('arpEventsForStep', () => {
  const ARP: ArpSettings = { ...TRACK_ARP_DEFAULTS.chord, active: true, mode: 'up', octaves: 1, rate: '16n' };
  const NOTES = ['C4', 'E4', 'G4'];

  test('walks the chord tones in arp order, one per sixteenth step', () => {
    expect(arpEventsForStep(NOTES, ARP, 0, 0.125, 1).map((e) => e.noteName)).toEqual(['C4']);
    expect(arpEventsForStep(NOTES, ARP, 1, 0.125, 1).map((e) => e.noteName)).toEqual(['E4']);
    expect(arpEventsForStep(NOTES, ARP, 2, 0.125, 1).map((e) => e.noteName)).toEqual(['G4']);
    // The sequence wraps, so the arp keeps running across bars and chords.
    expect(arpEventsForStep(NOTES, ARP, 3, 0.125, 1).map((e) => e.noteName)).toEqual(['C4']);
  });

  test('honours arpRate by staying silent on steps the rate skips', () => {
    const eighths = { ...ARP, rate: '8n' as const };
    expect(arpEventsForStep(NOTES, eighths, 0, 0.125, 1).map((e) => e.noteName)).toEqual(['C4']);
    expect(arpEventsForStep(NOTES, eighths, 1, 0.125, 1)).toEqual([]);
    expect(arpEventsForStep(NOTES, eighths, 2, 0.125, 1).map((e) => e.noteName)).toEqual(['E4']);
  });

  test('stacks octaves and follows arpMode', () => {
    const down = { ...ARP, mode: 'down' as const, octaves: 2 };
    // up-order across 2 octaves is C4 E4 G4 C5 E5 G5, so down starts at G5.
    expect(arpEventsForStep(NOTES, down, 0, 0.125, 1).map((e) => e.noteName)).toEqual(['G5']);
  });

  test('feel tightens an arp note but never stretches it past its own step', () => {
    const [plain] = arpEventsForStep(NOTES, ARP, 0, 0.125, 1);
    const [tight] = arpEventsForStep(NOTES, ARP, 0, 0.125, 0.5);
    const [loose] = arpEventsForStep(NOTES, ARP, 0, 0.125, 2);

    expect(tight.hold).toBeCloseTo(plain.hold * 0.5, 9);
    // A gate longer than the interval between triggers just guarantees the
    // notes overlap. On the monophonic bass that means every note is
    // voice-stolen while still above its sustain level and chopped off.
    expect(loose.hold).toBe(plain.hold);
    expect(plain.hold).toBeLessThan(0.125);
  });

  test('returns nothing when there are no notes to arpeggiate', () => {
    expect(arpEventsForStep([], ARP, 0, 0.125, 1)).toEqual([]);
  });

  test('a non-default stepsPerBar bar-phases the step instead of taking it raw', () => {
    // 7/8 (stepsPerBar 14) is the one meter in the table that is NOT a
    // multiple of 4, so arpStepFor re-phases it: arpStepFor(14, 14) lands on
    // the next bar's phase-quantised start (16), not on 14 itself. If
    // arpEventsForStep ever stopped bar-phasing its `step` argument — e.g. by
    // reverting to a plain `computeArpTriggers(step, ...)` call — this test
    // would fail even though the whole rest of the suite (which only ever
    // passes the defaulted, byte-identical 4/4 stepsPerBar) would stay green.
    const rephasedStep = arpStepFor(14, 14);
    expect(rephasedStep).toBe(16);

    const [odd] = arpEventsForStep(NOTES, ARP, 14, 0.125, 1, 14);
    const [control] = arpEventsForStep(NOTES, ARP, 14, 0.125, 1);

    // The 4/4 control call (stepsPerBar defaults to 16, already a multiple of
    // 4) takes step 14 raw: arpStepFor(14, 16) === 14, noteIndex 14 % 3 = G4.
    expect(control.noteName).toEqual('G4');
    // The 7/8 call re-phases 14 to 16 before indexing: noteIndex 16 % 3 = E4 —
    // the same note `computeArpTriggers` would pick for step 16 directly.
    expect(odd.noteName).toEqual('E4');
    expect(odd.noteName).not.toEqual(control.noteName);
  });
});

describe('buildChordEvents', () => {
  const PATTERN: RhythmPattern = {
    id: 'test',
    name: 'Test',
    style: 'Test',
    hits: [{ step: 0, type: 'block', velocity: 0.8, holdSteps: 2 }],
  };

  test('scales block-hit velocity by 1/√n and keeps offset/hold math', () => {
    const notes = ['C4', 'E4', 'G4', 'B4'];
    const events = buildChordEvents(PATTERN, notes, 0.125, 1);

    expect(events).toHaveLength(4);
    const scaled = 0.8 * equalPowerVelocityScale(4);
    for (const ev of events) {
      expect(ev.velocity).toBe(scaled);
      // The hit's grid position is carried as a step, not baked into a time
      // offset: the scheduler emits each event on the clock tick that matches.
      expect(ev.step).toBe(0);
      expect(ev.timeOffset).toBe(0);
      expect(ev.hold).toBeCloseTo(0.25, 6);
    }
    expect(events.map((e) => e.noteName)).toEqual(notes);
  });

  test('keeps strum cascade ordering, spread timing, and scaled velocities', () => {
    const strumPattern: RhythmPattern = {
      id: 'test',
      name: 'Test',
      style: 'Test',
      hits: [
        { step: 4, type: 'strum', direction: 'up', velocity: 0.9, holdSteps: 2, spreadMs: 30 },
      ],
    };
    const notes = ['C4', 'E4', 'G4'];
    const events = buildChordEvents(strumPattern, notes, 0.125, 2);

    // Up-strum = high to low.
    expect(events.map((e) => e.noteName)).toEqual(['G4', 'E4', 'C4']);
    const base = 0.9 * equalPowerVelocityScale(3);
    // All three land on step 4; only the strum spread stays a time offset.
    expect(events.map((e) => e.step)).toEqual([4, 4, 4]);
    expect(events[0].timeOffset).toBeCloseTo(0, 9);
    expect(events[1].timeOffset).toBeCloseTo(0.03, 9);
    expect(events[2].timeOffset).toBeCloseTo(0.06, 9);
    expect(events[0].velocity).toBeCloseTo(Math.max(0.1, base * (1 - 0 * 0.08)), 12);
    expect(events[1].velocity).toBeCloseTo(Math.max(0.1, base * (1 - 1 * 0.08)), 12);
    expect(events[2].velocity).toBeCloseTo(Math.max(0.1, base * (1 - 2 * 0.08)), 12);
    expect(events[0].hold).toBeCloseTo(2 * 0.125 * 2, 6);
  });
});

describe('eventsForCycleStep output is unchanged by the single-pass rewrite', () => {
  const events: BarInvariantEvent[] = [
    { step: 0, noteName: 'C4', velocity: 0.8, timeOffset: 0, hold: 0.5 },
    { step: 0, noteName: 'E4', velocity: 0.7, timeOffset: 0.01, hold: 0.5 },
    { step: 4, noteName: 'G4', velocity: 0.6, timeOffset: 0, hold: 0.25 },
    { step: 4, noteName: 'B3', velocity: 0.5, timeOffset: 0, hold: 0.25, lastBarOnly: true },
    { step: 15, noteName: 'D4', velocity: 0.4, timeOffset: 0, hold: 0.1, lastBarOnly: true },
  ];

  // The old .filter().map(), kept verbatim as the oracle.
  const reference = (stepInBar: number, isLastBar: boolean) =>
    events
      .filter((ev) => ev.step === stepInBar && (isLastBar || !ev.lastBarOnly))
      .map(({ noteName, velocity, timeOffset, hold }) => ({ noteName, velocity, timeOffset, hold }));

  test('matches the reference across every step and both bar positions', () => {
    for (let step = 0; step < 16; step++) {
      for (const isLastBar of [false, true]) {
        expect(eventsForCycleStep(events, step, 16, isLastBar)).toEqual(reference(step, isLastBar));
      }
    }
  });

  test('returns a fresh array of fresh objects with exactly the four StepEvent keys', () => {
    const a = eventsForCycleStep(events, 0, 16, true);
    expect(a).not.toBe(eventsForCycleStep(events, 0, 16, true));
    expect(a[0]).not.toBe(events[0]);
    expect(Object.keys(a[0]).sort()).toEqual(['hold', 'noteName', 'timeOffset', 'velocity']);
    expect(eventsForCycleStep([], 0, 16, true)).toEqual([]);
  });
});
