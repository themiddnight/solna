import { describe, test, expect } from 'bun:test';
import { sequencerStepEvents } from './sequencerSteps';
import { synthParamsFixture } from './testFakes';
import type { SequencerTrack } from '@/types';

const track = (over: Partial<SequencerTrack>): SequencerTrack => ({
  id: 't',
  name: 'T',
  instrument: 'kick',
  color: 'bg-primary',
  volume: 0, // DEFAULT_FADER_DB (unity 0 dB) — DEV-386, was linear 1 pre-conversion
  muted: false,
  steps: [true, false, true, false],
  ...over,
});

describe('sequencerStepEvents', () => {
  const params = synthParamsFixture({ release: 0.4 });

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
