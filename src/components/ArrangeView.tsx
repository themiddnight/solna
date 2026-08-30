import React from 'react';
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react';
import { loadRegion } from '../store/loadRegion';
import { regionBars } from '../store/region';
import { useAppStore } from '../store/store';
import { PowerToggle, type PowerToggleTone } from './ui/PowerToggle';
import { Slider } from './ui/Slider';
import { ViewHeader } from './ui/ViewHeader';

type MixChannelProps = {
  idPrefix: string;
  label: string;
  volume: number;
  muted: boolean;
  max: number;
  tone: PowerToggleTone;
  sliderAccent: string;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
};

/** One compact mixer strip (mute + gain) inside a region card. */
const MixChannel: React.FC<MixChannelProps> = ({
  idPrefix,
  label,
  volume,
  muted,
  max,
  tone,
  sliderAccent,
  onVolume,
  onToggleMute,
}) => (
  <div className="flex flex-col gap-1 min-w-0">
    <div className="flex items-center justify-between gap-1">
      <span className="text-[10px] font-bold uppercase tracking-wide text-base-content/60">
        {label}
      </span>
      <PowerToggle
        id={`btn-mute-${idPrefix}`}
        on={!muted}
        onToggle={onToggleMute}
        name={`${label} mute`}
        tone={tone}
        size="xs"
        iconOnly
        verb={{ on: 'Unmute', off: 'Mute' }}
      />
    </div>
    <div className="flex items-center gap-1.5">
      <Slider
        id={`slider-${idPrefix}`}
        min={0}
        max={max}
        step={0.05}
        value={volume}
        onChange={onVolume}
        className={`range range-xs ${sliderAccent} w-full`}
        title={`${label} gain`}
      />
      <span className="text-[10px] font-mono w-8 text-right shrink-0">
        {Math.round(volume * 100)}%
      </span>
    </div>
  </div>
);

/**
 * The Arrange tab: a linear list of regions, top to bottom = playback order.
 * The currently-playing region is highlighted — in song mode that is
 * regions[songRegionIndex]; in loop mode it is the active region (the one
 * looping). Clicking a row selects it as active (loadRegion), which while
 * playing jumps the song/loop to that region.
 */
export const ArrangeView: React.FC = () => {
  const regions = useAppStore((s) => s.regions);
  const activeRegionId = useAppStore((s) => s.activeRegionId);
  const songRegionIndex = useAppStore((s) => s.songRegionIndex);
  const addRegion = useAppStore((s) => s.addRegion);
  const duplicateRegion = useAppStore((s) => s.duplicateRegion);
  const deleteRegion = useAppStore((s) => s.deleteRegion);
  const reorderRegions = useAppStore((s) => s.reorderRegions);
  const setRegionMix = useAppStore((s) => s.setRegionMix);

  const playingId =
    songRegionIndex !== null && regions[songRegionIndex]
      ? regions[songRegionIndex].id
      : activeRegionId;

  const handleDuplicate = (id: string) => {
    const cloneId = duplicateRegion(id);
    if (cloneId === null) return;
    const s = useAppStore.getState();
    const playing =
      s.sequencerPlayer === 'playing' || s.chordsPlayer === 'playing' || s.leadPlayer === 'playing';
    // During a live song-mode pass, activating the clone would hard-stop the
    // sounding region and jump the song onto it — the duplicate is only meant
    // to be added for editing, so skip the swap while the song is running.
    if (s.songRegionIndex !== null && playing) return;
    loadRegion(cloneId);
  };
  const handleDelete = (id: string) => {
    const fallback = deleteRegion(id);
    if (fallback !== null) loadRegion(fallback);
  };

  return (
    <div className="p-3 sm:p-4 flex flex-col gap-3">
      <ViewHeader
        view="arrange"
        badge={`${regions.length} region${regions.length === 1 ? '' : 's'}`}
        actions={
          <button
            id="btn-arrange-add"
            type="button"
            onClick={() => addRegion()}
            className="btn btn-sm btn-primary gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Add Region
          </button>
        }
      />

      <div className="flex flex-col gap-2">
        {regions.map((region, index) => {
          const bars = regionBars(region.chords);
          const isPlaying = region.id === playingId;
          return (
            <div
              key={region.id}
              className={`rounded-box border bg-base-200 ${
                isPlaying ? 'border-primary/40 bg-primary/5' : 'border-base-300'
              }`}
            >
              <div className="flex items-center gap-2 p-2">
                <button
                  id={`btn-region-select-${region.id}`}
                  type="button"
                  onClick={() => loadRegion(region.id)}
                  className="btn btn-sm btn-ghost flex-1 justify-start gap-2 min-w-0"
                >
                  <span className="font-bold text-base-content truncate">{region.name}</span>
                  <span className="text-xs text-base-content/50 shrink-0">
                    {`${bars} bar${bars === 1 ? '' : 's'}`}
                  </span>
                </button>
                <button
                  id={`btn-region-up-${region.id}`}
                  type="button"
                  aria-label={`Move ${region.name} up`}
                  disabled={index === 0}
                  onClick={() => reorderRegions(region.id, -1)}
                  className="btn btn-sm btn-square btn-ghost"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
                <button
                  id={`btn-region-down-${region.id}`}
                  type="button"
                  aria-label={`Move ${region.name} down`}
                  disabled={index === regions.length - 1}
                  onClick={() => reorderRegions(region.id, 1)}
                  className="btn btn-sm btn-square btn-ghost"
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
                <button
                  id={`btn-region-duplicate-${region.id}`}
                  type="button"
                  aria-label={`Duplicate ${region.name}`}
                  onClick={() => handleDuplicate(region.id)}
                  className="btn btn-sm btn-square btn-ghost"
                >
                  <Copy className="w-4 h-4" />
                </button>
                <button
                  id={`btn-region-delete-${region.id}`}
                  type="button"
                  aria-label={`Delete ${region.name}`}
                  disabled={regions.length <= 1}
                  onClick={() => handleDelete(region.id)}
                  className="btn btn-sm btn-square btn-ghost"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-2 pt-0">
                <MixChannel
                  idPrefix={`synth-${region.id}`}
                  label="Lead"
                  volume={region.synthVolume}
                  muted={region.synthMuted}
                  max={1.5}
                  tone="primary"
                  sliderAccent="text-primary"
                  onVolume={(v) => setRegionMix(region.id, { synthVolume: v })}
                  onToggleMute={() => setRegionMix(region.id, { synthMuted: !region.synthMuted })}
                />
                <MixChannel
                  idPrefix={`drum-${region.id}`}
                  label="Drum"
                  volume={region.masterSequencerVolume}
                  muted={region.drumMuted}
                  max={1.0}
                  tone="accent"
                  sliderAccent="text-accent"
                  onVolume={(v) => setRegionMix(region.id, { masterSequencerVolume: v })}
                  onToggleMute={() => setRegionMix(region.id, { drumMuted: !region.drumMuted })}
                />
                <MixChannel
                  idPrefix={`chord-${region.id}`}
                  label="Chord"
                  volume={region.chordVolume}
                  muted={region.chordMuted}
                  max={1.5}
                  tone="module-chord"
                  sliderAccent="text-module-chord"
                  onVolume={(v) => setRegionMix(region.id, { chordVolume: v })}
                  onToggleMute={() => setRegionMix(region.id, { chordMuted: !region.chordMuted })}
                />
                <MixChannel
                  idPrefix={`bass-${region.id}`}
                  label="Bass"
                  volume={region.bassVolume}
                  muted={region.bassMuted}
                  max={1.5}
                  tone="module-bass"
                  sliderAccent="text-module-bass"
                  onVolume={(v) => setRegionMix(region.id, { bassVolume: v })}
                  onToggleMute={() => setRegionMix(region.id, { bassMuted: !region.bassMuted })}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
