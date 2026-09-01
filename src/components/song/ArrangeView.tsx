import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { loadLoop } from '../../store/loadLoop';
import { loopBars } from '../../store/loop';
import { aggregatePlayerState } from '../../store/transportSlice';
import { useAppStore } from '../../store/store';
import { buildRouteUrl } from '../../routing/tabRouting';
import { getMeter } from '../../utils/meter';
import { subscribePlaybackClock } from '../../audio/playback/playbackEngine';
import { ViewHeader } from '../ui/ViewHeader';
import { SortableLoopCard } from './SortableLoopCard';
import { arrangeCycleSteps, arrangeStep } from './arrangeStep';
import { loopIdKeyOf, loopIdsFromKey } from './loopIdKey';

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
export const ArrangeView: React.FC = React.memo(() => {
  const loops = useAppStore((s) => s.loops);
  const activeLoopId = useAppStore((s) => s.activeLoopId);
  const songLoopIndex = useAppStore((s) => s.songLoopIndex);
  const auditionLoopId = useAppStore((s) => s.auditionLoopId);
  const meterId = useAppStore((s) => s.meterId);
  const sequencerPlayer = useAppStore((s) => s.sequencerPlayer);
  const chordsPlayer = useAppStore((s) => s.chordsPlayer);
  const leadPlayer = useAppStore((s) => s.leadPlayer);

  const addLoop = useAppStore((s) => s.addLoop);
  const duplicateLoop = useAppStore((s) => s.duplicateLoop);
  const deleteLoop = useAppStore((s) => s.deleteLoop);
  const reorderLoops = useAppStore((s) => s.reorderLoops);
  const reorderLoopsArray = useAppStore((s) => s.reorderLoopsArray);
  const setLoopName = useAppStore((s) => s.setLoopName);
  const setLoopRepeatCount = useAppStore((s) => s.setLoopRepeatCount);
  const setLoopMix = useAppStore((s) => s.setLoopMix);

  const isPlaying =
    aggregatePlayerState(sequencerPlayer, chordsPlayer, leadPlayer) === 'playing';

  const playingId =
    auditionLoopId !== null
      ? auditionLoopId
      : songLoopIndex !== null && loops[songLoopIndex]
      ? loops[songLoopIndex].id
      : activeLoopId;

  const activeTab = useAppStore((s) => s.activeTab);
  const stepsPerBar = useMemo(() => getMeter(meterId).stepsPerBar, [meterId]);

  // The per-card totals this view divides the playhead by (see the map below).
  // The stored step may only be reduced modulo a COMMON multiple of all of
  // them, or a card's progress bar would jump — arrangeStep.test.ts pins that
  // invariant.
  const cycleSteps = useMemo(
    () =>
      arrangeCycleSteps(
        loops.map(
          (loop) =>
            Math.max(1, loopBars(loop.chords) * stepsPerBar) *
            Math.max(1, loop.repeatCount ?? 1),
        ),
      ),
    [loops, stepsPerBar],
  );

  // Live playback clock step for real-time progress bar
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    // Gated on the tab, not just on isPlaying: SongPage.tsx:10 keeps this view
    // mounted behind `hidden` while the user is on any other tab, so without
    // this the clock drove a setState 8-16x/sec into an invisible list. Same
    // idiom (and same reason) as the AudioVisualizer `paused` gates at
    // EffectsRackView.tsx:299 and SynthView.tsx:418 — see
    // AudioVisualizer.tsx:603-612 for why gating inside the callback is not
    // enough.
    if (!isPlaying || activeTab !== 'arrange') {
      setCurrentStep(0);
      return;
    }
    return subscribePlaybackClock((step) => {
      // Bar-relative, not the raw monotonic step: bounded to one arrangement
      // cycle instead of growing all session, and the identity guard can then
      // actually suppress a render when the clock re-dispatches a step it has
      // already delivered (the stall detector at engine.ts:294 re-anchors the
      // grid and does exactly that).
      const next = arrangeStep(step, cycleSteps);
      setCurrentStep((prev) => (prev === next ? prev : next));
    });
  }, [isPlaying, activeTab, cycleSteps]);

  // The mirrored per-loop field write rebuilds `loops` (and every loop
  // object in it) on every knob/fader change to the active loop, so keying
  // this list on the array identity rebuilt it at pointer rate and dnd-kit's
  // SortableContext re-rendered every card through context — past its own
  // React.memo. Keying on id content instead only changes the list when
  // membership or ordering actually does.
  const loopIdKey = loopIdKeyOf(loops);
  const loopIds = useMemo(() => loopIdsFromKey(loopIdKey), [loopIdKey]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const oldIndex = loops.findIndex((item) => item.id === active.id);
        const newIndex = loops.findIndex((item) => item.id === over.id);
        if (oldIndex !== -1 && newIndex !== -1) {
          const newLoops = arrayMove(loops, oldIndex, newIndex);
          reorderLoopsArray(newLoops);
        }
      }
    },
    [loops, reorderLoopsArray]
  );

  const handleSelectLoop = useCallback((id: string) => {
    loadLoop(id);
  }, []);

  const handleTogglePlayLoop = useCallback((id: string) => {
    const s = useAppStore.getState();
    const playing =
      aggregatePlayerState(s.sequencerPlayer, s.chordsPlayer, s.leadPlayer) === 'playing';

    if (playing && s.auditionLoopId === id) {
      s.hardStopAll();
      s.setAuditionLoopId(null);
      return;
    }

    loadLoop(id);
    s.playAll();
    useAppStore.setState({ auditionLoopId: id, songLoopIndex: null });
  }, []);

  const handleDuplicate = useCallback(
    (id: string) => {
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
    },
    [duplicateLoop]
  );

  const handleDelete = useCallback(
    (id: string) => {
      const fallback = deleteLoop(id);
      if (fallback !== null) loadLoop(fallback);
    },
    [deleteLoop]
  );

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

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={loopIds} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-3">
            {loops.map((loop, index) => {
              const bars = loopBars(loop.chords);
              const repeatCount = Math.max(1, loop.repeatCount ?? 1);
              const singleCycleSteps = Math.max(1, bars * stepsPerBar);
              const isAuditioning = isPlaying && auditionLoopId === loop.id;
              const isSongPlaying = isPlaying && auditionLoopId === null && loop.id === playingId;
              const isCurrentPlaying = isAuditioning || isSongPlaying;
              const isSelected = loop.id === activeLoopId;

              const totalStepsInLoop = singleCycleSteps * (isAuditioning ? 1 : repeatCount);

              const currentStepInLoop = isCurrentPlaying
                ? currentStep % totalStepsInLoop
                : 0;

              const currentRep =
                isCurrentPlaying && !isAuditioning
                  ? Math.floor(currentStepInLoop / singleCycleSteps) + 1
                  : 1;

              const progressPercent = isCurrentPlaying
                ? Math.min(100, Math.max(0, ((currentStepInLoop + 1) / totalStepsInLoop) * 100))
                : 0;

              return (
                <SortableLoopCard
                  key={loop.id}
                  loop={loop}
                  index={index}
                  totalLoops={loops.length}
                  isPlaying={isCurrentPlaying}
                  isAuditioning={isAuditioning}
                  isActive={isSelected}
                  progressPercent={progressPercent}
                  currentStepInLoop={currentStepInLoop}
                  totalStepsInLoop={totalStepsInLoop}
                  singleCycleSteps={singleCycleSteps}
                  currentRep={currentRep}
                  repeatCount={repeatCount}
                  stepsPerBar={stepsPerBar}
                  onSelect={handleSelectLoop}
                  onEdit={editLoop}
                  onDuplicate={handleDuplicate}
                  onDelete={handleDelete}
                  onReorder={reorderLoops}
                  onRename={setLoopName}
                  onSetRepeat={setLoopRepeatCount}
                  onTogglePlayLoop={handleTogglePlayLoop}
                  onSetMix={setLoopMix}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
});
