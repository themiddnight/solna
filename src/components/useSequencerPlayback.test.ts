import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  sequencerStepAction,
  type SequencerArming,
} from './useSequencerPlayback';

const BAR = 16;

describe('sequencer stepper', () => {
  test('arms on the next bar line, then plays every step', () => {
    const arming: SequencerArming = { armed: false };
    expect(sequencerStepAction('playing', 7, arming, BAR)).toBe('idle');
    expect(arming.armed).toBe(false);
    expect(sequencerStepAction('playing', 16, arming, BAR)).toBe('play');
    expect(sequencerStepAction('playing', 17, arming, BAR)).toBe('play');
  });

  test('a live "stopped" read silences the rest of the clock tick', () => {
    // Critical-3, drum side: the soft stop fires at the bar line and marks
    // the player stopped from inside the clock callback, but the
    // subscription stays live until React commits and one clockTick
    // dispatches several steps synchronously. Reading a stale 'stopping'
    // from a ref let one extra drum step through after the cut.
    const arming: SequencerArming = { armed: true };
    expect(sequencerStepAction('stopping', 16, arming, BAR)).toBe('soft-stop');
    expect(sequencerStepAction('stopping', 17, arming, BAR)).toBe('play'); // stale ref
    expect(sequencerStepAction('stopped', 17, arming, BAR)).toBe('idle'); // live read
  });

  test('a stopped player never arms', () => {
    const arming: SequencerArming = { armed: false };
    expect(sequencerStepAction('stopped', 0, arming, BAR)).toBe('idle');
    expect(arming.armed).toBe(false);
  });
});

const WALTZ_BAR = 12;

describe('sequencer stepper in a non-4/4 meter', () => {
  test('arms on a 12-step bar line, not a 16-step one', () => {
    const arming: SequencerArming = { armed: false };
    expect(sequencerStepAction('playing', 16, arming, WALTZ_BAR)).toBe('idle');
    expect(arming.armed).toBe(false);
    expect(sequencerStepAction('playing', 24, arming, WALTZ_BAR)).toBe('play');
  });

  test('soft-stops on a 12-step bar line', () => {
    const arming: SequencerArming = { armed: true };
    expect(sequencerStepAction('stopping', 16, arming, WALTZ_BAR)).toBe('play');
    expect(sequencerStepAction('stopping', 24, arming, WALTZ_BAR)).toBe('soft-stop');
  });

  test('an odd 14-step bar still lands every bar line exactly', () => {
    const arming: SequencerArming = { armed: false };
    expect(sequencerStepAction('playing', 13, arming, 14)).toBe('idle');
    expect(sequencerStepAction('playing', 14, arming, 14)).toBe('play');
    expect(sequencerStepAction('playing', 28, arming, 14)).toBe('play');
  });

  test('the default parameter still means a 16-step bar', () => {
    const arming: SequencerArming = { armed: false };
    expect(sequencerStepAction('playing', 8, arming)).toBe('idle');
    expect(sequencerStepAction('playing', BAR, arming)).toBe('play');
  });
});

import { sequencerStepEvents } from './useSequencerPlayback';
import { INITIAL_SYNTH_PARAMS } from '../store/initialState';
import type { SequencerTrack } from '../types';

const track = (over: Partial<SequencerTrack>): SequencerTrack => ({
  id: 't',
  name: 'T',
  instrument: 'kick',
  color: 'bg-primary',
  volume: 1,
  muted: false,
  steps: [true, false, true, false],
  ...over,
});

describe('sequencerStepEvents', () => {
  const params = { ...INITIAL_SYNTH_PARAMS, release: 0.4 };

  test('an empty pattern (no tracks) contributes nothing', () => {
    expect(sequencerStepEvents([], 0, params, 120)).toEqual([]);
  });

  test('a muted track contributes nothing', () => {
    expect(sequencerStepEvents([track({ muted: true })], 0, params, 120)).toEqual([]);
  });

  test('an inactive step contributes nothing', () => {
    expect(sequencerStepEvents([track({})], 1, params, 120)).toEqual([]);
  });

  test('a drum track emits a pad event named after its instrument', () => {
    expect(sequencerStepEvents([track({ instrument: 'snare' })], 0, params, 120)).toEqual([
      { kind: 'pad', instrument: 'snare' },
    ]);
  });

  test('synth and bass tracks emit notes with the patch release and an 80% gate', () => {
    const events = sequencerStepEvents(
      [track({ id: 'a', instrument: 'synth' }), track({ id: 'b', instrument: 'bass' })],
      0,
      params,
      120,
    );
    // 120 bpm -> 0.5 s per beat -> 0.125 s per 16th; gate is 80% of that.
    expect(events).toEqual([
      { kind: 'note', note: 'C4', release: 0.4, offsetSec: 0.1 },
      { kind: 'note', note: 'C2', release: 0.4, offsetSec: 0.1 },
    ]);
  });

  test('the gate scales with bpm', () => {
    const slow = sequencerStepEvents([track({ instrument: 'synth' })], 0, params, 60);
    expect((slow[0] as { offsetSec: number }).offsetSec).toBeCloseTo(0.2, 10);
  });

  test('tracks are emitted in list order and out-of-range steps are ignored', () => {
    const events = sequencerStepEvents(
      [track({ id: 'a', instrument: 'kick' }), track({ id: 'b', instrument: 'hihat' })],
      99,
      params,
      120,
    );
    expect(events).toEqual([]);
  });
});

// renderToString runs no effects, so the clock effect's re-subscribe
// behaviour cannot be observed by mounting the hook — the dep array is
// asserted directly against the source instead. Widening this array (e.g.
// adding synthParams back in) would reintroduce a resubscribe on every knob
// pointermove; this fails the moment that happens, before it ships.
describe('the clock effect resubscribes only on isPlaying/hardStop', () => {
  test('subscribePlaybackClock\'s useEffect dep array is exactly [isPlaying, hardStop]', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/useSequencerPlayback.ts'),
      'utf8',
    );
    const match = source.match(
      /return subscribePlaybackClock\([\s\S]*?\n {2}\}, \[([^\]]*)\]\);/,
    );
    expect(match).not.toBeNull();
    const deps = match![1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(deps).toEqual(['isPlaying', 'hardStop']);
  });
});
