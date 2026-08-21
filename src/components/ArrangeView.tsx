import React, { useState } from 'react';
import { Clock, Plus, Trash2, Volume2, VolumeX, Eye, EyeOff, ZoomIn, ZoomOut, Sparkles } from 'lucide-react';
import { ArrangeTrack, ArrangeRegion } from '../types';

interface ArrangeViewProps {
  tracks: ArrangeTrack[];
  onChangeTracks: (tracks: ArrangeTrack[]) => void;
  bpm: number;
  isPlaying: boolean;
}

export const ArrangeView: React.FC<ArrangeViewProps> = ({
  tracks,
  onChangeTracks,
  bpm,
  isPlaying,
}) => {
  const [zoom, setZoom] = useState<number>(1);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);

  const numBars = 16;
  const barWidth = 60 * zoom;

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

  const addTrack = () => {
    const types: Array<'synth' | 'drums' | 'bass' | 'chords' | 'audio'> = ['synth', 'bass', 'chords', 'drums', 'audio'];
    const type = types[tracks.length % types.length];
    const colors = ['bg-indigo-600', 'bg-pink-600', 'bg-emerald-600', 'bg-amber-600', 'bg-purple-600'];

    const newTrack: ArrangeTrack = {
      id: `track-${Date.now()}`,
      name: `Track ${tracks.length + 1} (${type.toUpperCase()})`,
      color: colors[tracks.length % colors.length],
      type,
      volume: 0.8,
      pan: 0,
      muted: false,
      solo: false,
      regions: [
        {
          id: `region-${Date.now()}-1`,
          name: `${type.toUpperCase()} Loop A`,
          startBeat: 0,
          durationBeats: 16,
        },
        {
          id: `region-${Date.now()}-2`,
          name: `${type.toUpperCase()} Hook B`,
          startBeat: 16,
          durationBeats: 16,
        },
      ],
    };

    onChangeTracks([...tracks, newTrack]);
  };

  const deleteTrack = (id: string) => {
    onChangeTracks(tracks.filter((t) => t.id !== id));
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      {/* Top DAW Toolbar */}
      <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-600/20 border border-cyan-500/30 text-cyan-400">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-base text-slate-100 flex items-center gap-2">
              Multi-Track Arrange Studio & Timeline
              <span className="text-[11px] font-mono font-normal text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                DAW Sequencer
              </span>
            </h2>
            <p className="text-xs text-slate-400">Song structuring, multi-track audio routing, and region arrangement</p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <div className="flex items-center gap-1 bg-[#0B0D19] border border-[#252B48] p-1 rounded-lg">
            <button
              id="btn-zoom-out"
              onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))}
              className="p-1 rounded text-slate-400 hover:text-white cursor-pointer"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] font-mono px-1.5 text-slate-400">{(zoom * 100).toFixed(0)}%</span>
            <button
              id="btn-zoom-in"
              onClick={() => setZoom((z) => Math.min(2.0, z + 0.2))}
              className="p-1 rounded text-slate-400 hover:text-white cursor-pointer"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

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
      <div className="bg-[#12152A] border border-[#252B48] rounded-xl shadow-xl overflow-x-auto">
        {/* Measures / Beats Ruler */}
        <div className="flex border-b border-[#252B48] bg-[#0B0D19] sticky top-0 z-10 min-w-[800px]">
          <div className="w-56 p-2 text-xs font-mono font-bold text-slate-400 border-r border-[#252B48] flex items-center justify-between">
            <span>TRACK HEADER</span>
            <span className="text-[10px] text-slate-500 font-normal">VOL / PAN</span>
          </div>

          <div className="flex-1 flex relative h-8 items-center">
            {Array.from({ length: numBars }).map((_, barIdx) => (
              <div
                key={barIdx}
                className="border-r border-[#252B48]/80 text-[10px] font-mono text-slate-400 px-1.5 flex items-center justify-between"
                style={{ width: `${barWidth}px` }}
              >
                <span className="font-bold text-indigo-300">{barIdx + 1}</span>
                <span className="text-slate-600 text-[8px]">.1</span>
              </div>
            ))}
          </div>
        </div>

        {/* Track Lanes */}
        <div className="divide-y divide-[#252B48]/60 min-w-[800px]">
          {tracks.map((track) => (
            <div
              key={track.id}
              id={`arrange-lane-${track.id}`}
              className={`flex items-stretch hover:bg-[#161B36]/50 transition-colors ${
                selectedTrackId === track.id ? 'bg-[#181D3C]' : ''
              }`}
            >
              {/* Left Track Control Strip */}
              <div className="w-56 p-3 bg-[#0E1122] border-r border-[#252B48] flex flex-col justify-between space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 truncate">
                    <div className={`w-3 h-3 rounded-full ${track.color}`} />
                    <span className="text-xs font-bold text-slate-200 truncate">{track.name}</span>
                  </div>

                  <button
                    id={`btn-delete-track-${track.id}`}
                    onClick={() => deleteTrack(track.id)}
                    className="text-slate-500 hover:text-rose-400 p-0.5 transition-colors cursor-pointer"
                    title="Delete Track"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1">
                    <button
                      id={`btn-mute-arrange-${track.id}`}
                      onClick={() => toggleMute(track.id)}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold cursor-pointer transition-colors ${
                        track.muted
                          ? 'bg-rose-500 text-white'
                          : 'bg-[#1C213E] text-slate-400 hover:text-white'
                      }`}
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
                    >
                      S
                    </button>
                  </div>

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
                      className="w-16 h-1 bg-[#252B48] rounded cursor-pointer"
                    />
                  </div>
                </div>
              </div>

              {/* Right Timeline Region Blocks */}
              <div className="flex-1 relative h-20 bg-[#0B0D19]/40 overflow-hidden flex items-center p-2">
                {/* Background Grid Lines */}
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

                  return (
                    <div
                      key={region.id}
                      id={`region-block-${region.id}`}
                      className={`absolute h-14 rounded-lg ${track.color} bg-opacity-90 border border-white/20 p-2 text-white shadow-md flex flex-col justify-between cursor-move hover:brightness-110 transition-all select-none`}
                      style={{
                        left: `${left}px`,
                        width: `${width - 4}px`,
                      }}
                    >
                      <div className="flex items-center justify-between text-[11px] font-bold truncate">
                        <span className="truncate">{region.name}</span>
                        <span className="text-[9px] opacity-75 font-mono">{(region.durationBeats / 4).toFixed(0)} bars</span>
                      </div>

                      <div className="flex items-center gap-1 opacity-50">
                        {Array.from({ length: 8 }).map((_, i) => (
                          <div key={i} className="h-2 flex-1 bg-white/40 rounded-sm" />
                        ))}
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
  );
};
