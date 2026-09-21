import { describe, expect, spyOn, test } from 'bun:test';
import { masterChainCtx } from '../engineTestHelpers';
import { Clock } from '../clock';
import { DrumSynth } from '../drumSynth';
import { MasterRack } from '../masterRack';
import { SynthLfoBank } from '../synth/synthLfo';
import { SynthVoiceManager } from '../synth/voiceManager';
import { AudioSession, type AudioSessionHooks } from './audioSession';

function hooks(generation = 1): AudioSessionHooks {
  return {
    generation,
    markActivity: () => {},
    wakeIfIdle: () => {},
    realtimeCtx: () => null,
  };
}

function realtimeContext() {
  const ctx = masterChainCtx() as unknown as BaseAudioContext & {
    close: () => Promise<void>;
  };
  ctx.close = async () => {};
  return ctx;
}

describe('AudioSession ownership', () => {
  test('binds every subsystem once and builds exactly one master chain', () => {
    const rackBind = spyOn(MasterRack.prototype, 'bind');
    const rackSetup = spyOn(MasterRack.prototype, 'setupMasterChain');
    const drumBind = spyOn(DrumSynth.prototype, 'bind');
    const clockBind = spyOn(Clock.prototype, 'bind');
    try {
      AudioSession.create(realtimeContext(), hooks());
      expect(rackBind).toHaveBeenCalledTimes(1);
      expect(rackSetup).toHaveBeenCalledTimes(1);
      expect(drumBind).toHaveBeenCalledTimes(1);
      expect(clockBind).toHaveBeenCalledTimes(1);
    } finally {
      rackBind.mockRestore();
      rackSetup.mockRestore();
      drumBind.mockRestore();
      clockBind.mockRestore();
    }
  });

  test('owns one isolated generation and builds one master chain', () => {
    const firstCtx = realtimeContext();
    const secondCtx = realtimeContext();
    const first = AudioSession.create(firstCtx, hooks(7));
    const second = AudioSession.create(secondCtx, hooks(8));

    expect(first.generation).toBe(7);
    expect(first.context).toBe(firstCtx);
    expect(first.masterRack).not.toBe(second.masterRack);
    expect(first.drumSynth).not.toBe(second.drumSynth);
    expect(first.clock).not.toBe(second.clock);
    expect(first.lfoBank).not.toBe(second.lfoBank);
    expect(first.synthManager).not.toBe(second.synthManager);
    const firstAnalyser = first.masterRack.getAnalyser();
    const secondAnalyser = second.masterRack.getAnalyser();
    const firstSource = first.masterRack.getSourceAnalyser('synth');
    const secondSource = second.masterRack.getSourceAnalyser('synth');
    expect(firstAnalyser).not.toBeNull();
    expect(secondAnalyser).not.toBeNull();
    expect(firstSource).not.toBeNull();
    expect(secondSource).not.toBeNull();
    expect(firstAnalyser).not.toBe(secondAnalyser);
    expect(firstSource).not.toBe(secondSource);
  });

  test('constructs exactly one LFO bank and one voice manager per generation', () => {
    let lfoCreations = 0;
    let managerCreations = 0;
    const session = AudioSession.create(realtimeContext(), hooks(), {
      createLfoBank: (ctx) => {
        lfoCreations += 1;
        return new SynthLfoBank(ctx);
      },
      createSynthManager: (options) => {
        managerCreations += 1;
        return new SynthVoiceManager(options);
      },
    });

    expect(lfoCreations).toBe(1);
    expect(managerCreations).toBe(1);
    expect(session.lfoBank).toBeInstanceOf(SynthLfoBank);
    expect(session.synthManager).toBeInstanceOf(SynthVoiceManager);
  });

  test('disposes dependencies before the rack and closes a realtime context once', async () => {
    const ctx = realtimeContext();
    const close = spyOn(ctx, 'close');
    const session = AudioSession.create(ctx, hooks());
    const order: string[] = [];
    spyOn(session.clock, 'dispose').mockImplementation(() => { order.push('clock'); });
    spyOn(session.synthManager, 'dispose').mockImplementation(() => { order.push('voices'); });
    spyOn(session.lfoBank, 'dispose').mockImplementation(() => { order.push('lfo'); });
    spyOn(session.drumSynth, 'dispose').mockImplementation(() => { order.push('drums'); });
    spyOn(session.masterRack, 'dispose').mockImplementation(() => { order.push('rack'); });

    await session.dispose();
    await session.dispose();

    expect(order).toEqual(['clock', 'voices', 'lfo', 'drums', 'rack']);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test('does not close a caller-owned offline context', async () => {
    const ctx = Object.assign(masterChainCtx(), {
      startRendering: async () => { throw new Error('not rendered'); },
      close: async () => { throw new Error('offline context must remain caller-owned'); },
    }) as unknown as BaseAudioContext;
    const session = AudioSession.create(ctx, hooks());

    await session.dispose();
  });
});
