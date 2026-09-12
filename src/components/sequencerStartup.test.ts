import { describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { freshEngine, synthParamsFixture } from '../audio/testFakes';
import { sequencerStepEvents } from '../audio/sequencerSteps';
import { INITIAL_SEQUENCER_TRACKS } from '../store/initialState';
import { fireSequencerStepEvents, sequencerStepAction } from './useSequencerPlayback';

/**
 * The song-start kick. When Play All starts the transport from fully stopped,
 * resetClock() re-anchors step 0 CLOCK_REANCHOR_DELAY ahead, the shared clock
 * dispatches step 0, and the Beat stepper must fire the kick on beat 1. This
 * drives the real clock and the real scheduler logic (arming + event lookup,
 * no React) to pin that the first dispatched step produces a kick at the
 * re-anchored time — and nothing swallows it.
 */
describe('sequencer song-start kick', () => {
  test('the first dispatched step fires the kick at the re-anchored downbeat', () => {
    const { engine, ctx } = freshEngine();
    engine.setClockBpm(120);
    // fully-stopped -> playing calls resetClock() with no anchor (engineSync.ts)
    engine.resetClock();
    // The re-anchored downbeat is CLOCK_REANCHOR_DELAY (0.05 s) ahead of now.
    const expectedDownbeat = ctx.currentTime + 0.05;

    const kickAt: number[] = [];
    const drumSpy = spyOn(audioEngine, 'triggerDrum').mockImplementation((type, _v, time) => {
      if (type === 'kick') kickAt.push(time as number);
    });

    // The arming ref the real hook keeps across the stopped->playing transition.
    const arming = { armed: false };
    const unsubscribe = engine.subscribeClock((step, _beat, time) => {
      const action = sequencerStepAction('playing', step, arming, 16);
      if (action !== 'play') return;
      fireSequencerStepEvents(
        sequencerStepEvents(INITIAL_SEQUENCER_TRACKS, step % 16, synthParamsFixture(), 120),
        synthParamsFixture(),
        time,
      );
    });

    const tick = () => (engine as unknown as { clock: { clockTick(): void } }).clock.clockTick();
    // Advance the fake clock through the first dispatch window (and one more
    // step so the grid demonstrably keeps running, not just one burst).
    for (let i = 0; i < 8; i++) {
      tick();
      ctx.currentTime += 0.025;
    }

    unsubscribe();
    drumSpy.mockRestore();

    expect(kickAt.length).toBeGreaterThan(0);
    expect(kickAt[0]).toBeCloseTo(expectedDownbeat, 6);
  });
});
