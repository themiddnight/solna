import React, { useEffect, useRef, useState } from "react";
import { audioEngine } from "../../audio/engine";
import { isSegmentActive, VU_SEGMENT_COUNT, vuSegment } from "../../utils/vuMeter";

export interface VuMeterProps {
  /** Whether anything is sounding; the rAF loop runs only while true. */
  isPlaying: boolean;
}

/**
 * Master output level meter. Owns its own rAF loop and its own state so a
 * level change re-renders ten <div>s instead of the whole TransportBar —
 * the meter has VU_SEGMENT_COUNT + 1 observable states, and it now commits
 * only when the quantized segment count actually moves.
 *
 * Reads audioEngine directly (layering rule 3 exemption, alongside
 * AudioVisualizer / TransportBar / AmbientBackdrop): routing a per-frame
 * analyser read through the store would mean a store write every animation
 * frame and a re-render of every subscriber.
 */
export const VuMeter: React.FC<VuMeterProps> = React.memo(({ isPlaying }) => {
  const [segment, setSegment] = useState(0);
  const segmentRef = useRef(0);

  useEffect(() => {
    if (!isPlaying) {
      segmentRef.current = 0;
      setSegment(0);
      return;
    }
    let animId: number;
    const updateMeter = () => {
      const next = vuSegment(audioEngine.getAudioLevel());
      if (next !== segmentRef.current) {
        segmentRef.current = next;
        setSegment(next);
      }
      animId = requestAnimationFrame(updateMeter);
    };
    animId = requestAnimationFrame(updateMeter);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying]);

  return (
    <div className="hidden sm:flex items-center gap-1 bg-base-200 border border-base-300 p-1.5 rounded-box">
      <div className="w-14 h-2 bg-base-300 rounded-xs overflow-hidden flex gap-0.5 p-0.5">
        {Array.from({ length: VU_SEGMENT_COUNT }).map((_, i) => {
          const active = isSegmentActive(segment, i);
          const isRed = i >= 8;
          const isYellow = i >= 6 && i < 8;

          return (
            <div
              key={i}
              className={`flex-1 rounded-xs transition-colors duration-75 ${
                active
                  ? isRed
                    ? "bg-error"
                    : isYellow
                      ? "bg-warning"
                      : "bg-success"
                  : "bg-base-300/50"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
});
