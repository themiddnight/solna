import { Clock } from '../clock';
import { DrumSynth } from '../drumSynth';
import { type EngineHooks, MasterRack } from '../masterRack';
import { SynthLfoBank } from '../synth/synthLfo';
import { SynthVoiceManager, type SynthVoiceManagerOptions } from '../synth/voiceManager';

export interface AudioSessionHooks extends EngineHooks {
  readonly generation: number;
}

/** Narrow construction seam used to prove per-generation allocation counts. */
export interface AudioSessionFactories {
  createLfoBank(ctx: BaseAudioContext): SynthLfoBank;
  createSynthManager(options: SynthVoiceManagerOptions): SynthVoiceManager;
}

const DEFAULT_FACTORIES: AudioSessionFactories = {
  createLfoBank: (ctx) => new SynthLfoBank(ctx),
  createSynthManager: (options) => new SynthVoiceManager(options),
};

/**
 * Render-only engine options (stems, ADR-0038). Omitted = today's graph, byte
 * for byte; the realtime singleton never passes one (R309).
 */
export interface RenderEngineOptions {
  /** Where the master rack's last dynamics stage connects instead of `ctx.destination`. */
  readonly masterOutput?: AudioNode;
}

/** One complete set of objects bound to one Web Audio context. */
export class AudioSession {
  readonly generation: number;
  readonly masterRack: MasterRack;
  readonly drumSynth: DrumSynth;
  readonly clock: Clock;
  readonly lfoBank: SynthLfoBank;
  readonly synthManager: SynthVoiceManager;

  private disposed = false;
  private readonly stopTransportOriginSync: () => void;

  private constructor(
    readonly context: BaseAudioContext,
    hooks: AudioSessionHooks,
    factories: AudioSessionFactories,
    options: RenderEngineOptions,
  ) {
    this.generation = hooks.generation;
    this.masterRack = new MasterRack();
    this.drumSynth = new DrumSynth(this.masterRack, hooks);
    this.clock = new Clock(this.masterRack, hooks);
    this.lfoBank = factories.createLfoBank(context);
    this.synthManager = factories.createSynthManager({
      ctx: context,
      destinationsFor: (source) =>
        this.masterRack.dryGain ? { output: this.masterRack.getSourceTap(source) } : null,
      lfoBank: this.lfoBank,
    });

    this.masterRack.bind(context, options.masterOutput);
    this.drumSynth.bind(context);
    this.clock.bind(context);
    this.masterRack.setupMasterChain();
    if (!('startRendering' in context)) this.clock.createClickBuffers();
    this.stopTransportOriginSync = this.clock.subscribeTransportOrigin((time) => {
      this.lfoBank.setTransportOrigin(time);
    });
  }

  static create(
    ctx: BaseAudioContext,
    hooks: AudioSessionHooks,
    factories: AudioSessionFactories = DEFAULT_FACTORIES,
    options: RenderEngineOptions = {},
  ): AudioSession {
    return new AudioSession(ctx, hooks, factories, options);
  }

  realtimeCtx(): AudioContext | null {
    if ('startRendering' in this.context) return null;
    return this.context as AudioContext;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const at = this.context.currentTime;
    this.stopTransportOriginSync();
    this.clock.dispose(at);
    this.synthManager.dispose(at);
    this.lfoBank.dispose(at);
    this.drumSynth.dispose(at);
    this.masterRack.dispose(at);

    const realtime = this.realtimeCtx();
    if (!realtime) return;
    try {
      await realtime.close();
    } catch {
      // Context shutdown is best-effort; owned graph resources are already gone.
    }
  }
}
