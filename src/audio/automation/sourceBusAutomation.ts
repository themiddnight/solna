export const SOURCE_BUS_TIME_CONSTANT_SEC = 0.01;

export type SourceBusApplyMode = 'settle' | 'transition';

export interface SourceBusAutomationParam {
  value: number;
  cancelScheduledValues(at: number): void;
  cancelAndHoldAtTime(at: number): void;
  setValueAtTime(value: number, at: number): void;
  setTargetAtTime(value: number, at: number, constant: number): void;
}

interface Segment {
  at: number;
  startGain: number;
  targetGain: number;
}

interface Timeline {
  initialGain: number;
  segments: Segment[];
}

// These params are owned exclusively by this helper after their initial .value
// assignment. A weak key lets rebuilding the rack discard its old timelines.
const timelines = new WeakMap<SourceBusAutomationParam, Timeline>();

function gainAt(timeline: Timeline, at: number): number {
  const segment = timeline.segments.findLast((entry) => entry.at <= at);
  if (!segment) return timeline.initialGain;
  return segment.targetGain + (segment.startGain - segment.targetGain)
    * Math.exp(-(at - segment.at) / SOURCE_BUS_TIME_CONSTANT_SEC);
}

export function applySourceBusAutomation(
  param: SourceBusAutomationParam,
  targetGain: number,
  at: number,
  mode: SourceBusApplyMode,
  currentTime = 0,
): void {
  let timeline = timelines.get(param);
  if (!timeline) {
    // Before any automation exists, .value is only the node's initial gain.
    timeline = { initialGain: param.value, segments: [] };
    timelines.set(param, timeline);
  }
  const held = gainAt(timeline, at);
  if (mode === 'settle') {
    param.cancelScheduledValues(at);
    param.setValueAtTime(targetGain, at);
  } else {
    try {
      param.cancelAndHoldAtTime(at);
    } catch {
      // Only setValueAtTime and setTargetAtTime live on this timeline, so
      // cancellation preserves the earlier decay. Anchor its computed value
      // at `at`, never the present-time param.value. Endpoint-based ramps
      // would also need their cancelled segment reconstructed.
      param.cancelScheduledValues(at);
      param.setValueAtTime(held, at);
    }
    param.setTargetAtTime(targetGain, at, SOURCE_BUS_TIME_CONSTANT_SEC);
  }

  timeline.segments = timeline.segments.filter((entry) => entry.at < at);
  timeline.segments.push({ at, startGain: mode === 'settle' ? targetGain : held, targetGain });
  // Keep the currently sounding segment and every future boundary. An edit
  // can replace lookahead automation, but can never affect rendered history.
  const currentSegment = timeline.segments.findLastIndex((entry) => entry.at <= currentTime);
  if (currentSegment > 0) timeline.segments.splice(0, currentSegment);
}
