import type { AudioClockSample, AudioHealthPhase } from './health';
import { advanceAudioHealth, initialAudioHealthState } from './health';
import type { AudioRuntimePolicy } from './policy';

const MAX_RECENT_SAMPLES = 300;

export interface AudioHealthSnapshot {
  phase: AudioHealthPhase;
  lastRatio: number | null;
  suspiciousCount: number;
  generation: number;
  runtimePolicyId: AudioRuntimePolicy['id'];
}

export interface AudioClockEvidence {
  elapsedMs: number;
  audioTimeSec: number;
  ratio: number | null;
  contextState: AudioContextState | 'uninitialized';
  visible: boolean;
}

export interface HealthMonitorScheduler {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

type AudioClockContext = Pick<BaseAudioContext, 'currentTime' | 'state'>;
type AudioHealthListener = (snapshot: AudioHealthSnapshot) => void;
type EvidenceBaseline = Pick<AudioClockSample, 'wallTimeMs' | 'audioTimeSec'>;

interface AudioHealthMonitorOptions {
  policy: AudioRuntimePolicy;
  getContext: () => AudioClockContext | null;
  now?: () => number;
  isVisible?: () => boolean;
  scheduler?: HealthMonitorScheduler;
}

const DEFAULT_SCHEDULER: HealthMonitorScheduler = {
  setInterval: (callback, intervalMs) => globalThis.setInterval(callback, intervalMs),
  clearInterval: (handle) =>
    globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>),
};

export class AudioHealthMonitor {
  private health = initialAudioHealthState();
  private generation = 0;
  private running = false;
  private timer: unknown;
  private evidenceBaseline: EvidenceBaseline | null = null;
  private readonly evidence: AudioClockEvidence[] = [];
  private readonly listeners = new Set<AudioHealthListener>();
  private readonly policy: AudioRuntimePolicy;
  private readonly getContext: () => AudioClockContext | null;
  private readonly now: () => number;
  private readonly isVisible: () => boolean;
  private readonly scheduler: HealthMonitorScheduler;

  constructor(options: AudioHealthMonitorOptions) {
    this.policy = options.policy;
    this.getContext = options.getContext;
    this.now = options.now ?? (() => performance.now());
    this.isVisible =
      options.isVisible ?? (() => globalThis.document?.visibilityState !== 'hidden');
    this.scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
  }

  start(): void {
    if (this.running) return;
    this.timer = this.scheduler.setInterval(() => this.sample(), this.policy.sampleIntervalMs);
    this.running = true;
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.scheduler.clearInterval(this.timer);
  }

  resetGeneration(generation: number): void {
    const previousPhase = this.health.phase;
    this.generation = generation;
    this.health = initialAudioHealthState();
    this.evidenceBaseline = null;
    this.evidence.length = 0;
    if (previousPhase !== this.health.phase) this.notify();
  }

  subscribe(listener: AudioHealthListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): AudioHealthSnapshot {
    return {
      phase: this.health.phase,
      lastRatio: this.health.lastRatio,
      suspiciousCount: this.health.suspiciousCount,
      generation: this.generation,
      runtimePolicyId: this.policy.id,
    };
  }

  recentSamples(): readonly AudioClockEvidence[] {
    return this.evidence.slice();
  }

  private sample(): void {
    const context = this.getContext();
    const wallTimeMs = this.now();
    const visible = this.isVisible();
    if (context === null) {
      this.evidenceBaseline = null;
      this.updateHealth({
        wallTimeMs,
        audioTimeSec: 0,
        active: false,
        visible,
        contextState: 'uninitialized',
      });
      return;
    }

    const evidence = this.createEvidence(wallTimeMs, context, visible);
    this.evidence.push(evidence);
    if (this.evidence.length > MAX_RECENT_SAMPLES) this.evidence.shift();

    this.updateHealth({
      wallTimeMs,
      audioTimeSec: context.currentTime,
      active: true,
      visible,
      contextState: context.state,
    });
  }

  private createEvidence(
    wallTimeMs: number,
    context: AudioClockContext,
    visible: boolean,
  ): AudioClockEvidence {
    const baseline = this.evidenceBaseline;
    const elapsedMs = baseline === null ? 0 : wallTimeMs - baseline.wallTimeMs;
    const audioElapsedSec =
      baseline === null ? 0 : context.currentTime - baseline.audioTimeSec;
    const validSample =
      visible &&
      context.state === 'running' &&
      Number.isFinite(wallTimeMs) &&
      Number.isFinite(context.currentTime);
    const validInterval =
      validSample &&
      baseline !== null &&
      elapsedMs > 0 &&
      elapsedMs <= this.policy.maxWallGapMs &&
      audioElapsedSec >= 0;
    const candidateRatio = validInterval ? audioElapsedSec / (elapsedMs / 1000) : null;
    const ratio = candidateRatio !== null && Number.isFinite(candidateRatio)
      ? candidateRatio
      : null;

    this.evidenceBaseline = ratio !== null || (validSample && baseline === null)
      ? { wallTimeMs, audioTimeSec: context.currentTime }
      : null;

    return {
      elapsedMs,
      audioTimeSec: context.currentTime,
      ratio,
      contextState: context.state,
      visible,
    };
  }

  private updateHealth(sample: AudioClockSample): void {
    const next = advanceAudioHealth(
      this.health,
      sample,
      this.policy,
    );
    const phaseChanged = next.phase !== this.health.phase;
    this.health = next;
    if (phaseChanged) this.notify();
  }

  private notify(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
