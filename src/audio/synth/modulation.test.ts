import { describe, expect, test } from 'bun:test';
import { fakeAutomationParam } from '../engineTestHelpers';
import {
  envelopeValueAt,
  releaseScheduledParam,
  releaseScheduledParamTo,
  scheduleAdsr,
  schedulePitchEnvelope,
} from './modulation';

describe('schedulePitchEnvelope', () => {
  test('zero attack jumps straight to peak cents, then decays linearly to sustain', () => {
    const detune = fakeAutomationParam();
    schedulePitchEnvelope(detune, { attackSeconds: 0, decaySeconds: 1, sustain: 0, releaseSeconds: 0.1 }, 48, 2);
    expect(detune.events).toEqual([
      ['set', 4800, 2],
      ['ramp', 0, 3],
    ]);
  });

  test('negative route amount schedules negative cents throughout', () => {
    const detune = fakeAutomationParam();
    schedulePitchEnvelope(detune, { attackSeconds: 0, decaySeconds: 0.5, sustain: 0.5, releaseSeconds: 0.1 }, -12, 0);
    expect(detune.events).toEqual([
      ['set', -1200, 0],
      // sustain 0.5 of a 0 -> -1200 span is -600.
      ['ramp', -600, 0.5],
    ]);
  });

  test('non-zero attack anchors the start value before ramping to peak, then to sustain', () => {
    const detune = fakeAutomationParam();
    schedulePitchEnvelope(detune, { attackSeconds: 0.1, decaySeconds: 0.5, sustain: 0.5, releaseSeconds: 0.1 }, 12, 0);
    expect(detune.events).toEqual([
      ['set', 0, 0],
      ['ramp', 1200, 0.1],
      ['ramp', 600, 0.6],
    ]);
  });

  test('zero decay with non-zero sustain jumps to the sustain level at the attack-end instant', () => {
    const detune = fakeAutomationParam();
    schedulePitchEnvelope(detune, { attackSeconds: 0, decaySeconds: 0, sustain: 0.25, releaseSeconds: 0.1 }, 24, 5);
    expect(detune.events).toEqual([
      ['set', 2400, 5],
      // decay is 0 s but sustain (600) differs from peak (2400): jump immediately.
      ['set', 600, 5],
    ]);
  });

  test('zero decay with full sustain (1) needs no further event — peak already equals sustain', () => {
    const detune = fakeAutomationParam();
    schedulePitchEnvelope(detune, { attackSeconds: 0, decaySeconds: 0, sustain: 1, releaseSeconds: 0.1 }, 7, 0);
    expect(detune.events).toEqual([['set', 700, 0]]);
  });
});

describe('scheduleAdsr amplitude flooring', () => {
  test('sustain 0 reaches exact silence (0), never an epsilon floor', () => {
    const gain = fakeAutomationParam();
    scheduleAdsr(gain, { attackSeconds: 0, decaySeconds: 0.2, sustain: 0, releaseSeconds: 0.1 }, { base: 0, peak: 0.8 }, 0);
    expect(gain.events).toEqual([
      ['set', 0.8, 0],
      ['ramp', 0, 0.2],
    ]);
  });
});

describe('releaseScheduledParam', () => {
  // Every case below passes a `contourStartedAt` EARLIER than the release, which
  // is the normal case: a note-off always follows its own note-on. The extra
  // `ramp` before the anchor is the segment `cancelScheduledValues` erased,
  // re-drawn from the caller's own held value — see the function's docblock.
  test('cancels at the exact scheduled time, re-draws what it erased, anchors, then ramps to true silence', () => {
    const gain = fakeAutomationParam();
    releaseScheduledParam(gain, 5, 0.3, 0.42, 4); // 0.42 is what the envelope holds at t=5.
    expect(gain.events).toEqual([
      ['cancel', 5],
      ['ramp', 0.42, 5],
      ['set', 0.42, 5],
      ['ramp', 0, 5.3],
    ]);
  });

  test('releasing from a value that reflects the attack stage still lands on exact 0', () => {
    const gain = fakeAutomationParam();
    releaseScheduledParam(gain, 1, 0.5, 0.1, 0.7); // a third of the way through a slow attack.
    expect(gain.events).toEqual([
      ['cancel', 1],
      ['ramp', 0.1, 1],
      ['set', 0.1, 1],
      ['ramp', 0, 1.5],
    ]);
  });

  test('releasing from a value that reflects the decay stage still lands on exact 0', () => {
    const gain = fakeAutomationParam();
    releaseScheduledParam(gain, 2, 0.2, 0.55, 1); // partway through decay toward sustain.
    expect(gain.events).toEqual([
      ['cancel', 2],
      ['ramp', 0.55, 2],
      ['set', 0.55, 2],
      ['ramp', 0, 2.2],
    ]);
  });

  test('releasing from a value already sitting at sustain still lands on exact 0', () => {
    const gain = fakeAutomationParam();
    releaseScheduledParam(gain, 3, 0.4, 0.6, 2.5); // already sitting at sustain.
    expect(gain.events).toEqual([
      ['cancel', 3],
      ['ramp', 0.6, 3],
      ['set', 0.6, 3],
      ['ramp', 0, 3.4],
    ]);
  });

  test('a negative release length is clamped to 0 seconds rather than scheduling backwards in time', () => {
    const gain = fakeAutomationParam();
    releaseScheduledParam(gain, 10, -1, 0.5, 9);
    expect(gain.events).toEqual([
      ['cancel', 10],
      ['ramp', 0.5, 10],
      ['set', 0.5, 10],
      ['ramp', 0, 10],
    ]);
  });
});

/**
 * The re-draw, as its own question.
 *
 * `cancelScheduledValues(at)` removes every event at time >= `at`. In realtime
 * that only reaches the future, because what came before has already been
 * rendered — but NOTHING is rendered yet at the moment a sequenced note books
 * its release, which every sequenced player does in the same breath as its
 * note-on, one `CLOCK_LOOKAHEAD` ahead. The attack and decay ramps are then
 * erased before they ever run, and the param holds its pre-ramp value flat for
 * the whole note. Measured: +4.1 dB, and the filter contour with it.
 *
 * One `linearRampToValueAtTime(heldValue, at)` restores it EXACTLY, and exactly
 * is the right word rather than an approximation: `scheduleAdsr` draws only
 * straight lines, `heldValue` is computed by `envelopeValueAt`, which is that
 * function's own inverse, and the events that survive the cancel end at the
 * last breakpoint before `at`. A straight line from that breakpoint to
 * (`at`, `heldValue`) is the same straight line the cancel removed.
 */
describe('the erased segment is re-drawn, not lost', () => {
  test('one ramp reproduces the attack line the cancel removed', () => {
    // scheduleAdsr(0 -> 1 over 2 s) then a release at t = 1.5, halfway up.
    const scheduled = fakeAutomationParam();
    scheduleAdsr(scheduled, { attackSeconds: 2, decaySeconds: 0, sustain: 1, releaseSeconds: 0 }, { base: 0, peak: 1 }, 1);
    expect(scheduled.events).toEqual([
      ['set', 0, 1],
      ['ramp', 1, 3],
    ]);

    // The release cancels at 1.5, which removes `['ramp', 1, 3]` — the whole
    // attack, including the 0.5 s of it that was meant to have already played.
    releaseScheduledParam(scheduled, 1.5, 0.2, 0.25, 1);
    expect(scheduled.events).toEqual([
      ['set', 0, 1],
      ['ramp', 1, 3],
      ['cancel', 1.5],
      // The line from the surviving ['set', 0, 1] to (1.5, 0.25) is the same
      // line as the erased ramp over that interval.
      ['ramp', 0.25, 1.5],
      ['set', 0.25, 1.5],
      ['ramp', 0, 1.7],
    ]);
  });

  test('a release at the exact instant the contour started re-draws nothing', () => {
    // Nothing survives the cancel to ramp FROM, and there is no elapsed segment
    // to restore. A ramp here would have no defined starting point.
    const gain = fakeAutomationParam();
    releaseScheduledParam(gain, 4, 0.3, 0.8, 4);
    expect(gain.events).toEqual([
      ['cancel', 4],
      ['set', 0.8, 4],
      ['ramp', 0, 4.3],
    ]);
  });

  test('a release booked BEFORE the contour started re-draws nothing either', () => {
    // Reachable, and not an edge: a sequencer books a note-off ahead, then a
    // loop load calls stopSource at the current time, which is earlier.
    const gain = fakeAutomationParam();
    releaseScheduledParam(gain, 3, 0.3, 0, 4);
    expect(gain.events).toEqual([
      ['cancel', 3],
      ['set', 0, 3],
      ['ramp', 0, 3.3],
    ]);
  });
});

describe('releaseScheduledParamTo', () => {
  test('returns a modulated param to its unmodulated base rather than to zero', () => {
    const cutoff = fakeAutomationParam();
    releaseScheduledParamTo(cutoff, 4, 0.2, 1000, 2000, 3); // held an octave above its 1000 Hz base.
    expect(cutoff.events).toEqual([
      ['cancel', 4],
      ['ramp', 2000, 4],
      ['set', 2000, 4],
      ['ramp', 1000, 4.2],
    ]);
  });

  test('a base of 0 is exactly what releaseScheduledParam does', () => {
    const viaTarget = fakeAutomationParam();
    releaseScheduledParamTo(viaTarget, 1, 0.3, 0, 0.5, 0.5);
    const viaSilence = fakeAutomationParam();
    releaseScheduledParam(viaSilence, 1, 0.3, 0.5, 0.5);
    expect(viaTarget.events).toEqual(viaSilence.events);
  });

  test('a negative release length is clamped to 0 seconds here too', () => {
    const pan = fakeAutomationParam();
    releaseScheduledParamTo(pan, 2, -1, -0.25, 0.75, 1);
    expect(pan.events).toEqual([
      ['cancel', 2],
      ['ramp', 0.75, 2],
      ['set', 0.75, 2],
      ['ramp', -0.25, 2],
    ]);
  });

  test('an ENV2 route re-draws its erased contour too — a filter sweep is not just a level', () => {
    // The amp envelope is the audible half, but every ENV2 destination goes
    // through the same cancel: a cutoff contour erased before it runs makes the
    // filter sit wide open for the whole note. Same one-ramp restoration.
    const cutoff = fakeAutomationParam();
    releaseScheduledParamTo(cutoff, 2, 0.1, 400, 1800, 1.2);
    expect(cutoff.events.slice(0, 2)).toEqual([
      ['cancel', 2],
      ['ramp', 1800, 2],
    ]);
  });
});
describe('envelopeValueAt', () => {
  const timing = { attackSeconds: 0.2, decaySeconds: 0.4, sustain: 0.5, releaseSeconds: 1 };
  const levels = { base: 0, peak: 1 };

  test('reads base before the envelope starts and peak at the top of the attack', () => {
    expect(envelopeValueAt(timing, levels, 2, 1.9)).toBe(0);
    expect(envelopeValueAt(timing, levels, 2, 2)).toBe(0);
    expect(envelopeValueAt(timing, levels, 2, 2.2)).toBeCloseTo(1, 10);
  });

  test('interpolates linearly through attack and decay, exactly as scheduleAdsr ramps', () => {
    expect(envelopeValueAt(timing, levels, 2, 2.1)).toBeCloseTo(0.5, 10);
    // Halfway through a decay from 1 down to a sustain of 0.5.
    expect(envelopeValueAt(timing, levels, 2, 2.4)).toBeCloseTo(0.75, 10);
  });

  test('holds at sustain for ever after the decay ends', () => {
    expect(envelopeValueAt(timing, levels, 2, 2.6)).toBeCloseTo(0.5, 10);
    expect(envelopeValueAt(timing, levels, 2, 99)).toBeCloseTo(0.5, 10);
  });

  test('a zero-length attack is at peak from the note-on instant', () => {
    const instant = { ...timing, attackSeconds: 0 };
    expect(envelopeValueAt(instant, levels, 2, 2)).toBeCloseTo(1, 10);
    expect(envelopeValueAt(instant, levels, 2, 2.2)).toBeCloseTo(0.75, 10);
  });

  test('a zero-length decay is at sustain from the end of the attack', () => {
    const noDecay = { ...timing, decaySeconds: 0 };
    expect(envelopeValueAt(noDecay, levels, 2, 2.2)).toBeCloseTo(0.5, 10);
  });

  test('agrees with the curve scheduleAdsr actually books, at every segment boundary', () => {
    const param = fakeAutomationParam();
    scheduleAdsr(param, timing, levels, 2);
    // ['set', 0, 2], ['ramp', 1, 2.2], ['ramp', 0.5, 2.6]
    expect(envelopeValueAt(timing, levels, 2, 2)).toBe(param.events[0][1]);
    expect(envelopeValueAt(timing, levels, 2, 2.2)).toBeCloseTo(param.events[1][1] as number, 10);
    expect(envelopeValueAt(timing, levels, 2, 2.6)).toBeCloseTo(param.events[2][1] as number, 10);
  });

  test('a modulation route with a negative peak reads below its base', () => {
    const down = { base: 1000, peak: 500 };
    expect(envelopeValueAt(timing, down, 0, 0.2)).toBeCloseTo(500, 10);
    expect(envelopeValueAt(timing, down, 0, 10)).toBeCloseTo(750, 10);
  });
});
