import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../engine';
import { startArpClock, type ArpStateRef } from './arpPlayback';
import { TRACK_ARP_DEFAULTS } from '@/store/initialState';
import { useAppStore } from '@/store/store';
import type { SynthControlTarget } from '@/utils/synthControl';

function arpRef(): ArpStateRef {
  return {
    current: {
      heldTargets: new Map(),
      synth: useAppStore.getState().synthParams,
      arp: { ...TRACK_ARP_DEFAULTS.synth, active: true },
      target: 'synth',
      triggeredTargets: new Set<SynthControlTarget>(),
      bpm: 120,
    },
  };
}

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => { for (const spy of spies.splice(0)) spy.mockRestore(); });

describe('startArpClock', () => {
  test('subscribes the clock once and unsubscribes on cleanup', () => {
    let unsubscribed = 0;
    const subscribe = spyOn(audioEngine, 'subscribeClock').mockImplementation(() => () => { unsubscribed++; });
    spies.push(subscribe, spyOn(audioEngine, 'getAudioContext').mockImplementation(() => null));
    const stop = startArpClock(arpRef());
    expect(subscribe).toHaveBeenCalledTimes(1);
    stop();
    expect(unsubscribed).toBe(1);
  });

  test('cleanup releases the buses on the LATEST ref, not the one it started with', () => {
    const released: Array<[string, string]> = [];
    spies.push(
      spyOn(audioEngine, 'subscribeClock').mockImplementation(() => () => {}),
      spyOn(audioEngine, 'getAudioContext').mockImplementation(() => ({}) as BaseAudioContext),
      spyOn(audioEngine, 'releaseSoundingVoices').mockImplementation((target, _time, owner) => {
        released.push([target, owner]);
      }),
    );
    const ref = arpRef();
    const stop = startArpClock(ref);
    ref.current = { ...ref.current, triggeredTargets: new Set<SynthControlTarget>(['synth', 'fx']) };
    stop();
    expect(new Set(released.map(([target]) => target))).toEqual(new Set(['synth', 'fx']));
    expect(released.every(([, owner]) => owner === 'arp')).toBe(true);
  });
});
