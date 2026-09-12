import React, { Suspense } from "react";
import {
  Sliders,
  Zap,
  Sparkles,
  Bookmark,
  Library,
  Check,
  ChevronLeft,
  ChevronRight,
  AudioWaveform,
} from "lucide-react";
import { useAppStore } from "@/store/store";
import { soloTrackForFocus } from "@/store/trackAudibility";
import { SoloButton } from "../ui/SoloButton";
import {
  MIX_LAYER_IDS,
  controlTargetForFocus,
  isMelodicFocus,
  melodyTrackForFocus,
  synthTargetForFocus,
  type MixLayerId,
} from "@/store/focusTrack";
import { MIX_LAYER_LABELS } from "../mixLayers";
import type { SynthPresetItem, SynthPresetCategory } from "@/data/synthPresets";
import { SYNTH_CATEGORIES } from "@/data/synthPresets";
// The drawer is never needed on first paint — PresetLibrary early-returns
// null when closed — so it is code-split out of the main chunk.
const SynthPresetLibrary = React.lazy(() =>
  import("./SynthPresetLibrary").then((m) => ({ default: m.SynthPresetLibrary })),
);
import { AudioVisualizer } from "../AudioVisualizer";
import { SimpleSynthPanel } from "./SimpleSynthPanel";
import { OscillatorPanel } from "./synth/OscillatorPanel";
import { FilterPanel } from "./synth/FilterPanel";
import { EnvelopePanel } from "./synth/EnvelopePanel";
import { LfoPanel } from "./synth/LfoPanel";
import { ArpeggiatorPanel } from "./synth/ArpeggiatorPanel";
import { synthChannelForFocus } from "./synth/useSynthChannel";
import { ModulePasteButton } from "./ModulePasteButton";
import { QuickSavePopover } from "../ui/QuickSavePopover";
import { ViewHeader } from "../ui/ViewHeader";
import { SectionCard } from "../ui/SectionCard";
import { IconButton } from "../ui/IconButton";
import { GROUP_LABEL, COUNT_BADGE } from "../ui/fieldClasses";
import { SYNTH_TARGET_STYLES } from "@/utils/synthControl";
import type { SynthControlTarget } from "@/utils/synthControl";
import type { LoopCopyGroupId } from "@/store/loopCopy";
import { GroupFrame } from "../ui/GroupFrame";
import { TOOLBAR_BUTTON_IDLE } from "@/components/ui/Toolbar";
import { SegmentedButton, SegmentedGroup } from "@/components/ui/SegmentedControl";
import type { SynthParams } from "@/types";
import {
  categoryPresetCount,
  groupInCategory,
  useSynthOverlays,
  useSynthPresetBrowser,
  useSynthViewMode,
  type SynthOverlays,
  type SynthPresetBrowser,
} from "./synth/synthPresetBrowser";

/**
 * The two depths the Sound tab can show the same patch at, in toggle order.
 * A table rather than two hand-written buttons for the reason the segment row
 * is one: the pair must stay identical in everything but their label and icon.
 */
const SYNTH_VIEW_MODES = [
  { mode: "simple", label: "Simple", icon: Sliders },
  { mode: "pro", label: "Pro", icon: Zap },
] as const;

// The two MELODY focuses render as bare chips, the three accompaniment ones go
// in the framed group, and Beat sits last on its own — the same pitched-first,
// rhythm-after order MIX_LAYERS uses. Derived from the roster rather than
// hand-listed so a seventh layer renders somewhere instead of silently
// nowhere, and the melody split asks the store which focuses ARE melody
// tracks rather than listing them or testing `!== 'synth'`: FX is a melody
// track beside Lead, and putting it under a frame labelled "Accompaniment"
// would make the frame say something untrue — as would a third melody track
// that a hand-written pair had never heard of. Module scope for the same reason
// a static record is: this section re-renders per pointermove during a Knob
// drag.
const MELODY_FOCUSES: readonly MixLayerId[] = MIX_LAYER_IDS.filter(
  (id) => melodyTrackForFocus(id) !== null,
);
const BEAT_FOCUS: MixLayerId = 'drum';
const ACCOMPANIMENT_FOCUSES = MIX_LAYER_IDS.filter(
  (id) => !MELODY_FOCUSES.includes(id) && id !== BEAT_FOCUS,
);

// The Beat chip's label comes from MIX_LAYERS' drum row; its styling is
// literal rather than from SYNTH_TARGET_STYLES, which has five entries and no
// sixth to add: a drum focus has no synth channel, so a row in that table
// would be a claim that it does. Both class strings are literals — Tailwind v4
// scans source statically, so a class assembled at runtime would never be
// emitted.
const BEAT_CHIP = {
  label: MIX_LAYER_LABELS[BEAT_FOCUS],
  activeBtn: 'btn-accent',
  softBtn: 'btn-soft btn-accent',
};

/** The Pro mode category tabs, in the order the original listed them. */
const PRO_CATEGORY_TABS: readonly { id: string; label: string }[] = [
  { id: "All", label: "All" },
  { id: "Bass", label: "Bass" },
  { id: "Lead", label: "Lead" },
  { id: "Pad", label: "Pad" },
  { id: "Keys", label: "Keys" },
  { id: "Pluck", label: "Pluck" },
  { id: "Brass", label: "Brass" },
  { id: "FX", label: "FX" },
  { id: "User", label: "Custom" },
];

/** The Simple mode style chips, with the original's emoji per chip. */
const SIMPLE_CATEGORY_CHIPS: readonly { id: string; label: string; emoji: string }[] = [
  { id: "All", label: "All Sounds", emoji: "✨" },
  { id: "Lead", label: "Lead Melody", emoji: "⚡" },
  { id: "Pad", label: "Ambient Pad", emoji: "🌌" },
  { id: "Keys", label: "Keys & Piano", emoji: "🎹" },
  { id: "Bass", label: "Deep Bass", emoji: "🔥" },
  { id: "Pluck", label: "Snappy Pluck", emoji: "🪕" },
  { id: "Brass", label: "Brass Stabs", emoji: "🎷" },
  { id: "FX", label: "Sci-Fi FX", emoji: "🛸" },
];

/**
 * The focus row: the one "what am I working on" control, and the only place on
 * this tab that can change it. It sits OUTSIDE the Synth section, not inside it
 * as the old Target row did, because the Synth section is unmounted on a drum
 * focus — inside, the row would take the only way back to a melodic focus down
 * with it.
 */
function SoundFocusRow({
  focusTrack,
  synthTarget,
  activeTab,
  onFocus,
}: {
  focusTrack: MixLayerId;
  synthTarget: SynthControlTarget | null;
  activeTab: string;
  onFocus: (focus: MixLayerId) => void;
}) {
  const renderFocusChip = (focus: MixLayerId) => {
    const style = isMelodicFocus(focus)
      ? SYNTH_TARGET_STYLES[controlTargetForFocus(focus)]
      : BEAT_CHIP;
    return (
      <button
        key={focus}
        id={`btn-focus-${focus}`}
        aria-current={focusTrack === focus ? 'true' : undefined}
        onClick={() => onFocus(focus)}
        className={`btn btn-xs text-[11px] font-semibold rounded-sm ${
          focusTrack === focus ? style.activeBtn : style.softBtn
        }`}
      >
        {style.label}
      </button>
    );
  };

  return (
    /* Six chips, not five: `drum` is a focus like any other and Beat is
       where the drum kit is edited. Kept as its own row, visible in both
       Simple and Pro mode, because it is the control that switches which
       channel every knob below points at. */
    <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
      {/* Control Destination Selector */}
      <div
        className={`flex items-center gap-1 flex-wrap bg-base-200 border rounded-box px-2 py-1 ${synthTarget ? SYNTH_TARGET_STYLES[synthTarget].border : 'border-accent'}`}
      >
        <span className={`${GROUP_LABEL} pl-1 pr-1 hidden sm:inline`}>
          Focus:
        </span>
        {MELODY_FOCUSES.map(renderFocusChip)}
        {/* Chord, bass and pad are one job done three ways. The frame is
            inside the tinted outer group, not replacing it: the outer
            tint tracks the ACTIVE target, this one groups three of the
            four. See ui/GroupFrame for why it adds no colour.
            daisyUI's join requires its direct children to be the joined
            items, and a GroupFrame between the outer div and three of
            the four chips breaks that contract, so join/join-item are
            dropped from this whole row; gap-1 (already on the row and
            the frame) carries the spacing join used to. */}
        <GroupFrame label="Accompaniment" className="flex items-center gap-1 p-1">
          {ACCOMPANIMENT_FOCUSES.map(renderFocusChip)}
        </GroupFrame>
        {renderFocusChip(BEAT_FOCUS)}
      </div>

      {/* ONE solo button, following the focus — Sound edits exactly one
          layer at a time, so five buttons here would be four controls for
          layers this view is not editing. It sits beside the Focus chips
          rather than in the view header because "it follows the focus" is
          only legible next to the focus. Session-only, and cleared by LEAVING the loop layer, by a change
          of active loop, or by a project swap — NOT by a focus change,
          which is what makes a set spanning two tracks buildable from this
          row at all. store/soloNav.ts owns that rule and says why. */}
      <SoloButton
        id="btn-solo-target"
        track={soloTrackForFocus(focusTrack)}
        size="sm"
      />

      {/* Per-target oscilloscope, the way a hardware synth puts a scope
          beside the section you are editing. It taps the TARGET layer's
          own pre-fader tap — after the VCA, before that layer's bus gain
          and the sends — so it shows the patch being edited rather than
          the finished mix the transport bar's master meter reads, and a
          fader move does not resize a wave that has not changed.

          The trace is raw -1..+1 mapped straight onto the box height: no
          normalisation, no AGC, no dB curve. A quiet patch draws a small
          wave and a patch at full scale fills the box, which is only true
          because the tap is ahead of the -6 dB bus default.

          The label is not decoration: the global input deck's keyboard now
          plays whichever layer is focused (useInputDeck.ts,
          synthTargetForFocus), the same layer this scope taps, so the trace
          moves while keys are pressed regardless of which target is
          focused. Naming the tapped layer keeps that legible instead of
          reading as a scope tied to nothing in particular. A drum focus
          taps no melodic bus, so the scope is absent rather than flat. */}
      {synthTarget !== null && (
        <div
          className="ml-auto hidden sm:flex items-center gap-2 bg-base-200 border border-base-300 rounded-box px-2 py-1 shrink-0 self-stretch"
          title={`Oscilloscope — ${SYNTH_TARGET_STYLES[synthTarget].label} layer`}
        >
          <span className="text-[10px] uppercase tracking-wider font-semibold text-base-content/50">
            {SYNTH_TARGET_STYLES[synthTarget].label}
          </span>
          <AudioVisualizer
            mode="oscilloscope"
            variant="inline"
            source={synthTarget}
            paused={activeTab !== 'sound'}
            /* auto + self-stretch, not a pixel height: the box is
               self-stretch to the Target group's height, so the scope
               fills whatever is left inside its padding rather than
               tracking that height with a second number to keep in sync. */
            height="auto"
            className="w-28 lg:w-40 rounded self-stretch"
            colorTheme={synthTarget === "chord" ? "accent" : "primary"}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The Synth band's three actions: Save (raises the quick-save popover), Sounds
 * (opens the library) and the paste button, which follows the FOCUS rather than
 * the tab — this section shows whichever melodic patch `synthTarget` names, so
 * its paste button has to name THAT track's sound group. `SYNTH_SOUND_GROUP`
 * carries the mapping and its docblock says why a two-way test is wrong here;
 * `synthTarget` is non-null everywhere inside this card, so the lookup is
 * total. The pattern groups are not offered from this band — the melody grids
 * and the Pattern segments already carry them. The table itself is the tab's
 * (`SYNTH_SOUND_GROUP` in SoundView), passed in rather than declared here.
 */
function SynthSectionActions({
  synthTarget,
  soundGroups,
  presetCount,
  toast,
  onQuickSave,
  onOpenLibrary,
}: {
  synthTarget: SynthControlTarget;
  soundGroups: Record<SynthControlTarget, LoopCopyGroupId>;
  presetCount: number;
  toast: string | null;
  onQuickSave: () => void;
  onOpenLibrary: () => void;
}) {
  return (
    <>
      <button
        id="btn-quick-save-preset"
        onClick={onQuickSave}
        className="btn btn-sm btn-ghost gap-1 border border-base-300 text-xs font-semibold"
        title="Save preset"
      >
        <Bookmark className="w-3.5 h-3.5 text-primary" />
        <span className="hidden sm:inline">Save</span>
      </button>

      <button
        id="btn-open-presets-library"
        onClick={onOpenLibrary}
        className="btn btn-sm btn-primary gap-1 text-xs font-semibold"
        title="Sound Library"
      >
        <Library className="w-3.5 h-3.5" />
        {/* Names the content, not the container: the Chords view has an
            identical button in the identical place, and "Library" made
            the two read as the same drawer. It also makes the count badge
            answerable — "Library 29" never said 29 of what. */}
        <span>Sounds</span>
        <span className={COUNT_BADGE}>{presetCount}</span>
      </button>

      <ModulePasteButton groups={[soundGroups[synthTarget]]} />

      {/* Inside `actions`, so it hangs off the button cluster that
          raised it. As a child of the card it anchored to the card's own
          `relative` root, which wraps the focus row, the preset bar AND
          the whole Simple/Pro body — so `top-full` resolved at the
          bottom edge of a five-panel card, over the Drum Sound card
          below and nowhere near the Save button. */}
      {toast && (
        <div className="toast toast-top toast-end absolute top-full right-0 mt-2 z-20">
          <div className="alert alert-success text-xs py-1.5 px-3 flex items-center gap-1.5 shadow-lg">
            <Check className="w-3.5 h-3.5" />
            <span>{toast}</span>
          </div>
        </div>
      )}
    </>
  );
}

/** One of the four preset steppers, which differ only in id, label, size and
 *  direction — the icon scales with the button. */
function PresetStepButton({
  id,
  label,
  size,
  direction,
  onStep,
}: {
  id: string;
  label: string;
  size: 'xs' | 'sm';
  direction: -1 | 1;
  onStep: (direction: -1 | 1) => void;
}) {
  return (
    <IconButton
      id={id}
      label={label}
      icon={
        direction === -1 ? (
          <ChevronLeft className={size === 'xs' ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
        ) : (
          <ChevronRight className={size === 'xs' ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
        )
      }
      size={size}
      variant="outline"
      onClick={() => onStep(direction)}
    />
  );
}

/** The Pro bar's category filter tabs, with each chip's own count. */
function ProCategoryTabs({ browser }: { browser: SynthPresetBrowser }) {
  const { allPresets, selectedCategoryFilter, filterByCategory } = browser;

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none text-[11px]">
      <span className="text-[10px] uppercase font-bold text-base-content/50 px-1">
        Category:
      </span>
      {PRO_CATEGORY_TABS.map((cat) => {
        const isSelected = selectedCategoryFilter === cat.id;
        return (
          <button
            key={cat.id}
            id={`filter-category-${cat.id.toLowerCase()}`}
            onClick={() => filterByCategory(cat.id)}
            className={`btn btn-xs gap-1 font-semibold whitespace-nowrap text-xs ${
              isSelected
                ? "btn-primary"
                : "btn-ghost text-base-content/60 hover:bg-base-300"
            }`}
          >
            <span>{cat.label}</span>
            <span
              className={`badge badge-xs text-[9px] ${
                isSelected
                  ? "badge-outline [--badge-color:currentColor]"
                  : "badge-ghost text-base-content/60"
              }`}
            >
              {categoryPresetCount(allPresets, cat.id)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The Pro bar's right half: the active category tag, the two steppers and the
 * optgroup dropdown.
 *
 * The dropdown is flexible below `sm` and fixed above it. `min-w-50` (200px)
 * plus the badge and the two stepper buttons came to ~316px inside a 327px
 * phone card, so the NEXT button wrapped to a line of its own and the two
 * steppers stopped reading as a pair. Letting the dropdown take the leftover
 * width instead keeps all four on one row at every width.
 */
function ProPresetPicker({ params, browser }: { params: SynthParams; browser: SynthPresetBrowser }) {
  const {
    categoryGroups,
    selectedCategoryFilter,
    activeCategoryMeta,
    stepPreset,
    selectByName,
  } = browser;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {/* Active Category Pill Tag */}
      {activeCategoryMeta && (
        <span
          className={`badge badge-sm badge-outline text-[10px] font-semibold ${activeCategoryMeta.badgeClass}`}
          title={`Category: ${activeCategoryMeta.label} - ${activeCategoryMeta.description}`}
        >
          {activeCategoryMeta.shortLabel}
        </span>
      )}

      <PresetStepButton
        id="btn-prev-synth-preset"
        label="Previous Preset"
        size="xs"
        direction={-1}
        onStep={stepPreset}
      />

      {/* Categorized Dropdown with Optgroups */}
      <div className="flex items-center gap-1.5 bg-base-100 border border-base-300 rounded-field px-2 min-w-0 flex-1 sm:flex-none sm:min-w-50 max-w-60">
        <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
        <select
          id="select-synth-preset"
          value={params.preset}
          onChange={(e) => selectByName(e.target.value)}
          className="select select-sm select-ghost bg-transparent border-0 text-base-content text-xs focus:outline-none pr-2 font-medium min-w-0 max-w-60 truncate"
        >
          {categoryGroups
            .filter((g) => groupInCategory(g.category, selectedCategoryFilter))
            .map((group) => (
              <optgroup
                key={group.category}
                label={group.label}
                className="font-bold"
              >
                {group.presets.map((p) => (
                  <option key={p.id} value={p.name}>
                    {!p.isFactory ? `★ ${p.name}` : p.name}
                  </option>
                ))}
              </optgroup>
            ))}
        </select>
      </div>

      <PresetStepButton
        id="btn-next-synth-preset"
        label="Next Preset"
        size="xs"
        direction={1}
        onStep={stepPreset}
      />
    </div>
  );
}

/** Pro Mode: the categorized preset selection bar above the control panels. */
function ProPresetBar({
  synthTarget,
  params,
  browser,
}: {
  synthTarget: SynthControlTarget;
  params: SynthParams;
  browser: SynthPresetBrowser;
}) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2.5 bg-base-300 border border-base-300 p-2 rounded-box ${SYNTH_TARGET_STYLES[synthTarget].tint}`}>
      <ProCategoryTabs browser={browser} />
      <ProPresetPicker params={params} browser={browser} />
    </div>
  );
}

/** Simple Mode: the preset selector, the category chips and the quick filters. */
function SimplePresetBar({ params, browser }: { params: SynthParams; browser: SynthPresetBrowser }) {
  const {
    allPresets,
    activeCategoryMeta,
    selectedCategoryFilter,
    stepPreset,
    selectPreset,
    filterByCategory,
  } = browser;

  return (
    <div className="pt-3 border-t border-base-300 space-y-3">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-0">
        {/* Preset Title & Category Badge */}
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {activeCategoryMeta && (
            <span
              className={`badge badge-sm text-[10px] font-bold ${activeCategoryMeta.badgeClass}`}
            >
              {activeCategoryMeta.label}
            </span>
          )}
          <p className="text-2xl leading-6 font-extrabold text-base-content tracking-tight truncate">
            {params.preset || "Default Sound"}
          </p>
        </div>

        {/* Preset Stepper & Selector */}
        <div className="flex items-center gap-2">
          <PresetStepButton
            id="btn-simple-prev-preset"
            label="Previous Sound"
            size="sm"
            direction={-1}
            onStep={stepPreset}
          />

          <select
            id="select-simple-preset"
            value={params.preset}
            onChange={(e) => {
              const found = allPresets.find(
                (p) => p.name === e.target.value,
              );
              if (found) selectPreset(found);
            }}
            className="select select-sm text-xs font-semibold max-w-50 truncate"
          >
            {allPresets.map((p) => (
              <option key={p.id} value={p.name}>
                {p.category}: {p.name}
              </option>
            ))}
          </select>

          <PresetStepButton
            id="btn-simple-next-preset"
            label="Next Sound"
            size="sm"
            direction={1}
            onStep={stepPreset}
          />
        </div>
      </div>

      {/* Category Quick Filter Chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0 no-scrollbar">
        <span className="text-[11px] font-bold text-base-content/60 uppercase tracking-wider font-sans mr-1">
          Sound Style:
        </span>
        {SIMPLE_CATEGORY_CHIPS.map((cat) => {
          const isSelected = selectedCategoryFilter === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => filterByCategory(cat.id)}
              className={`btn btn-xs gap-1.5 text-xs font-medium whitespace-nowrap ${
                isSelected
                  ? "btn-primary font-semibold"
                  : TOOLBAR_BUTTON_IDLE
              }`}
            >
              <span>{cat.emoji}</span>
              <span>{cat.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The preset bar above the body, in whichever depth mode is showing. */
function SynthPresetBar({
  synthViewMode,
  synthTarget,
  params,
  browser,
}: {
  synthViewMode: 'simple' | 'pro';
  synthTarget: SynthControlTarget;
  params: SynthParams;
  browser: SynthPresetBrowser;
}) {
  if (synthViewMode === 'pro') {
    return <ProPresetBar synthTarget={synthTarget} params={params} browser={browser} />;
  }
  return <SimplePresetBar params={params} browser={browser} />;
}

/**
 * Simple vs Pro Mode body panels. Inside the Synth section now: they edit the
 * target the row above selects, so a card boundary between the two said they
 * were separate things.
 */
function SynthPanels({
  synthViewMode,
  params,
  onChangeParams,
  onSwitchToPro,
}: {
  synthViewMode: 'simple' | 'pro';
  params: SynthParams;
  onChangeParams: (params: SynthParams) => void;
  onSwitchToPro: () => void;
}) {
  if (synthViewMode === 'pro') {
    return (
      /* Pro Mode: Control Panels Grid */
      <div className="w-full flex flex-wrap gap-3">
        <OscillatorPanel />
        <FilterPanel />
        <EnvelopePanel />
        <LfoPanel />
        <ArpeggiatorPanel />
      </div>
    );
  }

  return (
    <>
      <SimpleSynthPanel params={params} onChangeParams={onChangeParams} />

      {/* Friendly Pro Mode Hint */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 bg-base-100/70 border border-base-300 px-4 py-2.5 rounded-box text-xs text-base-content">
        <div className="flex items-center gap-2 text-base-content/60">
          <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
          <span>
            Want deep modular control over 5 oscillators, ADSR envelopes,
            filters & LFO modulation?
          </span>
        </div>
        <button
          id="btn-switch-pro-hint"
          onClick={onSwitchToPro}
          className="btn btn-xs btn-link text-accent font-bold whitespace-nowrap no-underline"
        >
          Switch to Pro Mode →
        </button>
      </div>
    </>
  );
}

/**
 * Quick Save Modal Popover with Category selection. Outside the Synth section,
 * not in it: it is an overlay the section raises, and nesting it would put a
 * popover inside the tinted card it floats over. Gated on a melodic focus along
 * with the section that raises it — a drum focus has no synth patch for it to
 * save.
 */
function SynthQuickSaveOverlay({ overlays }: { overlays: SynthOverlays }) {
  return (
    <QuickSavePopover
      open={overlays.isQuickSaving}
      onClose={overlays.closeQuickSave}
      heading="Save Custom Preset to LocalStorage:"
      placeholder="Preset Name..."
      saveLabel="Save Patch"
      name={overlays.quickSaveName}
      onNameChange={overlays.setQuickSaveName}
      categories={SYNTH_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))}
      category={overlays.quickSaveCategory}
      onCategoryChange={(v) => overlays.setQuickSaveCategory(v as SynthPresetCategory)}
      onSubmit={overlays.handleQuickSaveSubmit}
      formClassName="flex items-center gap-2 flex-1 max-w-xl flex-wrap sm:flex-nowrap"
    />
  );
}

/**
 * Preset Library Sidebar Drawer / Modal. Gated with the Synth section: the
 * library edits whichever synth patch `target` names, and a drum focus names
 * none.
 */
function SynthPresetDrawer({
  overlays,
  params,
  synthTarget,
  showSoundBadges,
  onSelectPreset,
}: {
  overlays: SynthOverlays;
  params: SynthParams;
  synthTarget: SynthControlTarget;
  showSoundBadges: boolean;
  onSelectPreset: (preset: SynthPresetItem) => void;
}) {
  return (
    <Suspense
      fallback={
        overlays.isLibraryOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/60">
            <span className="loading loading-spinner loading-lg text-primary" />
          </div>
        ) : null
      }
    >
      <SynthPresetLibrary
        isOpen={overlays.isLibraryOpen}
        onClose={overlays.closeLibrary}
        currentParams={params}
        target={synthTarget}
        showSoundBadges={showSoundBadges}
        onSelectPreset={(preset) => {
          onSelectPreset(preset);
          overlays.closeLibrary();
        }}
      />
    </Suspense>
  );
}


/**
 * The Synth card: the band's three actions, the preset bar, and the control
 * panels that shape whichever patch the focus points at.
 */
function SynthCard({
  focusTrack,
  synthViewMode,
  params,
  onChangeParams,
  browser,
  overlays,
  soundGroups,
  onSwitchToPro,
}: {
  focusTrack: MixLayerId;
  synthViewMode: 'simple' | 'pro';
  params: SynthParams;
  onChangeParams: (params: SynthParams) => void;
  browser: SynthPresetBrowser;
  overlays: SynthOverlays;
  soundGroups: Record<SynthControlTarget, LoopCopyGroupId>;
  onSwitchToPro: () => void;
}) {
  // Null when the focus is `drum`: `controlTargetForFocus` refuses that focus
  // by type, and the Synth section, its quick-save popover and the preset
  // library are all gated on this being non-null. The Lead channel is what the
  // preset handlers close over so they stay total, and every control that could
  // invoke one of them lives inside the un-rendered section.
  const synthTarget = synthTargetForFocus(focusTrack);
  if (synthTarget === null) return null;

  const tintClass = [SYNTH_TARGET_STYLES[synthTarget].ring, SYNTH_TARGET_STYLES[synthTarget].tint]
    .filter(Boolean)
    .join(" ");

  return (
    /* The Synth section: the target it points at, the preset on it, and the
       controls that shape it, in ONE card. They were three stacked siblings — a
       tinted target/preset card, then a bare row of five module cards, then the
       drum card — which read as "the tab" rather than as one of the tab's three
       sections, and left the Drum and Mixer cards below looking like leftovers
       rather than peers. */
    <SectionCard
      icon={AudioWaveform}
      title="Synth"
      tint={tintClass}
      /* Save and Sounds ride the SYNTH band, not the tab header: both act on
         the synth patch and nothing else on this tab, and a synth-only
         control sitting in the tab's own header is part of what made the tab
         read as "the synth, plus two leftovers". */
      actions={
        <SynthSectionActions
          synthTarget={synthTarget}
          soundGroups={soundGroups}
          presetCount={browser.allPresets.length}
          toast={browser.saveToast}
          onQuickSave={() =>
            overlays.openQuickSave(params.preset, browser.activePresetItem?.category)
          }
          onOpenLibrary={overlays.openLibrary}
        />
      }
    >
      <SynthPresetBar
        synthViewMode={synthViewMode}
        synthTarget={synthTarget}
        params={params}
        browser={browser}
      />
      <SynthPanels
        synthViewMode={synthViewMode}
        params={params}
        onChangeParams={onChangeParams}
        onSwitchToPro={onSwitchToPro}
      />
    </SectionCard>
  );
}

/**
 * The Synth half of the Sound tab: the depth switch, the focus row, the Synth
 * card and the two overlays it raises. It reads the five synth channels from
 * the store itself rather than taking them as props, so SoundView stays the
 * tab's shell — the header, this section, the Drum Sound card and the mixer.
 */
export function SoundSynthSection({
  focusTrack,
  activeTab,
  onFocus,
  soundGroups,
}: {
  focusTrack: MixLayerId;
  activeTab: string;
  onFocus: (focus: MixLayerId) => void;
  /** SYNTH_SOUND_GROUP, owned by SoundView — see its docblock for why the
   *  paste button follows the FOCUS rather than the tab. */
  soundGroups: Record<SynthControlTarget, LoopCopyGroupId>;
}) {
  const synthParams = useAppStore((s) => s.synthParams);
  const chordSynthParams = useAppStore((s) => s.chordSynthParams);
  const bassSynthParams = useAppStore((s) => s.bassSynthParams);
  const onChangeSynthParams = useAppStore((s) => s.setSynthParams);
  const onChangeChordSynthParams = useAppStore((s) => s.setChordSynthParams);
  const onChangeBassSynthParams = useAppStore((s) => s.setBassSynthParams);
  const padSynthParams = useAppStore((s) => s.padSynthParams);
  const setPadSynthParams = useAppStore((s) => s.setPadSynthParams);
  const fxSynthParams = useAppStore((s) => s.fxSynthParams);
  const setFxSynthParams = useAppStore((s) => s.setFxSynthParams);

  // Route the control panel (knobs, preset selects) to the selected
  // destination.
  const channels = {
    synth: { params: synthParams, setParams: onChangeSynthParams },
    chord: { params: chordSynthParams, setParams: onChangeChordSynthParams },
    bass: { params: bassSynthParams, setParams: onChangeBassSynthParams },
    pad: { params: padSynthParams, setParams: setPadSynthParams },
    fx: { params: fxSynthParams, setParams: setFxSynthParams },
  };
  const channel = synthChannelForFocus(focusTrack, channels);
  const params = channel.params;
  const onChangeParams = channel.onChangeParams;
  const synthTarget = synthTargetForFocus(focusTrack);

  const { synthViewMode, handleToggleSynthViewMode } = useSynthViewMode();
  const browser = useSynthPresetBrowser(params, onChangeParams);
  const overlays = useSynthOverlays({
    focusTrack,
    params,
    reloadPresets: browser.reloadPresets,
    onSaved: browser.notifySaved,
  });

  return (
    <>
      {/* Names the tab and holds what belongs to the TAB. The preset Save and
          the Sounds library used to sit here too; both act on the synth patch
          and nothing else on this screen, so they moved onto the Synth
          section's own band below. */}
      <ViewHeader
        view="sound"
        viewControls={
          /* Mode Switcher: Simple vs Pro. It chooses how deep the SAME patch
             is shown, so it belongs beside the title with Pattern's segment
             row — same slot, same `HEADER_GROUP` shell, same height — and not
             in `actions`, which is for what you do TO what is on screen. */
          <SegmentedGroup>
            {SYNTH_VIEW_MODES.map(({ mode, label, icon }) => (
              <SegmentedButton
                key={mode}
                id={`btn-mode-${mode}`}
                icon={icon}
                label={label}
                active={synthViewMode === mode}
                onSelect={() => handleToggleSynthViewMode(mode)}
                title={`${label} Mode`}
              />
            ))}
          </SegmentedGroup>
        }
      />

      <SoundFocusRow
        focusTrack={focusTrack}
        synthTarget={synthTarget}
        activeTab={activeTab}
        onFocus={onFocus}
      />

      <SynthCard
        focusTrack={focusTrack}
        synthViewMode={synthViewMode}
        params={params}
        onChangeParams={onChangeParams}
        browser={browser}
        overlays={overlays}
        soundGroups={soundGroups}
        onSwitchToPro={() => handleToggleSynthViewMode("pro")}
      />

      {synthTarget !== null && <SynthQuickSaveOverlay overlays={overlays} />}

      {synthTarget !== null && (
        <SynthPresetDrawer
          overlays={overlays}
          params={params}
          synthTarget={synthTarget}
          showSoundBadges={synthViewMode === "pro"}
          onSelectPreset={browser.selectPreset}
        />
      )}
    </>
  );
}
