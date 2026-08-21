import { getWebRTCCapabilities, type WebRTCCapabilities } from "@/shared/webrtc/webrtcCapabilities";

/**
 * The processing stages a browser may apply to a microphone before we ever see the samples.
 * Clean mode asks for all of them off; normal mode asks for them on.
 *
 * WebKit exposes only `echoCancellation` — `noiseSuppression` and `autoGainControl` are
 * unimplemented there (WebKit bug 204444), and `echoCancellation: false` acts as the master
 * switch that moves capture off the voice-processing unit (WebKit bug 179411, resolved fixed).
 * `voiceIsolation` is the reverse: a Chromium constraint that WebKit does not implement.
 * Neither case needs a browser check here — the supported-constraints dictionary decides.
 */
export const PROCESSING_CONSTRAINTS = [
  "echoCancellation",
  "noiseSuppression",
  "autoGainControl",
  "voiceIsolation",
] as const;

export type ProcessingConstraint = (typeof PROCESSING_CONSTRAINTS)[number];

export interface CleanInputOptions {
  /** True = ask for unprocessed audio. Arrange passes `true` unconditionally. */
  cleanMode: boolean;
  deviceId?: string;
  /** 1 for voice (mono is all WebRTC carries), 2 for recording so stereo interfaces survive. */
  channelCount: 1 | 2;
  /** Only consulted in normal mode; clean mode always forces auto gain off. */
  autoGain?: boolean;
}

export interface CleanInputEnv {
  supported: MediaTrackSupportedConstraints;
  capabilities: WebRTCCapabilities;
}

function readSupportedConstraints(): MediaTrackSupportedConstraints {
  try {
    // The DOM lib types treat mediaDevices/getSupportedConstraints as always present, but
    // older WebKit lacks the API entirely — the optional chains are defensive, not redundant.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return navigator.mediaDevices?.getSupportedConstraints?.() ?? {};
  } catch {
    // Older WebKit throws instead of returning a dictionary.
    return {};
  }
}

export function defaultCleanInputEnv(): CleanInputEnv {
  return { supported: readSupportedConstraints(), capabilities: getWebRTCCapabilities() };
}

/**
 * Build the `audio` constraints for a microphone request.
 *
 * Every constraint is gated on the browser actually exposing it: sending a key a browser does
 * not know is silently ignored, which would make the request look stricter than it is. What the
 * browser *did* apply is a separate question, answered elsewhere by verification against
 * `getSettings()`.
 */
export function buildInputConstraints(
  options: CleanInputOptions,
  env: CleanInputEnv = defaultCleanInputEnv(),
): MediaTrackConstraints {
  const { cleanMode: isCleanMode, deviceId, channelCount, autoGain: hasAutoGain } = options;
  const { supported, capabilities } = env;
  const supports = (name: string): boolean =>
    Boolean((supported as Record<string, unknown>)[name]);

  const constraints: MediaTrackConstraints & Record<string, unknown> = {};

  if (supports("channelCount")) {
    constraints.channelCount = channelCount;
  }

  if (deviceId !== undefined && deviceId !== "") {
    constraints.deviceId = { exact: deviceId };
  }

  for (const name of PROCESSING_CONSTRAINTS) {
    if (!supports(name)) continue;
    constraints[name] = isCleanMode ? false : true;
  }

  // Clean mode hands gain to the manual slider; normal mode follows the user's preference.
  if (supports("autoGainControl")) {
    constraints.autoGainControl = isCleanMode ? false : hasAutoGain === true;
  }

  // Setting sampleRate breaks getUserMedia on WebKit — request it nowhere else than where it
  // is both exposed and safe.
  if (supports("sampleRate") && !capabilities.isSafari && !capabilities.isIOS) {
    constraints.sampleRate = capabilities.optimalSampleRate;
  }

  if (supports("latency")) {
    constraints.latency = isCleanMode
      ? capabilities.cleanModeLatencyHint
      : capabilities.normalModeLatencyHint;
  }

  // Chromium's legacy goog* extensions. Modern Chrome honours the standard constraints above,
  // so these are believed redundant, but they are carried over unchanged from the voice path
  // rather than dropped as an untested behaviour change in a refactor.
  if (capabilities.supportsGoogConstraints) {
    Object.assign(constraints, {
      googEchoCancellation: !isCleanMode,
      googNoiseSuppression: !isCleanMode,
      googHighpassFilter: !isCleanMode,
      googTypingNoiseDetection: !isCleanMode,
      googAutoGainControl: isCleanMode ? false : hasAutoGain === true,
      googNoiseSuppression2: !isCleanMode,
      googAudioMirroring: false,
      googDAEchoCancellation: !isCleanMode,
      googBeamforming: !isCleanMode,
      googArrayGeometry: !isCleanMode,
      googAudioProcessing: !isCleanMode,
      googExperimentalEchoCancellation: !isCleanMode,
      googExperimentalNoiseSuppression: !isCleanMode,
      googExperimentalAutoGainControl: isCleanMode ? false : hasAutoGain === true,
      googExperimentalEchoCancellation3: !isCleanMode,
      googDucking: false,
    });
  }

  return constraints;
}

export type CleanInputVerdict = "clean" | "partial" | "unknown";

export interface CleanInputReport {
  /** What we asked for, per stage the browser exposes. */
  requested: Partial<Record<ProcessingConstraint, boolean>>;
  /** What `getSettings()` reported back. `undefined` = the browser did not say. */
  actual: Partial<Record<ProcessingConstraint, boolean | undefined>>;
  /** Stages this browser offers no control over at all. */
  unsupported: ProcessingConstraint[];
  verdict: CleanInputVerdict;
  /** True when the `exact` request succeeded, so the platform genuinely committed. */
  exactHonoured: boolean;
}

/**
 * Compare what we asked for against what the track actually reports.
 *
 * `clean` — every requested stage reads back as requested.
 * `partial` — at least one stage disagrees; the browser kept processing we asked it to drop.
 * `unknown` — the browser reports nothing back, so no claim can be made either way.
 */
export function verifyCleanInput(
  track: Pick<MediaStreamTrack, "getSettings">,
  options: CleanInputOptions,
  env: CleanInputEnv = defaultCleanInputEnv(),
  exactHonoured = false,
): CleanInputReport {
  const settings = track.getSettings() as Record<string, unknown>;
  // Read what was actually requested off the built constraints rather than recomputing it here.
  // `buildInputConstraints` is the one place that decides a stage's value (e.g. autoGainControl
  // is overridden by the user's autoGain preference, not a flat !cleanMode) — recomputing that
  // logic a second time here would silently drift from it. A key the builder didn't set means
  // the browser doesn't expose that stage, which is exactly the `unsupported` case, so the two
  // notions of "unsupported" collapse into one source of truth.
  const built = buildInputConstraints(options, env) as Record<string, unknown>;

  const requested: Partial<Record<ProcessingConstraint, boolean>> = {};
  const actual: Partial<Record<ProcessingConstraint, boolean | undefined>> = {};
  const unsupported: ProcessingConstraint[] = [];

  for (const name of PROCESSING_CONSTRAINTS) {
    const builtValue = built[name];
    if (typeof builtValue !== "boolean") {
      unsupported.push(name);
      continue;
    }
    requested[name] = builtValue;
    const reported = settings[name];
    actual[name] = typeof reported === "boolean" ? reported : undefined;
  }

  const checked = Object.keys(requested) as ProcessingConstraint[];
  const isAnyReported = checked.some((name) => actual[name] !== undefined);
  const isAllMatching = checked.every(
    (name) => actual[name] === undefined || actual[name] === requested[name],
  );

  let verdict: CleanInputVerdict;
  if (!isAnyReported) {
    verdict = "unknown";
  } else if (isAllMatching) {
    verdict = "clean";
  } else {
    verdict = "partial";
  }

  return { requested, actual, unsupported, verdict, exactHonoured };
}

function toExact(constraints: MediaTrackConstraints): MediaTrackConstraints {
  const exact: MediaTrackConstraints & Record<string, unknown> = { ...constraints };
  for (const name of PROCESSING_CONSTRAINTS) {
    const value = (constraints as Record<string, unknown>)[name];
    if (typeof value === "boolean") {
      exact[name] = { exact: value };
    }
  }
  return exact;
}

function isOverconstrained(error: unknown): boolean {
  return error instanceof Error && error.name === "OverconstrainedError";
}

/**
 * Open a microphone and report whether the browser honoured the request.
 *
 * Asks with `exact` first: an accepted exact request means the platform genuinely committed,
 * rather than quietly ignoring a key it does not implement. `OverconstrainedError` means it
 * cannot comply, so we retry with plain booleans and keep a working stream — a degraded
 * microphone the user is told about beats no microphone at all.
 *
 * Any other rejection (permission denied, device missing) is the caller's to handle and is
 * rethrown untouched: retrying a denial would only prompt the user twice.
 */
export async function acquireCleanInput(
  options: CleanInputOptions,
  env: CleanInputEnv = defaultCleanInputEnv(),
): Promise<{ stream: MediaStream; report: CleanInputReport }> {
  const base = buildInputConstraints(options, env);

  let stream: MediaStream;
  let isExactHonoured = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: toExact(base), video: false });
  } catch (error) {
    if (!isOverconstrained(error)) throw error;
    isExactHonoured = false;
    // `base` still carries the same `deviceId: { exact: ... }` as the first attempt (only the
    // processing-stage booleans lose their `exact` wrapper via toExact()) — if the device itself
    // was the over-constraint, this retry repeats the identical impossible request and fails
    // again rather than degrading gracefully. Harmless (one extra rejected getUserMedia call
    // before the caller's catch runs), not a bug.
    stream = await navigator.mediaDevices.getUserMedia({ audio: base, video: false });
  }

  const track = stream.getAudioTracks()[0];
  if (!track) {
    return {
      stream,
      report: {
        requested: {},
        actual: {},
        unsupported: [],
        verdict: "unknown",
        exactHonoured: isExactHonoured,
      },
    };
  }

  return { stream, report: verifyCleanInput(track, options, env, isExactHonoured) };
}
