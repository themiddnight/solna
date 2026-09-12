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
import { loadLoop } from '@/store/loadLoop';
import { loopPlayButton, scopedLoopId, type PlaybackScope } from '@/store/playbackScope';
import { loopLabel } from '@/store/loop';
import { loopBars, loopDwellSteps } from '@/utils/songStructure';
import type { LoopCopyGroupId } from '@/store/loopCopy';
import type { Loop } from '@/store/types';
import { aggregateAllPlayers } from '@/store/transportSlice';
import { useAppStore } from '@/store/store';
import { buildRouteUrl } from '@/routing/tabRouting';
import { getMeter } from '@/utils/meter';
import { subscribePlaybackClock } from '@/audio/playback/playbackEngine';
import { ViewHeader } from '../ui/ViewHeader';
import { LoopCopyDialog } from './LoopCopyDialog';
import { SortableLoopCard } from './SortableLoopCard';
import { arrangeCycleSteps, arrangeStep } from './arrangeStep';
import { loopIdKeyOf, loopIdsFromKey } from './loopIdKey';

/** Stable identity for the closed-dialog case — see the `labels` memo below. */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const EMPTY_LOOP_LABELS: Readonly<Record<string, string>> = {};

/** Pure route for the loop-editor deep-link, exported for a pure test. */
export const buildEditRoute = (id: string) => buildRouteUrl('loop', 'sound', id);

/**
 * Deep-link from an Arrange row into the loop editor for one loop. Push the
 * target URL FIRST so the useRouteSync subscriptions below (setActiveTab ->
 * ?tab, loadLoop -> activeLoopId -> ?loopId) see an already-matching URL and
 * skip their own pushState — one history entry, not two.
 */
export const editLoop = (id: string) => {
  window.history.pushState(window.history.state, '', buildRouteUrl('loop', 'sound', id));
  useAppStore.getState().setActiveTab('sound');
  loadLoop(id);
};

/**
 * One card's playback readout, derived from the arrange playhead position.
 * Pure, so what the card shows is a function of the playhead and nothing else.
 */
function cardPlaybackProps({
  loop,
  isPlaying,
  scopedId,
  playingId,
  activeLoopId,
  playbackScope,
  currentStep,
  stepsPerBar,
}: {
  loop: Loop;
  isPlaying: boolean;
  scopedId: string | null;
  playingId: string | null;
  activeLoopId: string | null;
  playbackScope: PlaybackScope;
  currentStep: number;
  stepsPerBar: number;
}) {
  const bars = loopBars(loop.chords);
  const repeatCount = Math.max(1, loop.repeatCount ?? 1);
  const singleCycleSteps = Math.max(1, bars * stepsPerBar);
  const isAuditioning = isPlaying && scopedId === loop.id;
  const isSongPlaying = isPlaying && scopedId === null && loop.id === playingId;
  const isCurrentPlaying = isAuditioning || isSongPlaying;
  const isSelected = loop.id === activeLoopId;
  const playButton = loopPlayButton(playbackScope, loop.id);

  const totalStepsInLoop = singleCycleSteps * (isAuditioning ? 1 : repeatCount);
  const currentStepInLoop = isCurrentPlaying ? currentStep % totalStepsInLoop : 0;

  const currentRep =
    isCurrentPlaying && !isAuditioning
      ? Math.floor(currentStepInLoop / singleCycleSteps) + 1
      : 1;

  const progressPercent = isCurrentPlaying
    ? Math.min(100, Math.max(0, ((currentStepInLoop + 1) / totalStepsInLoop) * 100))
    : 0;

  return {
    repeatCount,
    singleCycleSteps,
    isAuditioning,
    isCurrentPlaying,
    isSelected,
    playButton,
    totalStepsInLoop,
    currentStepInLoop,
    currentRep,
    progressPercent,
  };
}

/**
 * The arrange playhead's step, and the scroll that follows it across loops.
 *
 * Both effects are gated on the tab, not just on isPlaying: SongPage keeps
 * this view mounted behind `hidden` while the user is on any other tab, so
 * without the gate the clock drove a setState 8-16x/sec into an invisible
 * list — the same idiom (and the same reason) as the `paused={activeTab !== …}`
 * props EffectsRackView and SoundView hand their AudioVisualizers, and see
 * AudioVisualizer's own rAF effect, which returns on `paused` BEFORE
 * requesting a frame, for why gating inside the callback is not enough.
 */
function useArrangePlayhead({
  isPlaying,
  cycleSteps,
  playingId,
}: {
  isPlaying: boolean;
  cycleSteps: number;
  playingId: string | null;
}) {
  const activeTab = useAppStore((s) => s.activeTab);
  const followPlayhead = useAppStore((s) => s.followPlayhead);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
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

  // Follow the playhead across loops. Song playback walks from one card to the
  // next on its own, and past a handful of loops the playing card leaves the
  // viewport with nothing to bring it back.
  //
  // The dependency list is the feature, not an optimisation: it holds the loop
  // IDENTITY and nothing that changes inside a loop, so this fires once per
  // change of loop and the user owns the scroll position for the whole time one
  // loop is playing. `currentStep` (8-16 writes a second) must never be added
  // here — that would re-scroll on every clock tick and fight the user's own
  // scrolling continuously.
  //
  // `block: 'center'` rather than `'nearest'`: `'nearest'` scrolls the minimum,
  // which parks the incoming card flush against whichever edge it entered from,
  // with no sight of the loops on either side of it. Centring costs a scroll
  // even when the card was already visible, but that only happens on a loop
  // change, which is exactly when moving is the point.
  //
  // Gated on the tab for the same reason the clock subscription above is: this
  // view stays mounted behind `hidden`, and scrolling from a surface nobody is
  // looking at would move the scroll container out from under the visible one.
  //
  // `followPlayhead` (the header's toggle, song layer) is the user's opt-out:
  // off, this effect does nothing at all and the scroll position is theirs for
  // the whole song. It is read here rather than gating the toggle's own writer
  // because turning follow back ON mid-playback should catch up to the playing
  // card immediately — the effect re-runs on the flag and scrolls once.
  useEffect(() => {
    if (!followPlayhead || !isPlaying || activeTab !== 'arrange' || !playingId) return;
    const card = document.getElementById(`card-loop-${playingId}`);
    if (!card) return;
    card.scrollIntoView({
      behavior: window.matchMedia(REDUCED_MOTION_QUERY).matches ? 'auto' : 'smooth',
      block: 'center',
    });
  }, [followPlayhead, isPlaying, activeTab, playingId]);

  return currentStep;
}

/** The drag sensors and the reorder commit, which together ARE the drag. */
function useArrangeDrag(loops: Loop[]) {
  const reorderLoopsArray = useAppStore((s) => s.reorderLoopsArray);

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
          reorderLoopsArray(arrayMove(loops, oldIndex, newIndex));
        }
      }
    },
    [loops, reorderLoopsArray]
  );

  return { sensors, handleDragEnd };
}

/**
 * Every per-card callback the list needs, plus the copy dialog's target. One
 * hook rather than a dozen `useCallback`s threaded through the view body: the
 * cards call these as a set, and they read that way.
 */
function useLoopCardActions() {
  const duplicateLoop = useAppStore((s) => s.duplicateLoop);
  const deleteLoop = useAppStore((s) => s.deleteLoop);
  const reorderLoops = useAppStore((s) => s.reorderLoops);
  const setLoopName = useAppStore((s) => s.setLoopName);
  const setLoopRepeatCount = useAppStore((s) => s.setLoopRepeatCount);
  const setLoopMix = useAppStore((s) => s.setLoopMix);
  const applyLoopCopy = useAppStore((s) => s.applyLoopCopy);

  // The id of the loop being copied INTO, or null when the dialog is closed.
  // One dialog for the whole list: every card is mounted simultaneously
  // inside the SortableContext, so a per-card dialog would mount a full form
  // per loop and re-render all of them on every tick of the arrange playhead.
  const [copyTargetId, setCopyTargetId] = useState<string | null>(null);

  const onSelect = useCallback((id: string) => {
    loadLoop(id);
  }, []);

  const onTogglePlayLoop = useCallback((id: string) => {
    const s = useAppStore.getState();
    const playing = aggregateAllPlayers(s) === 'playing';

    if (playing && scopedLoopId(s.playbackScope) === id) {
      // hardStopAll's own 'stop-all' dispatch already resets the scope.
      s.hardStopAll();
      return;
    }

    // loadLoop first (it hard-stops and restarts whatever was playing), then
    // let soloLoop own the scope AND the player patch in one set() — it
    // already starts the stopped players and drops songLoopIndex itself, so
    // there is no second writer to keep in sync with the reducer.
    loadLoop(id);
    s.soloLoop(id);
  }, []);

  const onDuplicate = useCallback(
    (id: string) => {
      const cloneId = duplicateLoop(id);
      if (cloneId === null) return;
      const s = useAppStore.getState();
      const playing = aggregateAllPlayers(s) === 'playing';
      // During a live song-mode pass, activating the clone would hard-stop the
      // sounding loop and jump the song onto it — the duplicate is only meant
      // to be added for editing, so skip the swap while the song is running.
      if (s.songLoopIndex !== null && playing) return;
      loadLoop(cloneId);
    },
    [duplicateLoop]
  );

  const onDelete = useCallback(
    (id: string) => {
      const fallback = deleteLoop(id);
      if (fallback !== null) loadLoop(fallback);
    },
    [deleteLoop]
  );

  const onCopyInto = useCallback((id: string) => setCopyTargetId(id), []);

  const onApplyCopy = useCallback(
    (targetId: string, sourceId: string, selected: readonly LoopCopyGroupId[]) => {
      applyLoopCopy(targetId, sourceId, selected);
    },
    [applyLoopCopy]
  );

  const closeCopy = useCallback(() => setCopyTargetId(null), []);

  return {
    copyTargetId,
    closeCopy,
    onSelect,
    onEdit: editLoop,
    onDuplicate,
    onCopyInto,
    onDelete,
    onReorder: reorderLoops,
    onRename: setLoopName,
    onSetRepeat: setLoopRepeatCount,
    onTogglePlayLoop,
    onSetMix: setLoopMix,
    onApplyCopy,
  };
}

type LoopCardActions = ReturnType<typeof useLoopCardActions>;

/** The Arrange header: the loop count, and the Add Loop action. */
function ArrangeHeader({ loopCount, onAdd }: { loopCount: number; onAdd: () => void }) {
  return (
    <ViewHeader
      view="arrange"
      badge={`${loopCount} loop${loopCount === 1 ? '' : 's'}`}
      actions={
        <button
          id="btn-arrange-add"
          type="button"
          onClick={onAdd}
          className="btn btn-sm btn-primary gap-1.5"
        >
          <Plus className="w-4 h-4" />
          Add Loop
        </button>
      }
    />
  );
}

/** The sortable list itself: one row per loop, in playback order. */
function ArrangeLoopList({
  loops,
  loopIds,
  sensors,
  onDragEnd,
  currentStep,
  stepsPerBar,
  isPlaying,
  scopedId,
  playingId,
  activeLoopId,
  playbackScope,
  actions,
}: {
  loops: readonly Loop[];
  loopIds: string[];
  sensors: ReturnType<typeof useSensors>;
  onDragEnd: (event: DragEndEvent) => void;
  currentStep: number;
  stepsPerBar: number;
  isPlaying: boolean;
  scopedId: string | null;
  playingId: string | null;
  activeLoopId: string | null;
  playbackScope: PlaybackScope;
  actions: LoopCardActions;
}) {
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={loopIds} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-3">
          {loops.map((loop, index) => {
            const card = cardPlaybackProps({
              loop,
              isPlaying,
              scopedId,
              playingId,
              activeLoopId,
              playbackScope,
              currentStep,
              stepsPerBar,
            });
            return (
              <SortableLoopCard
                key={loop.id}
                loop={loop}
                index={index}
                totalLoops={loops.length}
                label={loopLabel(loop)}
                isPlaying={card.isCurrentPlaying}
                isAuditioning={card.isAuditioning}
                playDisabled={card.playButton.disabled}
                isActive={card.isSelected}
                progressPercent={card.progressPercent}
                currentStepInLoop={card.currentStepInLoop}
                totalStepsInLoop={card.totalStepsInLoop}
                singleCycleSteps={card.singleCycleSteps}
                currentRep={card.currentRep}
                repeatCount={card.repeatCount}
                stepsPerBar={stepsPerBar}
                onSelect={actions.onSelect}
                onEdit={actions.onEdit}
                onDuplicate={actions.onDuplicate}
                onCopyInto={actions.onCopyInto}
                onDelete={actions.onDelete}
                onReorder={actions.onReorder}
                onRename={actions.onRename}
                onSetRepeat={actions.onSetRepeat}
                onTogglePlayLoop={actions.onTogglePlayLoop}
                onSetMix={actions.onSetMix}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}

/**
 * The Arrange tab: a linear list of loops, top to bottom = playback order.
 * The currently-playing loop is highlighted — in song mode that is
 * loops[songLoopIndex]; in loop mode it is the active loop (the one
 * looping). Clicking a row selects it as active (loadLoop), which while
 * playing jumps the song/loop to that loop.
 */
export const ArrangeView = React.memo(function ArrangeView() {
  const loops = useAppStore((s) => s.loops);
  const activeLoopId = useAppStore((s) => s.activeLoopId);
  const songLoopIndex = useAppStore((s) => s.songLoopIndex);
  const playbackScope = useAppStore((s) => s.playbackScope);
  const meterId = useAppStore((s) => s.meterId);
  const addLoop = useAppStore((s) => s.addLoop);

  const isPlaying = useAppStore((s) => aggregateAllPlayers(s) === 'playing');

  const scopedId = scopedLoopId(playbackScope);

  const playingId =
    scopedId !== null
      ? scopedId
      : songLoopIndex !== null && loops[songLoopIndex]
      ? loops[songLoopIndex].id
      : activeLoopId;

  const stepsPerBar = useMemo(() => getMeter(meterId).stepsPerBar, [meterId]);

  // The per-card totals this view divides the playhead by (see the map below).
  // The stored step may only be reduced modulo a COMMON multiple of all of
  // them, or a card's progress bar would jump — arrangeStep.test.ts pins that
  // invariant.
  //
  // These totals are `loopDwellSteps`, the arrangement's OWN dwell rule, not a
  // second copy of it: the card shows how far through the loop the song is, so
  // a card total that disagreed with `songAdvanceDecision` would put the
  // playhead at the wrong place on the card it is drawn on.
  const cycleSteps = useMemo(
    () => arrangeCycleSteps(loops.map((loop) => loopDwellSteps(loop, stepsPerBar))),
    [loops, stepsPerBar],
  );

  const currentStep = useArrangePlayhead({ isPlaying, cycleSteps, playingId });
  const { sensors, handleDragEnd } = useArrangeDrag(loops);
  const actions = useLoopCardActions();

  // The mirrored per-loop field write rebuilds `loops` (and every loop
  // object in it) on every knob/fader change to the active loop, so keying
  // this list on the array identity rebuilt it at pointer rate and dnd-kit's
  // SortableContext re-rendered every card through context — past its own
  // React.memo. Keying on id content instead only changes the list when
  // membership or ordering actually does.
  const loopIdKey = loopIdKeyOf(loops);
  const loopIds = useMemo(() => loopIdsFromKey(loopIdKey), [loopIdKey]);

  // The card never reads loop.name/loop.tempName; ArrangeView resolves the
  // displayed label once and hands the same strings to the card and to the
  // dialog, so a card and its copy dialog can never disagree about a name.
  // `labels` feeds ONLY LoopCopyDialog below, which mounts exclusively while
  // `copyTargetId !== null` — closed the overwhelming majority of the time.
  // Skipping the map while closed matters for the same reason the
  // `loopIdKey` comment above does: `loops` gets a new array (and every loop
  // object re-spread) on every fader-drag tick, and without this guard that
  // tick would also rebuild a same-size label map nothing is reading.
  const labels = useMemo(
    () =>
      actions.copyTargetId === null
        ? EMPTY_LOOP_LABELS
        : Object.fromEntries(loops.map((loop) => [loop.id, loopLabel(loop)])),
    [loops, actions.copyTargetId],
  );

  return (
    <div className="p-3 sm:p-4 max-w-7xl mx-auto flex flex-col gap-3">
      <ArrangeHeader loopCount={loops.length} onAdd={() => addLoop()} />

      <ArrangeLoopList
        loops={loops}
        loopIds={loopIds}
        sensors={sensors}
        onDragEnd={handleDragEnd}
        currentStep={currentStep}
        stepsPerBar={stepsPerBar}
        isPlaying={isPlaying}
        scopedId={scopedId}
        playingId={playingId}
        activeLoopId={activeLoopId}
        playbackScope={playbackScope}
        actions={actions}
      />

      {actions.copyTargetId !== null && (
        <LoopCopyDialog
          targetId={actions.copyTargetId}
          loops={loops}
          labels={labels}
          onApply={actions.onApplyCopy}
          onClose={actions.closeCopy}
        />
      )}
    </div>
  );
});
