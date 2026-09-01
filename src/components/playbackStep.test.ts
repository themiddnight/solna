import { describe, expect, test } from 'bun:test';
import { createStepPublisher } from './playbackStep';

describe('createStepPublisher', () => {
  test('every player starts at step 0', () => {
    const pub = createStepPublisher();
    expect(pub.getStep('chords')).toBe(0);
    expect(pub.getStep('lead')).toBe(0);
    expect(pub.getStep('sequencer')).toBe(0);
  });

  test('publish records the step and notifies that player', () => {
    const pub = createStepPublisher();
    let notified = 0;
    pub.subscribe('lead', () => {
      notified += 1;
    });

    pub.publish('lead', 5);

    expect(pub.getStep('lead')).toBe(5);
    expect(notified).toBe(1);
  });

  test('publishing the SAME step again does not notify', () => {
    // The bail-out matters: the clock re-dispatches a step whenever the stall
    // detector re-anchors the grid, and a repeated notification would be a
    // guaranteed re-render for an unchanged value.
    const pub = createStepPublisher();
    let notified = 0;
    pub.subscribe('lead', () => {
      notified += 1;
    });

    pub.publish('lead', 5);
    pub.publish('lead', 5);
    pub.publish('lead', 5);

    expect(notified).toBe(1);
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

  test('every listener on a player is notified', () => {
    const pub = createStepPublisher();
    const seen: string[] = [];
    pub.subscribe('chords', () => seen.push('a'));
    pub.subscribe('chords', () => seen.push('b'));

    pub.publish('chords', 1);

    expect(seen).toEqual(['a', 'b']);
  });

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

  test('reset(player) returns it to 0 and notifies only on a real change', () => {
    const pub = createStepPublisher();
    let notified = 0;
    pub.subscribe('lead', () => {
      notified += 1;
    });

    pub.publish('lead', 9);
    expect(notified).toBe(1);

    pub.reset('lead');
    expect(pub.getStep('lead')).toBe(0);
    expect(notified).toBe(2);

    pub.reset('lead'); // already 0
    expect(notified).toBe(2);
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

  test('instances are isolated from each other', () => {
    const a = createStepPublisher();
    const b = createStepPublisher();

    a.publish('lead', 8);

    expect(b.getStep('lead')).toBe(0);
  });
});
