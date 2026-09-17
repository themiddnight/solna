import { describe, expect, test } from 'bun:test';
import { createStepPublisher, shouldSubscribeToStep, type StepPlayerId } from './playbackStep';
import { segmentForFocus } from '@/store/focusTrack';

/** A publisher whose subscriber on `player` counts the notifications it gets. */
function countingPublisher(player: StepPlayerId = 'lead') {
  const pub = createStepPublisher();
  let notified = 0;
  pub.subscribe(player, () => {
    notified += 1;
  });
  return { pub, count: (): number => notified };
}

describe('createStepPublisher', () => {
  test('every player starts at step 0', () => {
    const pub = createStepPublisher();
    expect(pub.getStep('chords')).toBe(0);
    expect(pub.getStep('lead')).toBe(0);
    expect(pub.getStep('sequencer')).toBe(0);
  });

  test('instances are isolated from each other', () => {
    const a = createStepPublisher();
    const b = createStepPublisher();

    a.publish('lead', 8);

    expect(b.getStep('lead')).toBe(0);
  });
});

describe('createStepPublisher — publishing notifies', () => {
  test('publish records the step and notifies that player', () => {
    const { pub, count } = countingPublisher();

    pub.publish('lead', 5);

    expect(pub.getStep('lead')).toBe(5);
    expect(count()).toBe(1);
  });

  test('publishing the SAME step again does not notify', () => {
    // The bail-out matters: the clock re-dispatches a step whenever the stall
    // detector re-anchors the grid, and a repeated notification would be a
    // guaranteed re-render for an unchanged value.
    const { pub, count } = countingPublisher();

    pub.publish('lead', 5);
    pub.publish('lead', 5);
    pub.publish('lead', 5);

    expect(count()).toBe(1);
  });

  test('every listener on a player is notified', () => {
    const pub = createStepPublisher();
    const seen: string[] = [];
    pub.subscribe('chords', () => seen.push('a'));
    pub.subscribe('chords', () => seen.push('b'));

    pub.publish('chords', 1);

    expect(seen).toEqual(['a', 'b']);
  });

  test('players are independent', () => {
    const pub = createStepPublisher();
    let chordNotified = 0;
    pub.subscribe('chords', () => {
      chordNotified += 1;
    });

    pub.publish('lead', 3);
    pub.publish('sequencer', 7);

    expect(chordNotified).toBe(0);
    expect(pub.getStep('chords')).toBe(0);
    expect(pub.getStep('lead')).toBe(3);
    expect(pub.getStep('sequencer')).toBe(7);
  });
});

// The 'chords' slot is the ONE playback source behind two timeline readers —
// the chord lane and the bass lane — and each reader folds it by its OWN cycle
// width. So the value the producer publishes is a progression-relative ABSOLUTE
// step, and the publisher must hand it on untouched: a publisher that reduced
// it by a bar would give both readers the same 16-column width and leave column
// 20 of a two-bar custom cycle unaddressable.
describe('createStepPublisher — the chords playhead is not folded onto a bar', () => {
  const STEPS_PER_BAR = 16;

  /** Every value a 'chords' subscriber is notified with, in order. */
  function publishedChords(): { pub: ReturnType<typeof createStepPublisher>; steps: number[] } {
    const pub = createStepPublisher();
    const steps: number[] = [];
    pub.subscribe('chords', () => steps.push(pub.getStep('chords')));
    return { pub, steps };
  }

  test('reports steps past the bar edge instead of wrapping at it', () => {
    const { pub, steps: publishedSteps } = publishedChords();

    for (let step = 0; step <= STEPS_PER_BAR + 1; step++) pub.publish('chords', step);

    // Column 0 is the initial value, so the publisher's identity check makes it
    // no notification at all — the first one is column 1. What matters is that
    // 16 and 17 arrive intact rather than being folded into 0 and 1.
    expect(publishedSteps).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
    ]);
  });

  test('a value past the bar edge keeps the column a wider cycle draws it on', () => {
    // 20 is column 4 of a 16-column cycle and column 20 of a 32-column one;
    // which one it means is the reader's decision, so the value stays 20.
    const pub = createStepPublisher();

    pub.publish('chords', 20);

    expect(pub.getStep('chords')).toBe(20);
  });
});

describe('createStepPublisher — unsubscribing', () => {
  test('unsubscribing stops notifications and is safe to repeat', () => {
    const pub = createStepPublisher();
    let notified = 0;
    const stop = pub.subscribe('chords', () => {
      notified += 1;
    });

    pub.publish('chords', 1);
    stop();
    stop();
    pub.publish('chords', 2);

    expect(notified).toBe(1);
    expect(pub.getStep('chords')).toBe(2);
  });

  test('a listener that unsubscribes during notification does not skip a sibling', () => {
    const pub = createStepPublisher();
    const seen: string[] = [];
    const stopB = pub.subscribe('chords', () => seen.push('b'));
    pub.subscribe('chords', () => {
      seen.push('a');
      stopB();
    });

    pub.publish('chords', 1);

    expect(seen).toEqual(['b', 'a']);
  });

  test('unsubscribing a sibling before it has been visited still lets it run', () => {
    // The defensive copy in notify() matters here: `a` runs first (it was
    // subscribed first) and unsubscribes `b` before `b` has had its turn. A
    // live Set iteration skips an entry deleted before it is reached, so this
    // is the one ordering that actually distinguishes "iterate a snapshot"
    // from "iterate the live listener set".
    const pub = createStepPublisher();
    const seen: string[] = [];
    let stopB: () => void = () => {};
    pub.subscribe('chords', () => {
      seen.push('a');
      stopB();
    });
    stopB = pub.subscribe('chords', () => seen.push('b'));

    pub.publish('chords', 1);

    expect(seen).toEqual(['a', 'b']);
  });

  test('a throwing listener does not stop the others or corrupt the value', () => {
    const pub = createStepPublisher();
    const seen: string[] = [];
    pub.subscribe('chords', () => {
      throw new Error('render exploded');
    });
    pub.subscribe('chords', () => seen.push('b'));

    expect(() => pub.publish('chords', 2)).not.toThrow();
    expect(seen).toEqual(['b']);
    expect(pub.getStep('chords')).toBe(2);
  });
});

describe('createStepPublisher — reset', () => {
  test('reset(player) returns it to 0 and notifies only on a real change', () => {
    const { pub, count } = countingPublisher();

    pub.publish('lead', 9);
    expect(count()).toBe(1);

    pub.reset('lead');
    expect(pub.getStep('lead')).toBe(0);
    expect(count()).toBe(2);

    pub.reset('lead'); // already 0
    expect(count()).toBe(2);
  });

  test('reset() with no argument resets every player', () => {
    const pub = createStepPublisher();
    pub.publish('chords', 4);
    pub.publish('lead', 5);
    pub.publish('sequencer', 6);

    pub.reset();

    expect(pub.getStep('chords')).toBe(0);
    expect(pub.getStep('lead')).toBe(0);
    expect(pub.getStep('sequencer')).toBe(0);
  });
});

// The clock is a lookahead scheduler, so a step published inline from its
// callback lands ahead of its own audio. These pin the deferral that fixes it.
describe('createStepPublisher — deferred publishing', () => {
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  test('a delayed publish does not land immediately', async () => {
    const publisher = createStepPublisher();

    publisher.publishAt('lead', 7, 40);

    expect(publisher.getStep('lead')).toBe(0);
    await sleep(70);
    expect(publisher.getStep('lead')).toBe(7);
  });

  test('a delayed publish notifies subscribers when it lands, not before', async () => {
    const publisher = createStepPublisher();
    let notified = 0;
    publisher.subscribe('lead', () => (notified += 1));

    publisher.publishAt('lead', 3, 40);
    expect(notified).toBe(0);

    await sleep(70);
    expect(notified).toBe(1);
  });

  test('a delay of zero or less publishes synchronously', () => {
    // The no-AudioContext case, and every test that does not want a timer.
    const publisher = createStepPublisher();

    publisher.publishAt('lead', 5, 0);
    expect(publisher.getStep('lead')).toBe(5);

    publisher.publishAt('lead', 6, -20);
    expect(publisher.getStep('lead')).toBe(6);
  });

  test('reset cancels a pending publish — a stopped transport must not move again', async () => {
    // Without this, stopping leaves the playhead parked a step later than the
    // user ever played to, whenever a scheduled step was still in flight.
    const publisher = createStepPublisher();
    publisher.publishAt('lead', 9, 40);

    publisher.reset('lead');
    await sleep(70);

    expect(publisher.getStep('lead')).toBe(0);
  });

  test('reset with no player cancels every player\'s pending publishes', async () => {
    const publisher = createStepPublisher();
    publisher.publishAt('lead', 9, 40);
    publisher.publishAt('chords', 9, 40);
    publisher.publishAt('sequencer', 9, 40);

    publisher.reset();
    await sleep(70);

    expect([
      publisher.getStep('lead'),
      publisher.getStep('chords'),
      publisher.getStep('sequencer'),
    ]).toEqual([0, 0, 0]);
  });

  test('resetting one player leaves another player\'s pending publish alone', async () => {
    const publisher = createStepPublisher();
    publisher.publishAt('lead', 9, 40);
    publisher.publishAt('chords', 4, 40);

    publisher.reset('lead');
    await sleep(70);

    expect(publisher.getStep('lead')).toBe(0);
    expect(publisher.getStep('chords')).toBe(4);
  });

  test('several pending publishes all land, in order', async () => {
    const publisher = createStepPublisher();
    const seen: number[] = [];
    publisher.subscribe('lead', () => seen.push(publisher.getStep('lead')));

    publisher.publishAt('lead', 1, 20);
    publisher.publishAt('lead', 2, 40);
    publisher.publishAt('lead', 3, 60);

    await sleep(110);

    expect(seen).toEqual([1, 2, 3]);
  });
});

// `shouldSubscribeToStep` is the pure gating decision behind
// `useSegmentGatedStep`: it must say yes only when the focused MixLayerId's
// own Pattern segment (segmentForFocus) is the segment asking. 'synth' is the
// MixLayerId that resolves to the 'lead' segment (focusTrack.ts's
// SEGMENT_FOR_FOCUS) — not the literal 'lead', which is a PatternSegment, not
// a MixLayerId.
describe('shouldSubscribeToStep', () => {
  test('true when the segment matches the focused segment', () => {
    expect(shouldSubscribeToStep('synth', segmentForFocus('synth'))).toBe(true);
  });

  test('false when the segment does not match the focused segment', () => {
    expect(shouldSubscribeToStep('synth', segmentForFocus('drum'))).toBe(false);
  });
});
