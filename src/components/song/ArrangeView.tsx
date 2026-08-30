import React from 'react';
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react';
import { loadLoop } from '../../store/loadLoop';
import { loopBars } from '../../store/loop';
import { aggregatePlayerState } from '../../store/transportSlice';
import { useAppStore } from '../../store/store';
import { buildRouteUrl } from '../../routing/tabRouting';
import { PowerToggle, type PowerToggleTone } from '../ui/PowerToggle';
import { Slider } from '../ui/Slider';
import { ViewHeader } from '../ui/ViewHeader';

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

/** One compact mixer strip (mute + gain) inside a loop card. */
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

/** Pure route for the loop-editor deep-link, exported for a pure test. */
export const buildEditRoute = (id: string) => buildRouteUrl('loop', 'synth', id);

/**
 * Deep-link from an Arrange row into the loop editor for one loop. Push the
 * target URL FIRST so the useRouteSync subscriptions below (setActiveTab ->
 * ?tab, loadLoop -> activeLoopId -> ?loopId) see an already-matching URL and
 * skip their own pushState — one history entry, not two.
 */
export const editLoop = (id: string) => {
  window.history.pushState(window.history.state, '', buildRouteUrl('loop', 'synth', id));
  useAppStore.getState().setActiveTab('synth');
  loadLoop(id);
};

/**
 * The Arrange tab: a linear list of loops, top to bottom = playback order.
 * The currently-playing loop is highlighted — in song mode that is
 * loops[songLoopIndex]; in loop mode it is the active loop (the one
 * looping). Clicking a row selects it as active (loadLoop), which while
 * playing jumps the song/loop to that loop.
 */
export const ArrangeView: React.FC = () => {
  const loops = useAppStore((s) => s.loops);
  const activeLoopId = useAppStore((s) => s.activeLoopId);
  const songLoopIndex = useAppStore((s) => s.songLoopIndex);
  const addLoop = useAppStore((s) => s.addLoop);
  const duplicateLoop = useAppStore((s) => s.duplicateLoop);
  const deleteLoop = useAppStore((s) => s.deleteLoop);
  const reorderLoops = useAppStore((s) => s.reorderLoops);
  const setLoopMix = useAppStore((s) => s.setLoopMix);

  const playingId =
    songLoopIndex !== null && loops[songLoopIndex]
      ? loops[songLoopIndex].id
      : activeLoopId;

  const handleDuplicate = (id: string) => {
    const cloneId = duplicateLoop(id);
    if (cloneId === null) return;
    const s = useAppStore.getState();
    const playing =
      aggregatePlayerState(s.sequencerPlayer, s.chordsPlayer, s.leadPlayer) === 'playing';
    // During a live song-mode pass, activating the clone would hard-stop the
    // sounding loop and jump the song onto it — the duplicate is only meant
    // to be added for editing, so skip the swap while the song is running.
    if (s.songLoopIndex !== null && playing) return;
    loadLoop(cloneId);
  };
  const handleDelete = (id: string) => {
    const fallback = deleteLoop(id);
    if (fallback !== null) loadLoop(fallback);
  };

  return (
    <div className="p-3 sm:p-4 max-w-7xl mx-auto flex flex-col gap-3">
      <ViewHeader
        view="arrange"
        badge={`${loops.length} loop${loops.length === 1 ? '' : 's'}`}
        actions={
          <button
            id="btn-arrange-add"
            type="button"
            onClick={() => addLoop()}
            className="btn btn-sm btn-primary gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Add Loop
          </button>
        }
      />

      <div className="flex flex-col gap-2">
        {loops.map((loop, index) => {
          const bars = loopBars(loop.chords);
          const isPlaying = loop.id === playingId;
          return (
            <div
              key={loop.id}
              className={`rounded-box border bg-base-200 ${
                isPlaying ? 'border-primary/40 bg-primary/5' : 'border-base-300'
              }`}
            >
              <div className="flex items-center gap-2 p-2">
                <button
                  id={`btn-loop-select-${loop.id}`}
                  type="button"
                  onClick={() => loadLoop(loop.id)}
                  className="btn btn-sm btn-ghost flex-1 justify-start gap-2 min-w-0"
                >
                  <span className="font-bold text-base-content truncate">{loop.name}</span>
                  <span className="text-xs text-base-content/50 shrink-0">
                    {`${bars} bar${bars === 1 ? '' : 's'}`}
                  </span>
                </button>
                <button
                  id={`btn-loop-edit-${loop.id}`}
                  type="button"
                  aria-label={`Edit ${loop.name}`}
                  onClick={() => editLoop(loop.id)}
                  className="btn btn-xs btn-ghost"
                >
                  Edit
                </button>
                <button
                  id={`btn-loop-up-${loop.id}`}
                  type="button"
                  aria-label={`Move ${loop.name} up`}
                  disabled={index === 0}
                  onClick={() => reorderLoops(loop.id, -1)}
                  className="btn btn-sm btn-square btn-ghost"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
                <button
                  id={`btn-loop-down-${loop.id}`}
                  type="button"
                  aria-label={`Move ${loop.name} down`}
                  disabled={index === loops.length - 1}
                  onClick={() => reorderLoops(loop.id, 1)}
                  className="btn btn-sm btn-square btn-ghost"
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
                <button
                  id={`btn-loop-duplicate-${loop.id}`}
                  type="button"
                  aria-label={`Duplicate ${loop.name}`}
                  onClick={() => handleDuplicate(loop.id)}
                  className="btn btn-sm btn-square btn-ghost"
                >
                  <Copy className="w-4 h-4" />
                </button>
                <button
                  id={`btn-loop-delete-${loop.id}`}
                  type="button"
                  aria-label={`Delete ${loop.name}`}
                  disabled={loops.length <= 1}
                  onClick={() => handleDelete(loop.id)}
                  className="btn btn-sm btn-square btn-ghost"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-2 pt-0">
                <MixChannel
                  idPrefix={`synth-${loop.id}`}
                  label="Lead"
                  volume={loop.synthVolume}
                  muted={loop.synthMuted}
                  max={1.5}
                  tone="primary"
                  sliderAccent="text-primary"
                  onVolume={(v) => setLoopMix(loop.id, { synthVolume: v })}
                  onToggleMute={() => setLoopMix(loop.id, { synthMuted: !loop.synthMuted })}
                />
                <MixChannel
                  idPrefix={`drum-${loop.id}`}
                  label="Drum"
                  volume={loop.masterSequencerVolume}
                  muted={loop.drumMuted}
                  max={1.0}
                  tone="accent"
                  sliderAccent="text-accent"
                  onVolume={(v) => setLoopMix(loop.id, { masterSequencerVolume: v })}
                  onToggleMute={() => setLoopMix(loop.id, { drumMuted: !loop.drumMuted })}
                />
                <MixChannel
                  idPrefix={`chord-${loop.id}`}
                  label="Chord"
                  volume={loop.chordVolume}
                  muted={loop.chordMuted}
                  max={1.5}
                  tone="module-chord"
                  sliderAccent="text-module-chord"
                  onVolume={(v) => setLoopMix(loop.id, { chordVolume: v })}
                  onToggleMute={() => setLoopMix(loop.id, { chordMuted: !loop.chordMuted })}
                />
                <MixChannel
                  idPrefix={`bass-${loop.id}`}
                  label="Bass"
                  volume={loop.bassVolume}
                  muted={loop.bassMuted}
                  max={1.5}
                  tone="module-bass"
                  sliderAccent="text-module-bass"
                  onVolume={(v) => setLoopMix(loop.id, { bassVolume: v })}
                  onToggleMute={() => setLoopMix(loop.id, { bassMuted: !loop.bassMuted })}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
