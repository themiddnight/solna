import { describe, expect, test } from 'bun:test';
import { createDefaultLoopContent } from './loopDefaults';
import { createDefaultLoop } from './loopSlice';
import { sanitizeLoops, sanitizeTrackSends } from './sanitize';

const defaults = () => createDefaultLoopContent().trackSends;
const SOURCES = ['synth', 'chord', 'bass', 'pad', 'fx', 'sequencer'] as const;

describe('sanitizeTrackSends', () => {
  test('a value that is not a plain object takes the whole default', () => {
    for (const bad of [undefined, null, 7, 'loud', []]) {
      expect(sanitizeTrackSends(bad, defaults())).toEqual(defaults());
    }
  });

  test('a bad row takes that row default; the other rows survive', () => {
    const synth = { reverb: 0.3, delay: 0.4, distortion: 0.5 };
    const out = sanitizeTrackSends({ ...defaults(), chord: 'loud', synth }, defaults());
    expect(out.chord).toEqual(defaults().chord);
    expect(out.synth).toEqual(synth);
  });

  test('a non-number or non-finite level takes that effect default; out of range clamps', () => {
    const out = sanitizeTrackSends({
      ...defaults(),
      bass: { reverb: Number.NaN, delay: '0.5', distortion: 0.25 },
      pad: { reverb: 1.7, delay: -0.2, distortion: 0 },
    }, defaults());
    expect(out.bass).toEqual({ reverb: 1, delay: 1, distortion: 0.25 });
    expect(out.pad).toEqual({ reverb: 1, delay: 0, distortion: 0 });
  });

  test('unknown sources and unknown effect keys are dropped', () => {
    const out = sanitizeTrackSends({
      ...defaults(),
      drum: { reverb: 0 },
      fx: { reverb: 0.5, delay: 0.5, distortion: 0.5, chorus: 1 },
    }, defaults());
    expect(Object.keys(out).sort()).toEqual([...SOURCES].sort());
    expect(out.fx).toEqual({ reverb: 0.5, delay: 0.5, distortion: 0.5 });
  });

  test('the result shares no reference with the input or the fallback', () => {
    const raw = defaults();
    const fallback = defaults();
    const out = sanitizeTrackSends(raw, fallback);
    expect(out).toEqual(raw);
    for (const container of [raw, fallback]) {
      expect(out).not.toBe(container);
      for (const source of SOURCES) expect(out[source]).not.toBe(container[source]);
    }
    const whole = sanitizeTrackSends(undefined, fallback);
    expect(whole).not.toBe(fallback);
    expect(whole.synth).not.toBe(fallback.synth);
  });
});

describe('sanitizeLoops reads trackSends', () => {
  test('a loop saved before DEV-423 reads back with the defaults: Beat dry into delay and distortion', () => {
    const legacy: Record<string, unknown> = { ...createDefaultLoop() };
    delete legacy.trackSends;
    const [out] = sanitizeLoops([legacy]) ?? [];
    expect(out?.trackSends).toEqual(defaults());
    expect(out?.trackSends.sequencer).toEqual({ reverb: 1, delay: 0, distortion: 0 });
  });

  test('a stored value survives the read', () => {
    const stored = { ...defaults(), bass: { reverb: 0.1, delay: 0.2, distortion: 0.3 } };
    const [out] = sanitizeLoops([{ ...createDefaultLoop(), trackSends: stored }]) ?? [];
    expect(out?.trackSends).toEqual(stored);
  });
});
