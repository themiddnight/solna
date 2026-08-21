import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Clock,
  Plus,
  Trash2,
  Volume2,
  VolumeX,
  Play,
  Square,
  RotateCcw,
  Sliders,
  Music,
  ZoomIn,
  ZoomOut,
  Sparkles,
  Edit3,
  Copy,
  Scissors,
  Repeat,
  Headphones,
  Check,
  Disc,
} from 'lucide-react';
import { ArrangeTrack, ArrangeRegion, RegionNote, SynthParams, InstrumentType } from '../types';
import { audioEngine } from '../audio/engine';
import { PianoRollModal } from './PianoRollModal';
import { TrackSynthInspector } from './TrackSynthInspector';

interface ArrangeViewProps {
  tracks: ArrangeTrack[];
  onChangeTracks: (tracks: ArrangeTrack[]) => void;
  bpm: number;
  isPlaying: boolean;
  onTogglePlay?: () => void;
  scaleRoot?: string;
  scaleType?: string;
}

export const ArrangeView: React.FC<ArrangeViewProps> = ({
  tracks,
  onChangeTracks,
  bpm,
  isPlaying,
  onTogglePlay,
  scaleRoot = 'A',
  scaleType = 'Natural Minor',
}) => {
  const [zoom, setZoom] = useState<number>(1);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);

  // Modals
  const [editingRegion, setEditingRegion] = useState<{ track: ArrangeTrack; region: ArrangeRegion } | null>(null);
  const [inspectingTrack, setInspectingTrack] = useState<ArrangeTrack | null>(null);

  // Playhead & Transport
  const [currentBeat, setCurrentBeat] = useState<number>(0);
  const [isLooping, setIsLooping] = useState<boolean>(true);
  const [loopEndBars, setLoopEndBars] = useState<number>(8);

  const maxRegionEndBeat = Math.max(
    16 * 4,
    ...tracks.flatMap((t) => (t.regions.length > 0 ? t.regions.map((r) => r.startBeat + r.durationBeats) : [16 * 4]))
  );
  const numBars = Math.max(16, Math.ceil(maxRegionEndBeat / 4));
  const barWidth = 90 * zoom; // px per bar
  const beatWidth = barWidth / 4; // px per quarter note
  const stepWidth = barWidth / 16; // px per 16th note
  const totalTimelineWidth = numBars * barWidth;

  // Real-time Multi-Track DAW Playhead & Audio Engine Scheduler — driven by the shared audio-clock
  const armedRef = useRef(false);
  const stepDurationMs = (60 / bpm / 4) * 1000; // 16th note duration in ms

  const playArrangeStepSounds = useCallback(
    (stepIndex: number, time: number) => {
      const hasSolo = tracks.some((t) => t.solo);

      tracks.forEach((track) => {
        // Check Mute / Solo logic
        if (track.muted) return;
        if (hasSolo && !track.solo) return;

        const trackSynth: SynthParams = {
          oscType: 'sawtooth',
          subOscVolume: 0.3,
          noiseVolume: 0.01,
          detune: 6,
          filterType: 'lowpass',
          filterCutoff: 3000,
          filterResonance: 3.0,
          filterEnvAmount: 1200,
          attack: 0.02,
          decay: 0.4,
          sustain: 0.6,
          release: 0.5,
          filterAttack: 0.02,
          filterDecay: 0.4,
          filterSustain: 0,
          filterRelease: 0.5,
          lfoRate: 3.5,
          lfoDepth: 0.2,
          lfoTarget: 'cutoff',
          octave: 0,
          preset: track.name,
          ...(track.synthParams ?? {}),
        };

        // Find active regions containing this step
        track.regions.forEach((region) => {
          const regionStartStep = region.startBeat * 4;
          const regionDurationSteps = region.durationBeats * 4;
          const regionEndStep = regionStartStep + regionDurationSteps;

          if (stepIndex >= regionStartStep && stepIndex < regionEndStep) {
            const relativeStep = stepIndex - regionStartStep;

            if (region.notes && region.notes.length > 0) {
              const notesToPlay = region.notes.filter((n) => n.startStep === relativeStep);
              notesToPlay.forEach((n) => {
                const durationSec = (n.durationSteps * stepDurationMs) / 1000;
                if (track.type === 'drums') {
                  // Map drum note or trigger drum
                  const drumType = getDrumTypeFromNote(n.note);
                  audioEngine.triggerDrum(drumType, (n.velocity || 0.8) * track.volume, time);
                } else {
                  audioEngine.triggerTrackNote(
                    track.id,
                    n.note,
                    trackSynth,
                    n.velocity || 0.8,
                    track.volume,
                    durationSec,
                    track.pan || 0,
                    time
                  );
                }
              });
            }
          }
        });
      });
    },
    [tracks, stepDurationMs]
  );

  useEffect(() => {
    if (!isPlaying) {
      armedRef.current = false;
      return;
    }

    return audioEngine.subscribeClock((step, _beat, time) => {
      // Start aligned to the next quarter-note boundary of the shared grid
      if (!armedRef.current) {
        if (step % 4 !== 0) return;
        armedRef.current = true;
      }
      const maxSteps = isLooping ? loopEndBars * 16 : numBars * 16;
      const stepInTimeline = step % maxSteps;
      setCurrentBeat(stepInTimeline / 4);
      playArrangeStepSounds(stepInTimeline, time);
    });
  }, [isPlaying, isLooping, loopEndBars, numBars, playArrangeStepSounds]);

  // Helper for drum mapping
  const getDrumTypeFromNote = (noteName: string): string => {
    const n = noteName.toLowerCase();
    if (n.includes('c1') || n.includes('c2') || n.includes('kick')) return 'kick';
    if (n.includes('d1') || n.includes('d2') || n.includes('snare')) return 'snare';
    if (n.includes('f#') || n.includes('hihat') || n.includes('hat')) return 'hihat';
    if (n.includes('a#') || n.includes('open')) return 'openhat';
    if (n.includes('d#') || n.includes('clap')) return 'clap';
    if (n.includes('g1') || n.includes('tom')) return 'tom';
    return 'kick';
  };

  const toggleMute = (trackId: string) => {
    onChangeTracks(
      tracks.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t))
    );
  };

  const toggleSolo = (trackId: string) => {
    onChangeTracks(
      tracks.map((t) => (t.id === trackId ? { ...t, solo: !t.solo } : t))
    );
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickedBeat = Math.max(0, Math.min(numBars * 4, (clickX / barWidth) * 4));
    setCurrentBeat(Math.floor(clickedBeat));
  };

  const addTrack = () => {
    const types: InstrumentType[] = ['lead', 'bass', 'pad', 'piano', 'pluck', 'drums'];
    const type = types[tracks.length % types.length];
    const colors = [
      'bg-indigo-600',
      'bg-pink-600',
      'bg-emerald-600',
      'bg-amber-600',
      'bg-cyan-600',
      'bg-purple-600',
    ];

    const newTrack: ArrangeTrack = {
      id: `track-${Date.now()}`,
      name: `${type.toUpperCase()} Instrument ${tracks.length + 1}`,
      color: colors[tracks.length % colors.length],
      type,
      volume: 0.85,
      pan: 0,
      muted: false,
      solo: false,
      synthParams: {
        oscType: 'sawtooth',
        subOscVolume: 0.3,
        noiseVolume: 0.01,
        detune: 6,
        filterType: 'lowpass',
        filterCutoff: 3000,
        filterResonance: 3.0,
        filterEnvAmount: 1200,
        attack: 0.02,
        decay: 0.4,
        sustain: 0.6,
        release: 0.5,
        filterAttack: 0.02,
        filterDecay: 0.4,
        filterSustain: 0,
        filterRelease: 0.5,
        lfoRate: 3.5,
        lfoDepth: 0.2,
        lfoTarget: 'cutoff',
        octave: type === 'bass' ? -1 : 0,
        preset: `${type.toUpperCase()} Voice`,
      },
      regions: [
        {
          id: `region-${Date.now()}-1`,
          name: `${type.toUpperCase()} Pattern 1`,
          startBeat: 0,
          durationBeats: 16,
          notes: [
            { id: 'n1', note: type === 'bass' ? 'A2' : 'A4', startStep: 0, durationSteps: 4, velocity: 0.9 },
            { id: 'n2', note: type === 'bass' ? 'C3' : 'C5', startStep: 4, durationSteps: 4, velocity: 0.85 },
            { id: 'n3', note: type === 'bass' ? 'E2' : 'E5', startStep: 8, durationSteps: 4, velocity: 0.9 },
            { id: 'n4', note: type === 'bass' ? 'G2' : 'G4', startStep: 12, durationSteps: 4, velocity: 0.8 },
          ],
        },
      ],
    };

    onChangeTracks([...tracks, newTrack]);
  };

  const deleteTrack = (id: string) => {
    onChangeTracks(tracks.filter((t) => t.id !== id));
  };

  const addRegionToTrack = (trackId: string) => {
    const track = tracks.find((t) => t.id === trackId);
    if (!track) return;

    // Find next available beat
    let nextStartBeat = 0;
    if (track.regions.length > 0) {
      const lastRegion = track.regions[track.regions.length - 1];
      nextStartBeat = lastRegion.startBeat + lastRegion.durationBeats;
    }

    const newRegion: ArrangeRegion = {
      id: `region-${Date.now()}`,
      name: `${track.name} Clip ${track.regions.length + 1}`,
      startBeat: nextStartBeat,
      durationBeats: 16,
      notes: [
        { id: `note-${Date.now()}-1`, note: track.type === 'bass' ? 'A2' : 'A4', startStep: 0, durationSteps: 4, velocity: 0.9 },
        { id: `note-${Date.now()}-2`, note: track.type === 'bass' ? 'C3' : 'E4', startStep: 8, durationSteps: 4, velocity: 0.85 },
      ],
    };

    const updatedTracks = tracks.map((t) =>
      t.id === trackId ? { ...t, regions: [...t.regions, newRegion] } : t
    );
    onChangeTracks(updatedTracks);
  };

  const duplicateRegion = (trackId: string, region: ArrangeRegion) => {
    const newRegion: ArrangeRegion = {
      ...region,
      id: `region-${Date.now()}`,
      name: `${region.name} (Copy)`,
      startBeat: region.startBeat + region.durationBeats,
      notes: region.notes ? region.notes.map((n) => ({ ...n, id: `n-${Date.now()}-${Math.random()}` })) : [],
    };

    const updatedTracks = tracks.map((t) =>
      t.id === trackId ? { ...t, regions: [...t.regions, newRegion] } : t
    );
    onChangeTracks(updatedTracks);
  };

  const deleteRegion = (trackId: string, regionId: string) => {
    const updatedTracks = tracks.map((t) =>
      t.id === trackId ? { ...t, regions: t.regions.filter((r) => r.id !== regionId) } : t
    );
    onChangeTracks(updatedTracks);
  };

  const handleSaveRegion = (updatedRegion: ArrangeRegion) => {
    if (!editingRegion) return;
    const trackId = editingRegion.track.id;
    const updatedTracks = tracks.map((t) =>
      t.id === trackId
        ? {
            ...t,
            regions: t.regions.map((r) => (r.id === updatedRegion.id ? updatedRegion : r)),
          }
        : t
    );
    onChangeTracks(updatedTracks);
  };

  const handleSaveTrack = (updatedTrack: ArrangeTrack) => {
    const updatedTracks = tracks.map((t) => (t.id === updatedTrack.id ? updatedTrack : t));
    onChangeTracks(updatedTracks);
  };

  const playheadPositionPx = (currentBeat / 4) * barWidth;

  return (
    <div className="p-3 sm:p-4 max-w-7xl mx-auto space-y-4">
      {/* Top DAW Toolbar */}
      <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-600/20 border border-cyan-500/30 text-cyan-400">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-base text-slate-100 flex items-center gap-2">
              Multi-Track Timeline DAW & Arranger
              <span className="text-[11px] font-mono font-normal text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                Interactive Piano Roll & Synth DAW
              </span>
            </h2>
          </div>
        </div>

        {/* Transport & Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Play/Pause Button */}
          <button
            id="btn-daw-play"
            onClick={() => {
              audioEngine.init();
              if (onTogglePlay) onTogglePlay();
            }}
            className={`px-3 py-1.5 rounded-lg font-semibold text-xs flex items-center gap-1.5 cursor-pointer shadow-md transition-colors ${
              isPlaying
                ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 animate-pulse'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
            }`}
          >
            {isPlaying ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            <span>{isPlaying ? 'Pause DAW' : 'Play Timeline'}</span>
          </button>

          {/* Reset Playhead */}
          <button
            onClick={() => setCurrentBeat(0)}
            className="p-1.5 rounded-lg bg-[#0B0D19] border border-[#252B48] text-slate-400 hover:text-white transition-colors cursor-pointer"
            title="Return to Zero (Bar 1.1)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* Loop Mode Selector */}
          <div className="flex items-center gap-1.5 bg-[#0B0D19] border border-[#252B48] px-2 py-1 rounded-lg text-xs">
            <Repeat className={`w-3.5 h-3.5 ${isLooping ? 'text-indigo-400' : 'text-slate-500'}`} />
            <button
              onClick={() => setIsLooping(!isLooping)}
              className={`text-[10px] font-bold cursor-pointer transition-colors ${
                isLooping ? 'text-indigo-400' : 'text-slate-500'
              }`}
            >
              {isLooping ? 'Loop: 8 Bars' : 'No Loop'}
            </button>
          </div>

          {/* Zoom controls */}
          <div className="flex items-center gap-1 bg-[#0B0D19] border border-[#252B48] p-1 rounded-lg">
            <button
              id="btn-zoom-out"
              onClick={() => setZoom((z) => Math.max(0.7, z - 0.2))}
              className="p-1 rounded text-slate-400 hover:text-white cursor-pointer"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] font-mono px-1 text-slate-400">{(zoom * 100).toFixed(0)}%</span>
            <button
              id="btn-zoom-in"
              onClick={() => setZoom((z) => Math.min(1.8, z + 0.2))}
              className="p-1 rounded text-slate-400 hover:text-white cursor-pointer"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Add Track */}
          <button
            id="btn-add-daw-track"
            onClick={addTrack}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-colors cursor-pointer shadow-md"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Track</span>
          </button>
        </div>
      </div>

      {/* Main Timeline Workspace */}
      <div className="bg-[#12152A] border border-[#252B48] rounded-xl shadow-xl overflow-x-auto select-none">
        <div className="w-max min-w-full">
          {/* Measures / Beats Ruler */}
          <div className="flex border-b border-[#252B48] bg-[#0B0D19] sticky top-0 z-40 w-max min-w-full">
            <div className="w-64 p-2 text-xs font-mono font-bold text-slate-400 border-r border-[#252B48] flex items-center justify-between shrink-0 sticky left-0 z-50 bg-[#0B0D19] shadow-md">
              <span>TRACK INSTRUMENT</span>
              <span className="text-[10px] text-slate-500 font-normal">VOL / PAN</span>
            </div>

            {/* Clickable Seek Ruler */}
            <div
              onClick={handleSeek}
              className="relative h-8 flex items-center cursor-pointer hover:bg-indigo-950/20 transition-colors shrink-0 z-10"
              style={{ width: `${totalTimelineWidth}px`, minWidth: `${totalTimelineWidth}px` }}
            >
              {Array.from({ length: numBars }).map((_, barIdx) => (
                <div
                  key={barIdx}
                  className="border-r border-[#252B48]/80 text-[10px] font-mono text-slate-400 px-1.5 flex items-center justify-between shrink-0"
                  style={{ width: `${barWidth}px` }}
                >
                  <span className="font-bold text-indigo-300">{barIdx + 1}</span>
                  <span className="text-slate-600 text-[8px]">.1</span>
                </div>
              ))}

              {/* Ruler Playhead Marker Indicator */}
              <div
                className="absolute top-0 bottom-0 w-3 -ml-1.5 flex flex-col items-center pointer-events-none z-30"
                style={{ left: `${playheadPositionPx}px` }}
              >
                <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[7px] border-t-amber-400" />
              </div>
            </div>
          </div>

          {/* Track Lanes Container with Full-height Playhead */}
          <div className="divide-y divide-[#252B48]/60 relative w-max min-w-full">
            {/* Continuous Vertical Playhead Line across all tracks */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.9)] pointer-events-none z-15"
              style={{ left: `${256 + playheadPositionPx}px` }} // 256px = w-64 track header width
            />

            {tracks.map((track) => (
              <div
                key={track.id}
                id={`arrange-lane-${track.id}`}
                className={`flex items-stretch hover:bg-[#161B36]/50 transition-colors w-max min-w-full ${
                  selectedTrackId === track.id ? 'bg-[#181D3C]' : ''
                }`}
              >
                {/* Left Track Header & Channel Strip */}
                <div className="w-64 p-2.5 bg-[#0E1122] border-r border-[#252B48] flex flex-col justify-between space-y-2 shrink-0 sticky left-0 z-30 shadow-[4px_0_12px_rgba(0,0,0,0.5)]">
                  {/* Track Name & Instrument Sound Inspector Button */}
                  <div className="flex items-center justify-between gap-1.5">
                    <button
                      onClick={() => setInspectingTrack(track)}
                      className="flex items-center gap-2 truncate text-left group cursor-pointer"
                      title="Click to open Track Synth & Instrument Setup"
                    >
                      <div className={`w-3 h-3 rounded-full ${track.color} shrink-0 group-hover:scale-110 transition-transform`} />
                      <div className="truncate">
                        <div className="text-xs font-bold text-slate-200 truncate group-hover:text-indigo-300 transition-colors">
                          {track.name}
                        </div>
                        <div className="text-[9px] font-mono text-slate-400 capitalize">
                          {track.type} • {track.synthParams?.preset || 'Custom'}
                        </div>
                      </div>
                    </button>

                    <div className="flex items-center gap-1">
                      {/* Synth Setup Button */}
                      <button
                        onClick={() => setInspectingTrack(track)}
                        className="p-1 rounded bg-[#171C3A] hover:bg-indigo-600 text-slate-300 hover:text-white transition-colors cursor-pointer border border-[#2B335C]"
                        title="Open Track Synth Setup"
                      >
                        <Sliders className="w-3 h-3" />
                      </button>

                      {/* Delete Track */}
                      <button
                        id={`btn-delete-track-${track.id}`}
                        onClick={() => deleteTrack(track.id)}
                        className="p-1 rounded hover:bg-rose-950/60 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                        title="Delete Track"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Track Mute, Solo, Volume & Pan */}
                  <div className="flex items-center justify-between gap-1 pt-1">
                    <div className="flex items-center gap-1">
                      <button
                        id={`btn-mute-arrange-${track.id}`}
                        onClick={() => toggleMute(track.id)}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold cursor-pointer transition-colors ${
                          track.muted
                            ? 'bg-rose-500 text-white'
                            : 'bg-[#1C213E] text-slate-400 hover:text-white'
                        }`}
                        title="Mute Track"
                      >
                        M
                      </button>
                      <button
                        id={`btn-solo-arrange-${track.id}`}
                        onClick={() => toggleSolo(track.id)}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold cursor-pointer transition-colors ${
                          track.solo
                            ? 'bg-amber-500 text-slate-950'
                            : 'bg-[#1C213E] text-slate-400 hover:text-white'
                        }`}
                        title="Solo Track"
                      >
                        S
                      </button>
                    </div>

                    {/* Volume Slider */}
                    <div className="flex items-center gap-1">
                      <Volume2 className="w-3 h-3 text-slate-500" />
                      <input
                        id={`slider-vol-arrange-${track.id}`}
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={track.volume}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          onChangeTracks(tracks.map((t) => (t.id === track.id ? { ...t, volume: val } : t)));
                        }}
                        className="w-14 h-1 bg-[#252B48] rounded cursor-pointer accent-indigo-500"
                        title={`Volume: ${Math.round(track.volume * 100)}%`}
                      />
                    </div>

                    {/* Add Clip Button */}
                    <button
                      onClick={() => addRegionToTrack(track.id)}
                      className="p-1 rounded bg-[#1A1F3B] hover:bg-indigo-600 text-slate-400 hover:text-white transition-colors cursor-pointer"
                      title="Add new Region Clip to track"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Right Timeline Region Blocks Lane */}
                <div
                  onClick={handleSeek}
                  className="relative h-20 bg-[#0B0D19]/40 overflow-hidden flex items-center p-2 cursor-pointer shrink-0"
                  style={{ width: `${totalTimelineWidth}px`, minWidth: `${totalTimelineWidth}px` }}
                >
                  {/* Background Grid Lines per Bar */}
                  {Array.from({ length: numBars }).map((_, barIdx) => (
                    <div
                      key={barIdx}
                      className="absolute top-0 bottom-0 border-r border-[#1E2342]/40 pointer-events-none"
                      style={{ left: `${barIdx * barWidth}px` }}
                    />
                  ))}

                {/* Region Clips */}
                {track.regions.map((region) => {
                  const left = (region.startBeat / 4) * barWidth;
                  const width = (region.durationBeats / 4) * barWidth;
                  const noteCount = region.notes?.length || 0;

                  return (
                    <div
                      key={region.id}
                      id={`region-block-${region.id}`}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingRegion({ track, region });
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedRegionId(region.id);
                        setSelectedTrackId(track.id);
                      }}
                      className={`absolute h-15 rounded-lg ${track.color} bg-opacity-90 border text-white shadow-md flex flex-col justify-between p-2 cursor-pointer hover:brightness-110 transition-all select-none group z-10 ${
                        selectedRegionId === region.id ? 'border-white ring-2 ring-indigo-400' : 'border-white/20'
                      }`}
                      style={{
                        left: `${left}px`,
                        width: `${Math.max(40, width - 4)}px`,
                      }}
                      title={`${region.name} • Double-click to open Piano Roll MIDI Editor`}
                    >
                      {/* Region Header */}
                      <div className="flex items-center justify-between text-[11px] font-bold truncate gap-1">
                        <span className="truncate flex items-center gap-1">
                          <Music className="w-3 h-3 shrink-0 opacity-80" />
                          <span className="truncate">{region.name}</span>
                        </span>
                        <span className="text-[9px] opacity-75 font-mono shrink-0">
                          {Math.round(region.durationBeats / 4)}b ({noteCount} nts)
                        </span>
                      </div>

                      {/* Mini Note Preview Bars */}
                      <div className="flex items-center gap-0.5 h-3 opacity-60 overflow-hidden bg-black/20 rounded px-1">
                        {region.notes && region.notes.length > 0 ? (
                          region.notes.slice(0, 16).map((n, i) => (
                            <div
                              key={i}
                              className="h-2 bg-white/70 rounded-xs shrink-0"
                              style={{ width: `${Math.max(3, n.durationSteps * 2)}px` }}
                            />
                          ))
                        ) : (
                          <span className="text-[8px] opacity-60">Empty (Double-click)</span>
                        )}
                      </div>

                      {/* Hover Action Overlay Toolbar */}
                      <div className="absolute inset-0 bg-black/60 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 p-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingRegion({ track, region });
                          }}
                          className="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer shadow"
                          title="Open Piano Roll"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Piano Roll</span>
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            duplicateRegion(track.id, region);
                          }}
                          className="p-1 rounded bg-[#252B48] hover:bg-[#343D68] text-white cursor-pointer"
                          title="Duplicate Region"
                        >
                          <Copy className="w-3 h-3" />
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteRegion(track.id, region.id);
                          }}
                          className="p-1 rounded bg-rose-900/80 hover:bg-rose-700 text-white cursor-pointer"
                          title="Delete Region"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>

      {/* Piano Roll MIDI Note Editor Modal */}
      {editingRegion && (
        <PianoRollModal
          region={editingRegion.region}
          track={editingRegion.track}
          bpm={bpm}
          scaleRoot={scaleRoot}
          scaleType={scaleType}
          onSaveRegion={handleSaveRegion}
          onClose={() => setEditingRegion(null)}
        />
      )}

      {/* Track Synth & Instrument Inspector Modal */}
      {inspectingTrack && (
        <TrackSynthInspector
          track={inspectingTrack}
          onSaveTrack={handleSaveTrack}
          onClose={() => setInspectingTrack(null)}
        />
      )}
    </div>
  );
};
