import type { AudioRuntimePolicy } from './policy';

export type AudioHealthPhase = 'idle' | 'healthy' | 'suspected' | 'unhealthy';

export interface AudioClockSample {
  wallTimeMs: number;
  audioTimeSec: number;
  active: boolean;
  visible: boolean;
  contextState: AudioContextState | 'uninitialized';
}

export interface AudioHealthState {
  phase: AudioHealthPhase;
  previous: AudioClockSample | null;
  suspiciousCount: number;
  lastRatio: number | null;
}

export function initialAudioHealthState(): AudioHealthState {
  return {
    phase: 'idle',
    previous: null,
    suspiciousCount: 0,
    lastRatio: null,
  };
}

export function advanceAudioHealth(
  state: AudioHealthState,
  sample: AudioClockSample,
  policy: AudioRuntimePolicy,
): AudioHealthState {
  if (!isValidSample(sample)) return resetBaseline(state);

  if (state.previous === null) {
    return {
      phase: state.phase === 'unhealthy' ? 'unhealthy' : 'healthy',
      previous: sample,
      suspiciousCount: 0,
      lastRatio: null,
    };
  }

  const elapsedMs = sample.wallTimeMs - state.previous.wallTimeMs;
  const elapsedAudioSec = sample.audioTimeSec - state.previous.audioTimeSec;
  if (
    elapsedMs <= 0 ||
    elapsedMs > policy.maxWallGapMs ||
    elapsedAudioSec < 0
  ) {
    return resetBaseline(state);
  }

  const ratio = elapsedAudioSec / (elapsedMs / 1000);
  if (!Number.isFinite(ratio)) return resetBaseline(state);

  if (state.phase === 'unhealthy') return state;

  if (ratio < policy.minClockRatio || ratio > policy.maxClockRatio) {
    const suspiciousCount = state.suspiciousCount + 1;
    return {
      phase: suspiciousCount >= policy.suspiciousSamplesToFail ? 'unhealthy' : 'suspected',
      previous: sample,
      suspiciousCount,
      lastRatio: ratio,
    };
  }

  return {
    phase: 'healthy',
    previous: sample,
    suspiciousCount: 0,
    lastRatio: ratio,
  };
}

function isValidSample(sample: AudioClockSample): boolean {
  return (
    sample.active &&
    sample.visible &&
    sample.contextState === 'running' &&
    Number.isFinite(sample.wallTimeMs) &&
    Number.isFinite(sample.audioTimeSec)
  );
}

function resetBaseline(state: AudioHealthState): AudioHealthState {
  return {
    phase: state.phase === 'unhealthy' ? 'unhealthy' : 'idle',
    previous: null,
    suspiciousCount: 0,
    lastRatio: null,
  };
}
