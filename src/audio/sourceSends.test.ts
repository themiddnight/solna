import { describe, expect, test } from 'bun:test';
import { masterChainCtx } from './engineTestHelpers';
import { SOURCE_BUS_TIME_CONSTANT_SEC } from './automation/sourceBusAutomation';
import { applySourceSendLevels, clampSendLevels, createSourceSendNodes } from './sourceSends';

/* eslint-disable @typescript-eslint/no-explicit-any -- the fake GainNode's
   param records its automation in fields the DOM type does not declare. */

function ctx(): BaseAudioContext {
  return masterChainCtx() as unknown as BaseAudioContext;
}

describe('clampSendLevels', () => {
  test('keeps 0..1, clamps outside it, and zeroes a non-finite level', () => {
    expect(clampSendLevels({ reverb: 0.25, delay: 1.7, distortion: -0.2 }))
      .toEqual({ reverb: 0.25, delay: 1, distortion: 0 });
    expect(clampSendLevels({ reverb: Number.NaN, delay: Infinity, distortion: 1 }))
      .toEqual({ reverb: 0, delay: 0, distortion: 1 });
  });
});

describe('createSourceSendNodes', () => {
  test('with no level received yet, every send is seeded silent', () => {
    const nodes = createSourceSendNodes(ctx(), undefined);
    expect([nodes.reverb.gain.value, nodes.delay.gain.value, nodes.distortion.gain.value])
      .toEqual([0, 0, 0]);
  });

  test('a known level seeds its own node, one distinct node per effect', () => {
    const nodes = createSourceSendNodes(ctx(), { reverb: 0.3, delay: 0.6, distortion: 0.9 });
    expect([nodes.reverb.gain.value, nodes.delay.gain.value, nodes.distortion.gain.value])
      .toEqual([0.3, 0.6, 0.9]);
    expect(new Set([nodes.reverb, nodes.delay, nodes.distortion]).size).toBe(3);
  });
});

describe('applySourceSendLevels', () => {
  test("'settle' writes each level at the instant, the way a bus settles at render start", () => {
    const nodes = createSourceSendNodes(ctx(), undefined);
    applySourceSendLevels(nodes, { reverb: 1, delay: 0, distortion: 0.5 }, 0, 'settle', 0);
    expect((nodes.reverb.gain as any).events.at(-1)).toEqual({ kind: 'set', v: 1, t: 0 });
    expect((nodes.delay.gain as any).events.at(-1)).toEqual({ kind: 'set', v: 0, t: 0 });
    expect((nodes.distortion.gain as any).events.at(-1)).toEqual({ kind: 'set', v: 0.5, t: 0 });
  });

  test("'transition' ramps each node with the source-bus time constant", () => {
    const nodes = createSourceSendNodes(ctx(), undefined);
    applySourceSendLevels(nodes, { reverb: 0.2, delay: 0.4, distortion: 0.6 }, 2, 'transition', 0);
    const tc = SOURCE_BUS_TIME_CONSTANT_SEC;
    expect((nodes.reverb.gain as any).targets.at(-1)).toEqual({ v: 0.2, t: 2, tc });
    expect((nodes.delay.gain as any).targets.at(-1)).toEqual({ v: 0.4, t: 2, tc });
    expect((nodes.distortion.gain as any).targets.at(-1)).toEqual({ v: 0.6, t: 2, tc });
  });
});
