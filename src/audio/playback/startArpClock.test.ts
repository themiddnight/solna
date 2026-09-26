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
    const ctx = {} as BaseAudioContext;
    const subscribe = spyOn(audioEngine, 'subscribeClock').mockImplementation(() => () => { unsubscribed++; });
    spies.push(subscribe, spyOn(audioEngine, 'getAudioContext').mockImplementation(() => ctx));
    const clock = startArpClock(arpRef());
    clock.ensureRunning();
    expect(subscribe).toHaveBeenCalledTimes(1);
    clock.stop();
    expect(unsubscribed).toBe(1);
  });

  // The engine hands out a clock subscription per SESSION and a no-op before
  // one exists. An arp armed before the first gesture (a vibe or a persisted
  // project that ships the arp on, then a reload) used to subscribe into that
  // no-op and stay silent until it was toggled off and on again.
  test('an arp armed before the audio session exists attaches once it does', () => {
    let ctx: BaseAudioContext | null = null;
    const subscribe = spyOn(audioEngine, 'subscribeClock').mockImplementation(() => () => {});
    spies.push(subscribe, spyOn(audioEngine, 'getAudioContext').mockImplementation(() => ctx));
    const clock = startArpClock(arpRef());
    expect(subscribe).toHaveBeenCalledTimes(0);
    clock.ensureRunning();
    expect(subscribe).toHaveBeenCalledTimes(0);

    ctx = {} as BaseAudioContext;
    clock.ensureRunning();
    clock.ensureRunning();
    expect(subscribe).toHaveBeenCalledTimes(1);
    clock.stop();
  });

  test('a recreated session moves the subscription to the new clock', () => {
    let ctx = {} as BaseAudioContext;
    let unsubscribed = 0;
    const subscribe = spyOn(audioEngine, 'subscribeClock').mockImplementation(() => () => { unsubscribed++; });
    spies.push(subscribe, spyOn(audioEngine, 'getAudioContext').mockImplementation(() => ctx));
    const clock = startArpClock(arpRef());
    expect(subscribe).toHaveBeenCalledTimes(1);

    ctx = {} as BaseAudioContext;
    clock.ensureRunning();
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(unsubscribed).toBe(1);
    clock.stop();
    expect(unsubscribed).toBe(2);
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
    const clock = startArpClock(ref);
    ref.current = { ...ref.current, triggeredTargets: new Set<SynthControlTarget>(['synth', 'fx']) };
    clock.stop();
    expect(new Set(released.map(([target]) => target))).toEqual(new Set(['synth', 'fx']));
    expect(released.every(([, owner]) => owner === 'arp')).toBe(true);
  });
});
