import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { createDefaultLoop } from '@/store/loopSlice';
import { dbToFaderPosition } from '../ui/VolumeFader';
import { LoopMixSummary, mixSummary, mixSummaryLabel } from './loopCardBody';

const loopWith = (patch: Partial<ReturnType<typeof createDefaultLoop>>) => ({ ...createDefaultLoop(), ...patch });

describe('mixSummary', () => {
  test('one entry per mix layer, in table order', () => {
    expect(mixSummary(createDefaultLoop()).map((e) => e.label)).toEqual(['Lead', 'FX', 'Chord', 'Bass', 'Pad', 'Beat']);
  });

  test('a level is a fader position on the fader taper', () => {
    const lead = mixSummary(loopWith({ synthVolume: -12 }))[0];
    expect(lead.levelDb).toBe(-12);
    expect(lead.position).toBe(dbToFaderPosition(-12));
  });

  test('reads mute from the flat fields and from beatMix', () => {
    const loop = createDefaultLoop();
    const entries = mixSummary({ ...loop, bassMuted: true, beatMix: { ...loop.beatMix, muted: true } });
    expect(entries.filter((e) => e.muted).map((e) => e.label)).toEqual(['Bass', 'Beat']);
  });

  test('the spoken label says muted instead of a level', () => {
    const entries = mixSummary(loopWith({ synthVolume: 0, fxMuted: true }));
    expect(mixSummaryLabel(entries).startsWith('Lead 0.0 dB, FX muted, ')).toBe(true);
  });
});

describe('LoopMixSummary', () => {
  test('draws no bar for a muted track and strikes its label', () => {
    const html = renderToString(<LoopMixSummary mix={loopWith({ padMuted: true })} />);
    expect(html).toContain('role="img"');
    expect(html.match(/bg-current/g)?.length).toBe(5);
    expect(html).toMatch(/line-through[^>]*>Pad</);
  });
});
