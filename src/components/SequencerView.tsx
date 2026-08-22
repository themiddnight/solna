import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Grid,
  Play,
  Square,
  RotateCcw,
  Shuffle,
  ArrowLeft,
  ArrowRight,
  Volume2,
  VolumeX,
  Sparkles,
  Disc3,
} from "lucide-react";
import { SequencerTrack, SynthParams } from "../types";
import { audioEngine, STEPS_PER_BAR } from "../audio/engine";
import { sixteenthNoteMs } from "../utils/musicTheory";
import { DRUM_KITS, GENRE_TO_KIT } from "../audio/drumKits";
import { DrumPads } from "./DrumPads";

interface SequencerViewProps {
  tracks: SequencerTrack[];
  onChangeTracks: (tracks: SequencerTrack[]) => void;
  bpm: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  synthParams: SynthParams;
  soundKit: string;
  onChangeSoundKit: (kit: string) => void;
}

const GENRE_PRESETS: Record<string, Record<string, boolean[]>> = {
  Synthwave: {
    kick: [
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    snare: [
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    hihat: [
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
    ],
    openhat: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ],
    clap: [
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    tom: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      true,
    ],
    bass: [
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
    ],
  },
  House: {
    kick: [
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    snare: [
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    hihat: [
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
    ],
    openhat: [
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
    ],
    clap: [
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    tom: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ],
    bass: [
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
    ],
  },
  Trap: {
    kick: [
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ],
    snare: [
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    hihat: [
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ],
    openhat: [
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ],
    clap: [
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    tom: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
    ],
    bass: [
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ],
  },
  "Boom Bap": {
    kick: [
      true,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ],
    snare: [
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    hihat: [
      true,
      false,
      true,
      true,
      true,
      false,
      true,
      true,
      true,
      false,
      true,
      true,
      true,
      false,
      true,
      true,
    ],
    openhat: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ],
    clap: [
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    tom: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ],
    bass: [
      true,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ],
  },
  Cyberpunk: {
    kick: [
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    snare: [
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      true,
      false,
    ],
    hihat: [
      true,
      true,
      false,
      true,
      true,
      false,
      true,
      true,
      false,
      true,
      true,
      false,
      true,
      true,
      false,
      true,
    ],
    openhat: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ],
    clap: [
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    tom: [
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
    ],
    bass: [
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
  },
  DnB: {
    kick: [
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ],
    snare: [
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    hihat: [
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
    ],
    openhat: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
    ],
    clap: [
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    tom: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ],
    bass: [
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ],
  },
  Dubstep: {
    kick: [
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    snare: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ],
    hihat: [
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
    ],
    openhat: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
    ],
    clap: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ],
    tom: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ],
    bass: [
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
  },
  Techno: {
    kick: [
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    snare: [
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    hihat: [
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
    ],
    openhat: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
    ],
    clap: [
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    tom: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ],
    bass: [
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
    ],
  },
  Funk: {
    kick: [
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ],
    snare: [
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    hihat: [
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
    ],
    openhat: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
    ],
    clap: [
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    tom: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ],
    bass: [
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
  },
  Rock: {
    kick: [
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ],
    snare: [
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    hihat: [
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
    ],
    openhat: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
    ],
    clap: [
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    tom: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ],
    bass: [
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
  },
  Reggae: {
    kick: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ],
    snare: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ],
    hihat: [
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
    ],
    openhat: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ],
    clap: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ],
    tom: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ],
    bass: [
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
    ],
  },
  "Lo-Fi Hip-Hop": {
    kick: [
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ],
    snare: [
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    hihat: [
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      true,
    ],
    openhat: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
    ],
    clap: [
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    tom: [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ],
    bass: [
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ],
  },
};

export const SequencerView: React.FC<SequencerViewProps> = React.memo(({
  tracks,
  onChangeTracks,
  bpm,
  isPlaying,
  onTogglePlay,
  synthParams,
  soundKit,
  onChangeSoundKit,
}) => {
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [selectedGenre, setSelectedGenre] = useState<string>("Synthwave");
  const [masterSequencerVolume, setMasterSequencerVolume] = useState<number>(0.8);

  useEffect(() => {
    onChangeSoundKit(GENRE_TO_KIT[selectedGenre] ?? selectedGenre);
  }, [selectedGenre, onChangeSoundKit]);
  // Real-time playback stepper — driven by the shared audio-clock scheduler
  const armedRef = useRef(false);
  const stepDurationMs = sixteenthNoteMs(bpm);

  const playStepSounds = useCallback(
    (stepIndex: number, time: number) => {
      tracks.forEach((track) => {
        if (track.muted) return;
        if (track.steps[stepIndex]) {
          if (track.instrument === "synth" || track.instrument === "bass") {
            const note = track.instrument === "bass" ? "C2" : "C4";
            audioEngine.triggerSynthNoteOn(
              note,
              synthParams,
              masterSequencerVolume,
              time,
            );
            audioEngine.triggerSynthNoteOff(
              note,
              synthParams.release,
              time + (stepDurationMs / 1000) * 0.8,
            );
          } else {
            audioEngine.triggerDrum(
              track.instrument,
              masterSequencerVolume,
              time,
            );
          }
        }
      });
    },
    [tracks, synthParams, masterSequencerVolume, stepDurationMs],
  );

  useEffect(() => {
    if (!isPlaying) {
      armedRef.current = false;
      setCurrentStep(0);
      return;
    }

    return audioEngine.subscribeClock((step, _beat, time) => {
      // Start aligned to the next bar boundary so the 16-step loop lands on beat 1
      if (!armedRef.current) {
        if (step % STEPS_PER_BAR !== 0) return;
        armedRef.current = true;
      }
      const stepInLoop = step % STEPS_PER_BAR;
      setCurrentStep(stepInLoop);
      playStepSounds(stepInLoop, time);
    });
  }, [isPlaying, playStepSounds]);

  const toggleStep = (trackId: string, stepIndex: number) => {
    onChangeTracks(
      tracks.map((t) => {
        if (t.id !== trackId) return t;
        const newSteps = [...t.steps];
        newSteps[stepIndex] = !newSteps[stepIndex];
        return { ...t, steps: newSteps };
      }),
    );
  };

  const toggleMute = (trackId: string) => {
    onChangeTracks(
      tracks.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t)),
    );
  };

  const clearAllSteps = () => {
    onChangeTracks(
      tracks.map((t) => ({
        ...t,
        steps: new Array(16).fill(false),
      })),
    );
  };

  const randomizeSteps = () => {
    onChangeTracks(
      tracks.map((t) => ({
        ...t,
        steps: Array.from({ length: 16 }, () => Math.random() > 0.75),
      })),
    );
  };

  const shiftSteps = (direction: "left" | "right") => {
    onChangeTracks(
      tracks.map((t) => {
        const newSteps = [...t.steps];
        if (direction === "right") {
          const last = newSteps.pop()!;
          newSteps.unshift(last);
        } else {
          const first = newSteps.shift()!;
          newSteps.push(first);
        }
        return { ...t, steps: newSteps };
      }),
    );
  };

  const applyGenrePreset = (genre: string) => {
    setSelectedGenre(genre);
    const preset = GENRE_PRESETS[genre];
    if (!preset) return;

    onChangeTracks(
      tracks.map((t) => {
        const pattern = preset[t.instrument];
        if (pattern) {
          return { ...t, steps: [...pattern] };
        }
        return t;
      }),
    );
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      {/* Top Header & Preset Bar */}
      <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-400">
            <Grid className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-base text-slate-100 flex items-center gap-2">
              16-Step Beat Matrix Sequencer
            </h2>
          </div>
        </div>

        {/* Preset & Action Buttons */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Master Volume */}
          <div className="flex items-center gap-2 mr-4">
            <Volume2 className="w-4 h-4 text-emerald-400" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={masterSequencerVolume}
              onChange={(e) =>
                setMasterSequencerVolume(parseFloat(e.target.value))
              }
              className="w-24 h-1.5 bg-[#0B0D19] rounded-lg cursor-pointer accent-emerald-500"
            />
          </div>

          {/* Genre selector */}
          <div className="flex items-center gap-1.5 bg-[#0B0D19] border border-[#2D355A] px-2.5 py-1 rounded-lg">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-[10px] text-slate-400 font-mono">
              Pattern:
            </span>
            <select
              id="select-sequencer-genre"
              value={selectedGenre}
              onChange={(e) => applyGenrePreset(e.target.value)}
              className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer"
            >
              {Object.keys(GENRE_PRESETS).map((g) => (
                <option key={g} value={g} className="bg-[#12152A]">
                  {g} Groove
                </option>
              ))}
            </select>
          </div>

          {/* Sound kit selector */}
          <div className="flex items-center gap-1.5 bg-[#0B0D19] border border-[#2D355A] px-2.5 py-1 rounded-lg">
            <Disc3 className="w-3.5 h-3.5 text-pink-400" />
            <span className="text-[10px] text-slate-400 font-mono">Sound:</span>
            <select
              id="select-sequencer-sound-kit"
              value={soundKit}
              onChange={(e) => onChangeSoundKit(e.target.value)}
              className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer"
            >
              {Object.keys(DRUM_KITS).map((k) => (
                <option key={k} value={k} className="bg-[#12152A]">
                  {k}
                </option>
              ))}
            </select>
          </div>

          <button
            id="btn-shift-left"
            onClick={() => shiftSteps("left")}
            className="p-1.5 rounded-lg bg-[#1C213E] border border-[#2D355A] text-slate-300 hover:text-white transition-colors cursor-pointer"
            title="Shift Pattern Left"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <button
            id="btn-shift-right"
            onClick={() => shiftSteps("right")}
            className="p-1.5 rounded-lg bg-[#1C213E] border border-[#2D355A] text-slate-300 hover:text-white transition-colors cursor-pointer"
            title="Shift Pattern Right"
          >
            <ArrowRight className="w-4 h-4" />
          </button>

          <button
            id="btn-randomize-grid"
            onClick={randomizeSteps}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#1C213E] border border-[#2D355A] text-slate-300 hover:text-white transition-colors text-xs font-medium cursor-pointer"
          >
            <Shuffle className="w-3.5 h-3.5" />
            <span>Randomize</span>
          </button>

          <button
            id="btn-clear-grid"
            onClick={clearAllSteps}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#1C213E] border border-[#2D355A] text-slate-300 hover:text-white transition-colors text-xs font-medium cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Sequencer Grid */}
      <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-4 overflow-x-auto shadow-xl">
        {/* Step Indicator Header (1-16) */}
        <div className="flex items-center gap-2 mb-2 pl-44 min-w-[700px]">
          {Array.from({ length: 16 }).map((_, i) => {
            const isDownbeat = i % 4 === 0;
            const isCurrent = currentStep === i && isPlaying;
            return (
              <div
                key={i}
                className={`flex-1 text-center font-mono text-[10px] py-1 rounded transition-all ${
                  isCurrent
                    ? "bg-emerald-500 text-slate-950 font-bold shadow-md shadow-emerald-500/50"
                    : isDownbeat
                      ? "text-indigo-400 font-bold bg-[#1C213E]/40"
                      : "text-slate-500"
                }`}
              >
                {i + 1}
              </div>
            );
          })}
        </div>

        {/* Track Lanes */}
        <div className="space-y-2 min-w-[700px]">
          {tracks.map((track) => (
            <div
              key={track.id}
              id={`sequencer-row-${track.id}`}
              className="flex items-center gap-2 bg-[#0B0D19] p-2 rounded-lg border border-[#252B48] hover:border-[#3B4371] transition-colors"
            >
              {/* Track Info & Mute */}
              <div className="w-40 flex items-center justify-between pr-2 border-r border-[#252B48]">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${track.color}`} />
                  <span className="text-xs font-bold text-slate-200 truncate">
                    {track.name}
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      audioEngine.init();
                      if (
                        track.instrument === "synth" ||
                        track.instrument === "bass"
                      ) {
                        const note = track.instrument === "bass" ? "C2" : "C4";
                        audioEngine.triggerSynthNoteOn(note, synthParams, 0.8);
                        setTimeout(
                          () => audioEngine.triggerSynthNoteOff(note),
                          500,
                        );
                      } else {
                        audioEngine.triggerDrum(track.instrument, 0.8);
                      }
                    }}
                    className="p-1 text-slate-400 hover:text-emerald-400 transition-colors cursor-pointer"
                    title="Preview Instrument"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                  <button
                    id={`btn-mute-${track.id}`}
                    onClick={() => toggleMute(track.id)}
                    className={`p-1 rounded cursor-pointer transition-colors ${
                      track.muted
                        ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                    title={track.muted ? "Unmute" : "Mute"}
                  >
                    {track.muted ? (
                      <VolumeX className="w-3.5 h-3.5" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* 16 Step Buttons */}
              <div className="flex-1 flex items-center gap-1.5">
                {track.steps.map((isActive, stepIdx) => {
                  const isBeatGroup = Math.floor(stepIdx / 4) % 2 === 0;
                  const isCurrent = currentStep === stepIdx && isPlaying;

                  return (
                    <button
                      key={stepIdx}
                      id={`step-${track.id}-${stepIdx}`}
                      onClick={() => toggleStep(track.id, stepIdx)}
                      className={`flex-1 h-9 rounded-md transition-all cursor-pointer relative ${
                        isActive
                          ? `${track.color} shadow-md shadow-indigo-500/20 scale-[0.96]`
                          : isBeatGroup
                            ? "bg-[#181C35] hover:bg-[#252B48] border border-[#2D355A]/50"
                            : "bg-[#12152A] hover:bg-[#1E2342] border border-[#252B48]/40"
                      } ${isCurrent ? "ring-2 ring-emerald-400 brightness-125" : ""}`}
                    >
                      {isActive && (
                        <div className="absolute inset-0 bg-white/20 rounded-md animate-pulse" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Live Performance Drum Pads */}
      <DrumPads soundKit={soundKit} onChangeSoundKit={onChangeSoundKit} />
    </div>
  );
});
