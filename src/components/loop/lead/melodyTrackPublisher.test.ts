import { describe, expect, test } from 'bun:test';
import { createStepPublisher } from '@/components/playbackStep';

describe('two melody grids, two publisher slots', () => {
  /**
   * The specific failure this pins: if useLeadStepPublisher kept publishing
   * under the literal 'lead', the two mounted grids would write the SAME slot —
   * the FX playhead would drive the lead's marker and vice versa, at whichever
   * grid's stride published last, with no error anywhere. A shared publisher is
   * indistinguishable from a working one until the two grids are at different
   * resolutions, which is why this is asserted on the publisher rather than left
   * to be noticed.
   */
  test('a step published for fx does not move the lead step', () => {
    const pub = createStepPublisher();
    pub.publish('lead', 3);
    pub.publish('fx', 11);
    expect(pub.getStep('lead')).toBe(3);
    expect(pub.getStep('fx')).toBe(11);
  });

  test('resetting fx leaves the lead step where it is', () => {
    const pub = createStepPublisher();
    pub.publish('lead', 3);
    pub.publish('fx', 11);
    pub.reset('fx');
    expect(pub.getStep('lead')).toBe(3);
    expect(pub.getStep('fx')).toBe(0);
  });

  test('each slot notifies only its own subscribers', () => {
    const pub = createStepPublisher();
    let leadCalls = 0;
    let fxCalls = 0;
    pub.subscribe('lead', () => { leadCalls += 1; });
    pub.subscribe('fx', () => { fxCalls += 1; });
    pub.publish('fx', 2);
    expect([leadCalls, fxCalls]).toEqual([0, 1]);
  });

  test('a bare reset() clears every slot including fx', () => {
    const pub = createStepPublisher();
    pub.publish('lead', 3);
    pub.publish('fx', 11);
    pub.reset();
    expect([pub.getStep('lead'), pub.getStep('fx')]).toEqual([0, 0]);
  });
});
