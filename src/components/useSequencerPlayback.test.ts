import { afterEach, describe, test, expect, spyOn } from 'bun:test';
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

import { fireSequencerStepEvents } from './useSequencerPlayback';
import { audioEngine } from '../audio/engine';
import { DEFAULT_VELOCITY } from '../audio/constants';
import { useAppStore } from '../store/store';

describe('the sequencer fader is a bus gain, never a velocity', () => {
  const initialVolume = useAppStore.getState().masterSequencerVolume;
  afterEach(() => {
    (audioEngine.triggerDrum as unknown as { mockRestore?: () => void }).mockRestore?.();
    (audioEngine.triggerSynthNoteOn as unknown as { mockRestore?: () => void }).mockRestore?.();
    useAppStore.getState().setMasterSequencerVolume(initialVolume);
  });

  // The bug this pins: masterSequencerVolume was handed to triggerPad/
  // playbackNoteOn as the velocity AND set on the sequencer source bus, so
  // drum output was proportional to the fader SQUARED. Both values default
  // to 0.8, so a test that only checks the default is inaudible to the bug —
  // this moves the fader to a value that is NOT 0.8, reads it back off the
  // LIVE store the way the clock callback does, and asserts the engine
  // never sees that value as a velocity.
  test('a fader moved away from 0.8 never reaches triggerDrum as velocity', () => {
    const drumSpy = spyOn(audioEngine, 'triggerDrum').mockImplementation(() => {});
    useAppStore.getState().setMasterSequencerVolume(0.3);
    const live = useAppStore.getState();
    expect(live.masterSequencerVolume).toBe(0.3);
    fireSequencerStepEvents([{ kind: 'pad', instrument: 'kick' }], live.synthParams, 1);
    expect(drumSpy).toHaveBeenCalledWith('kick', DEFAULT_VELOCITY, 1);
    expect(drumSpy.mock.calls[0]?.[1]).not.toBe(live.masterSequencerVolume);
  });

  test('a fader moved away from 0.8 never reaches triggerSynthNoteOn as velocity', () => {
    const noteSpy = spyOn(audioEngine, 'triggerSynthNoteOn').mockImplementation(() => {});
    useAppStore.getState().setMasterSequencerVolume(0.3);
    const live = useAppStore.getState();
    fireSequencerStepEvents(
      [{ kind: 'note', note: 'C4', release: 0.4, offsetSec: 0.1 }],
      live.synthParams,
      1,
    );
    expect(noteSpy.mock.calls[0]?.[2]).toBe(DEFAULT_VELOCITY);
    expect(noteSpy.mock.calls[0]?.[2]).not.toBe(live.masterSequencerVolume);
  });

  // Static pin, cheap and precise: the exact buggy assignment/call shapes
  // must not reappear even if a future edit re-threads a volume variable
  // through by another name.
  test('the source no longer threads masterSequencerVolume into a velocity argument', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/useSequencerPlayback.ts'),
      'utf8',
    );
    expect(source).not.toContain('triggerPad(event.instrument, live.masterSequencerVolume');
    expect(source).not.toContain('const volume = live.masterSequencerVolume');
    expect(source).toContain('DEFAULT_VELOCITY');
  });
});
