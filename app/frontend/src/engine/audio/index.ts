export {
  APP_MAX_POLYPHONY,
  PREFERRED_SAMPLE_RATE,
  AUDIO_CONFIG,
  ADAPTIVE_AUDIO_CONFIG,
  getOptimalAudioConfig,
  getAdaptiveAudioConfig,
  shouldReduceQuality,
  getPerformanceMetrics,
} from "./audioConfig";
export { AudioContextManager } from "./audioContextManager";
export { setupAutoUnlock } from "./audioUnlock";
export {
  buildInputConstraints,
  defaultCleanInputEnv,
  PROCESSING_CONSTRAINTS,
  acquireCleanInput,
  verifyCleanInput,
  type CleanInputOptions,
  type CleanInputEnv,
  type ProcessingConstraint,
  type CleanInputReport,
  type CleanInputVerdict,
} from "./cleanInput";
