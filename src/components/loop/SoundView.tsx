import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  Suspense,
} from "react";
import {
  Sliders,
  Zap,
  Sparkles,
  Bookmark,
  Library,
  Check,
  ChevronLeft,
  ChevronRight,
  Disc3,
} from "lucide-react";
import { useAppStore } from "@/store/store";
import type { SynthPresetItem, SynthPresetCategory } from "@/data/synthPresets";
import { SYNTH_CATEGORIES } from "@/data/synthPresets";
import { DRUM_KITS } from "@/data/drumKits";
import {
  applyPreset,
  findPresetByName,
  getAllSynthPresets,
  getPresetsGroupedByCategory,
  getCategoryMeta,
} from "@/audio/presetRegistry";
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
import { SoundMixer } from "./SoundMixer";
import { Knob } from "../ui/Knob";
import { QuickSavePopover } from "../ui/QuickSavePopover";
import { ViewHeader } from "../ui/ViewHeader";
import { PanelCard } from "../ui/PanelCard";
import { IconButton } from "../ui/IconButton";
import { Field } from "../ui/Field";
import {
  COUNT_BADGE,
  JOIN_LANE,
  FIELD_SELECT,
  SECTION_HEADER,
} from "../ui/fieldClasses";

// Re-exported for scripts/check-key-bindings.ts, which asserts that the synth
// key bindings never collide with the drum-pad shortcuts. The table itself
// lives in ui/Keyboard.tsx; this is the historical import path.
export { KEYBOARD_NOTES } from "../ui/Keyboard";
import {
  resolveSynthControlChannel,
  SYNTH_TARGET_STYLES,
} from "@/utils/synthControl";
import type { SynthControlTarget } from "@/utils/synthControl";
import { GroupFrame } from "../ui/GroupFrame";

// The kit roster never changes at runtime, so it is read once here rather than
// re-keyed on every render — a Knob drag re-renders this view per pointermove.
// Module-scope resolution is fine in `components/`; it is `src/data/` that may
// not (CLAUDE.md, layer 1).
const DRUM_KIT_NAMES = Object.keys(DRUM_KITS);

export const SoundView = React.memo(function SoundView() {
  // Synth slice state + setters (named after the old props so the rest of the
  // component body is unchanged).
  const controlTarget = useAppStore((s) => s.controlTarget);
  // App keeps every view mounted (block/hidden) so audio survives a tab
  // switch, which means the scope's rAF loop must be gated on this or it
  // runs forever behind a hidden tab.
  const activeTab = useAppStore((s) => s.activeTab);
  const synthParams = useAppStore((s) => s.synthParams);
  const chordSynthParams = useAppStore((s) => s.chordSynthParams);
  const bassSynthParams = useAppStore((s) => s.bassSynthParams);
  const onChangeControlTarget = useAppStore((s) => s.setControlTarget);
  const onChangeSynthParams = useAppStore((s) => s.setSynthParams);
  const onChangeChordSynthParams = useAppStore((s) => s.setChordSynthParams);
  const onChangeBassSynthParams = useAppStore((s) => s.setBassSynthParams);
  const padSynthParams = useAppStore((s) => s.padSynthParams);
  const setPadSynthParams = useAppStore((s) => s.setPadSynthParams);
  const soundKit = useAppStore((s) => s.soundKit);
  const onChangeSoundKit = useAppStore((s) => s.setSoundKit);
  const drumFilterCutoff = useAppStore((s) => s.drumFilterCutoff);
  const drumFilterResonance = useAppStore((s) => s.drumFilterResonance);
  const drumFilterType = useAppStore((s) => s.drumFilterType);
  const setDrumFilterCutoff = useAppStore((s) => s.setDrumFilterCutoff);
  const setDrumFilterResonance = useAppStore((s) => s.setDrumFilterResonance);
  const setDrumFilterType = useAppStore((s) => s.setDrumFilterType);

  // Route the control panel (knobs, preset selects) to the selected
  // destination.
  const channels = {
    synth: { params: synthParams, setParams: onChangeSynthParams },
    chord: { params: chordSynthParams, setParams: onChangeChordSynthParams },
    bass: { params: bassSynthParams, setParams: onChangeBassSynthParams },
    pad: { params: padSynthParams, setParams: setPadSynthParams },
  };
  const channel = resolveSynthControlChannel(controlTarget, channels);
  const params = channel.params;
  const onChangeParams = channel.setParams;

  const tintClass = [
    SYNTH_TARGET_STYLES[controlTarget].ring,
    SYNTH_TARGET_STYLES[controlTarget].tint,
  ]
    .filter(Boolean)
    .join(" ");
  const [isLibraryOpen, setIsLibraryOpen] = useState<boolean>(false);
  const [customPresets, setCustomPresets] = useState<SynthPresetItem[]>([]);
  const allPresets = useMemo(
    () => getAllSynthPresets(customPresets),
    [customPresets],
  );
  const [selectedCategoryFilter, setSelectedCategoryFilter] =
    useState<string>("All");
  const [quickSaveCategory, setQuickSaveCategory] =
    useState<SynthPresetCategory>("User");
  const [isQuickSaving, setIsQuickSaving] = useState<boolean>(false);
  const [quickSaveName, setQuickSaveName] = useState<string>("");
  const [saveToast, setSaveToast] = useState<string | null>(null);

  // Simple vs Pro UI Mode toggle with localStorage persistence
  const [synthViewMode, setSynthViewMode] = useState<"simple" | "pro">(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      const stored = localStorage.getItem("musibox_synth_view_mode") || localStorage.getItem("murva_synth_view_mode");
      if (stored === "simple" || stored === "pro") return stored;
    }
    return "simple";
  });

  const handleToggleSynthViewMode = (mode: "simple" | "pro") => {
    setSynthViewMode(mode);
    try {
      localStorage.setItem("musibox_synth_view_mode", mode);
    } catch {
      // best-effort: ignore localStorage failures (e.g. private mode)
    }
  };

  // Sync custom presets from local storage
  const reloadPresets = useCallback(() => {
    setCustomPresets(useAppStore.getState().customSynthPresets);
  }, []);

  useEffect(() => {
    reloadPresets();
  }, [reloadPresets, isLibraryOpen]);

  const categoryGroups = useMemo(
    () => getPresetsGroupedByCategory(allPresets),
    [allPresets],
  );

  const activePresetItem = useMemo(
    () => findPresetByName(params.preset, allPresets),
    [params.preset, allPresets],
  );

  const activeCategoryMeta = useMemo(() => {
    if (!activePresetItem) return null;
    return getCategoryMeta(activePresetItem.category);
  }, [activePresetItem]);

  // Presets list based on selectedCategoryFilter for step navigation
  const selectablePresets = useMemo(() => {
    if (selectedCategoryFilter === "All") return allPresets;
    if (selectedCategoryFilter === "User")
      return allPresets.filter((p) => !p.isFactory || p.category === "User");
    return allPresets.filter((p) => p.category === selectedCategoryFilter);
  }, [selectedCategoryFilter, allPresets]);

  const handleCategoryFilterClick = (catId: string) => {
    setSelectedCategoryFilter(catId);
    if (catId === "All") return;
    const matching =
      catId === "User"
        ? allPresets.filter((p) => !p.isFactory || p.category === "User")
        : allPresets.filter((p) => p.category === catId);
    if (matching.length > 0) {
      const currentInCat = matching.some((p) => p.name === params.preset);
      if (!currentInCat) {
        handleSelectPreset(matching[0]);
      }
    }
  };

  const handleStepPreset = (direction: -1 | 1) => {
    if (selectablePresets.length === 0) return;
    const currentIndex = selectablePresets.findIndex(
      (p) => p.name === params.preset,
    );
    let nextIndex = currentIndex + direction;
    if (nextIndex < 0) nextIndex = selectablePresets.length - 1;
    if (nextIndex >= selectablePresets.length) nextIndex = 0;
    handleSelectPreset(selectablePresets[nextIndex]);
  };

  const handleSelectPreset = (preset: SynthPresetItem) => {
    onChangeParams(applyPreset(params, preset));
    setSaveToast(`Loaded [${preset.category}] "${preset.name}"`);
    setTimeout(() => setSaveToast(null), 2500);
  };

  const handleDropdownChange = (name: string) => {
    const preset = findPresetByName(name, allPresets);
    if (preset) handleSelectPreset(preset);
  };

  const handleQuickSaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickSaveName.trim()) return;

    const saved = useAppStore.getState().saveCustomPreset(quickSaveName, params, quickSaveCategory);
    reloadPresets();
    setIsQuickSaving(false);
    setQuickSaveName("");
    handleSelectPreset(saved);
    setSaveToast(`Preset "${saved.name}" saved to ${saved.category}!`);
    setTimeout(() => setSaveToast(null), 3000);
  };

  const totalPresetsCount = allPresets.length;

  // Explicit rather than Object.keys(SYNTH_TARGET_STYLES): the row below
  // needs synth separated from chord/bass/pad to frame the latter three, so
  // it no longer derives the target list from the record. synthControl.ts
  // pins the keys to synth/chord/bass/pad in this order; a fifth target
  // added there would silently not render here.
  const renderTargetChip = (target: SynthControlTarget) => (
    <button
      key={target}
      onClick={() => onChangeControlTarget(target)}
      className={`btn btn-xs text-[11px] font-semibold ${
        controlTarget === target
          ? SYNTH_TARGET_STYLES[target].activeBtn
          : "btn-ghost text-base-content/60"
      }`}
    >
      {SYNTH_TARGET_STYLES[target].label}
    </button>
  );

  return (
    <div className="p-3 sm:p-4 max-w-7xl mx-auto space-y-3 sm:space-y-4">
      {/* Synth Lab Header: Mode Switcher + Save Current & Full Presets Library */}
      <ViewHeader
        view="sound"
        actions={
          <>
            {/* Mode Switcher: Simple vs Pro */}
            <div className={JOIN_LANE}>
              <button
                id="btn-mode-simple"
                onClick={() => handleToggleSynthViewMode("simple")}
                className={`btn btn-xs join-item gap-1 text-xs font-semibold ${
                  synthViewMode === "simple"
                    ? "btn-primary"
                    : "btn-ghost text-base-content/60"
                }`}
                title="Simple Mode"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Simple</span>
              </button>
              <button
                id="btn-mode-pro"
                onClick={() => handleToggleSynthViewMode("pro")}
                className={`btn btn-xs join-item gap-1 text-xs font-semibold ${
                  synthViewMode === "pro"
                    ? "btn-primary"
                    : "btn-ghost text-base-content/60"
                }`}
                title="Pro Mode"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Pro</span>
              </button>
            </div>

            <button
              id="btn-quick-save-preset"
              onClick={() => {
                setQuickSaveName(
                  params.preset
                    ? `${params.preset} (Custom)`
                    : "My Synth Patch",
                );
                setQuickSaveCategory(activePresetItem?.category ?? "User");
                setIsQuickSaving(true);
              }}
              className="btn btn-sm btn-ghost gap-1 border border-base-300 text-xs font-semibold"
              title="Save preset"
            >
              <Bookmark className="w-3.5 h-3.5 text-primary" />
              <span className="hidden sm:inline">Save</span>
            </button>

            <button
              id="btn-open-presets-library"
              onClick={() => setIsLibraryOpen(true)}
              className="btn btn-sm btn-primary gap-1 text-xs font-semibold"
              title="Sound Library"
            >
              <Library className="w-3.5 h-3.5" />
              {/* Names the content, not the container: the Chords view has an
                  identical button in the identical place, and "Library" made
                  the two read as the same drawer. It also makes the count badge
                  answerable — "Library 29" never said 29 of what. */}
              <span>Sounds</span>
              <span className={COUNT_BADGE}>
                {totalPresetsCount}
              </span>
            </button>
          </>
        }
      >
        {saveToast && (
          <div className="toast toast-top toast-end absolute top-full right-4 mt-2 z-20">
            <div className="alert alert-success text-xs py-1.5 px-3 flex items-center gap-1.5 shadow-lg">
              <Check className="w-3.5 h-3.5" />
              <span>{saveToast}</span>
            </div>
          </div>
        )}
      </ViewHeader>

      {/* Synth Target & Preset Selection Card */}
      <PanelCard tint={tintClass}>
        <div className="card-body p-3 sm:p-4 flex flex-col gap-3">
        {/* Row 1: Control Destination / Target Selector. Kept as its own row,
            visible in both Simple and Pro mode, because it's the only control
            that switches which channel (synth/chord/bass) params/onChangeParams
            below points at — Pro mode's oscillator/filter/envelope sections
            read that same params object, so folding this into the Simple-only
            preset bar would silently strand Pro mode on whatever target was
            last picked. */}
        {/* Row 1: Control Destination / Target Selector */}
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          {/* Control Destination Selector */}
          <div
            className={`flex items-center gap-1 bg-base-200 border rounded-box p-1 shrink-0 ${SYNTH_TARGET_STYLES[controlTarget].border}`}
          >
            <span className="text-[10px] uppercase tracking-wider text-base-content/50 font-semibold pl-1 pr-1 hidden sm:inline">
              Target:
            </span>
            {renderTargetChip('synth')}
            {/* Chord, bass and pad are one job done three ways. The frame is
                inside the tinted outer group, not replacing it: the outer
                tint tracks the ACTIVE target, this one groups three of the
                four. See ui/GroupFrame for why it adds no colour.
                daisyUI's join requires its direct children to be the joined
                items, and a GroupFrame between the outer div and three of
                the four chips breaks that contract, so join/join-item are
                dropped from this whole row; gap-1 (already on the row and
                the frame) carries the spacing join used to. */}
            <GroupFrame label="Accompaniment" className="flex items-center gap-1">
              {(['chord', 'bass', 'pad'] as SynthControlTarget[]).map(renderTargetChip)}
            </GroupFrame>
          </div>


          {/* Per-target oscilloscope, the way a hardware synth puts a scope
              beside the section you are editing. It taps the TARGET layer's
              own bus — after the VCA, before the sends — so it shows the patch
              being edited rather than the finished mix the transport bar's
              master meter reads.

              The label is not decoration: the global input deck's keyboard
              always plays the 'synth' layer regardless of Target, so with
              Target on Chord or Bass the trace stays flat while keys are
              pressed. Naming the tapped layer is what keeps that legible
              instead of reading as a broken scope. */}
          <div
            className="ml-auto hidden sm:flex items-center gap-2 bg-base-200 border border-base-300 rounded-box px-2 h-8 shrink-0 self-end mb-0.5"
            title={`Oscilloscope — ${SYNTH_TARGET_STYLES[controlTarget].label} layer`}
          >
            <span className="text-[10px] uppercase tracking-wider font-semibold text-base-content/50">
              {SYNTH_TARGET_STYLES[controlTarget].label}
            </span>
            <AudioVisualizer
              mode="oscilloscope"
              variant="inline"
              source={controlTarget}
              paused={activeTab !== 'sound'}
              height={22}
              className="w-28 lg:w-40 rounded"
              colorTheme={controlTarget === "chord" ? "accent" : "primary"}
            />
          </div>
        </div>

        {/* Pro Mode: Row 2 Categorized Preset Selection Bar */}
        {synthViewMode === "pro" && (
          <div className={`flex flex-wrap items-center justify-between gap-2.5 bg-base-300 border border-base-300 p-2 rounded-box ${SYNTH_TARGET_STYLES[controlTarget].tint}`}>
            {/* Category Filter Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none text-[11px]">
              <span className="text-[10px] uppercase font-bold text-base-content/50 px-1">
                Category:
              </span>
              {[
                { id: "All", label: "All" },
                { id: "Bass", label: "Bass" },
                { id: "Lead", label: "Lead" },
                { id: "Pad", label: "Pad" },
                { id: "Keys", label: "Keys" },
                { id: "Pluck", label: "Pluck" },
                { id: "Brass", label: "Brass" },
                { id: "FX", label: "FX" },
                { id: "User", label: "Custom" },
              ].map((cat) => {
                const isSelected = selectedCategoryFilter === cat.id;
                const count =
                  cat.id === "All"
                    ? allPresets.length
                    : cat.id === "User"
                      ? allPresets.filter(
                          (p) => !p.isFactory || p.category === "User",
                        ).length
                      : allPresets.filter((p) => p.category === cat.id).length;

                return (
                  <button
                    key={cat.id}
                    id={`filter-category-${cat.id.toLowerCase()}`}
                    onClick={() => handleCategoryFilterClick(cat.id)}
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
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Categorized Dropdown + Step Navigation + Active Category Tag */}
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

              {/* Step Previous Preset Button */}
              <IconButton
                id="btn-prev-synth-preset"
                label="Previous Preset"
                icon={<ChevronLeft className="w-3.5 h-3.5" />}
                size="xs"
                variant="outline"
                onClick={() => handleStepPreset(-1)}
              />

              {/* Categorized Dropdown with Optgroups */}
              <div className="flex items-center gap-1.5 bg-base-100 border border-base-300 rounded-field px-2 min-w-50 max-w-60">
                <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
                <select
                  id="select-synth-preset"
                  value={params.preset}
                  onChange={(e) => handleDropdownChange(e.target.value)}
                  className="select select-sm select-ghost bg-transparent border-0 text-base-content text-xs focus:outline-none pr-2 font-medium max-w-60 truncate"
                >
                  {categoryGroups
                    .filter((g) =>
                      selectedCategoryFilter === "All"
                        ? true
                        : selectedCategoryFilter === "User"
                          ? g.category === "User"
                          : g.category === selectedCategoryFilter,
                    )
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

              {/* Step Next Preset Button */}
              <IconButton
                id="btn-next-synth-preset"
                label="Next Preset"
                icon={<ChevronRight className="w-3.5 h-3.5" />}
                size="xs"
                variant="outline"
                onClick={() => handleStepPreset(1)}
              />
            </div>
          </div>
        )}

        {/* Simple Mode: Preset Selector & Category Chips merged into the header card */}
        {synthViewMode === "simple" && (
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
                <IconButton
                  id="btn-simple-prev-preset"
                  label="Previous Sound"
                  icon={<ChevronLeft className="w-4 h-4" />}
                  size="sm"
                  variant="outline"
                  onClick={() => handleStepPreset(-1)}
                />

                <select
                  id="select-simple-preset"
                  value={params.preset}
                  onChange={(e) => {
                    const found = allPresets.find(
                      (p) => p.name === e.target.value,
                    );
                    if (found) handleSelectPreset(found);
                  }}
                  className="select select-sm text-xs font-semibold max-w-50 truncate"
                >
                  {allPresets.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.category}: {p.name}
                    </option>
                  ))}
                </select>

                <IconButton
                  id="btn-simple-next-preset"
                  label="Next Sound"
                  icon={<ChevronRight className="w-4 h-4" />}
                  size="sm"
                  variant="outline"
                  onClick={() => handleStepPreset(1)}
                />
              </div>
            </div>

            {/* Category Quick Filter Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0 no-scrollbar">
              <span className="text-[11px] font-bold text-base-content/60 uppercase tracking-wider font-sans mr-1">
                Sound Style:
              </span>
              {[
                { id: "All", label: "All Sounds", emoji: "✨" },
                { id: "Lead", label: "Lead Melody", emoji: "⚡" },
                { id: "Pad", label: "Ambient Pad", emoji: "🌌" },
                { id: "Keys", label: "Keys & Piano", emoji: "🎹" },
                { id: "Bass", label: "Deep Bass", emoji: "🔥" },
                { id: "Pluck", label: "Snappy Pluck", emoji: "🪕" },
                { id: "Brass", label: "Brass Stabs", emoji: "🎷" },
                { id: "FX", label: "Sci-Fi FX", emoji: "🛸" },
              ].map((cat) => {
                const isSelected = selectedCategoryFilter === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => handleCategoryFilterClick(cat.id)}
                    className={`btn btn-xs gap-1.5 text-xs font-medium whitespace-nowrap ${
                      isSelected
                        ? "btn-primary font-semibold"
                        : "btn-ghost border border-base-300 text-base-content/60"
                    }`}
                  >
                    <span>{cat.emoji}</span>
                    <span>{cat.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        </div>
      </PanelCard>

      {/* Quick Save Modal Popover with Category selection */}
      <QuickSavePopover
        open={isQuickSaving}
        onClose={() => setIsQuickSaving(false)}
        heading="Save Custom Preset to LocalStorage:"
        placeholder="Preset Name..."
        saveLabel="Save Patch"
        name={quickSaveName}
        onNameChange={setQuickSaveName}
        categories={SYNTH_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))}
        category={quickSaveCategory}
        onCategoryChange={(v) => setQuickSaveCategory(v as SynthPresetCategory)}
        onSubmit={handleQuickSaveSubmit}
        formClassName="flex items-center gap-2 flex-1 max-w-xl flex-wrap sm:flex-nowrap"
      />

      {/* Simple Mode vs Pro Mode Body Panels */}
      {synthViewMode === "simple" ? (
        <>
          <SimpleSynthPanel
            params={params}
            onChangeParams={onChangeParams}
            tintClass={tintClass}
          />

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
              onClick={() => handleToggleSynthViewMode("pro")}
              className="btn btn-xs btn-link text-accent font-bold whitespace-nowrap no-underline"
            >
              Switch to Pro Mode →
            </button>
          </div>
        </>
      ) : (
        /* Pro Mode: Control Panels Grid */
        <div className="w-full flex flex-wrap gap-3">
          <OscillatorPanel />
          <FilterPanel />
          <EnvelopePanel />
          <LfoPanel />
          <ArpeggiatorPanel />
        </div>
      )}

      {/* Drum Sound — kit and filter. Moved here from the sequencer: all of it
          changes how the kit SOUNDS and none of it changes a note, which is the
          Sound/Pattern boundary rule. The grid that picks these notes lives on
          Pattern › Beat. The bus level left this card for the Mixer below, so
          that the drum bus is balanced against the other four and not alone. */}
      <PanelCard>
        <div className="card-body p-3 sm:p-4">
        <div className="flex items-center justify-between flex-wrap gap-2.5">
          <div className="flex items-center gap-2">
            <Disc3 className="w-3.5 h-3.5 text-secondary" />
            <span className={SECTION_HEADER}>
              Drum Sound
            </span>
          </div>

          {/* items-start + a shared lane per field: bottom-aligning controls of
              three different heights (32px select, 24px join, 48px knob) put
              these labels on different baselines. */}
          <div className="flex items-start gap-5 flex-wrap">
            <Field label="Kit" htmlFor="select-sequencer-sound-kit">
              <select
                id="select-sequencer-sound-kit"
                value={soundKit}
                onChange={(e) => onChangeSoundKit(e.target.value)}
                className={FIELD_SELECT}
                title="Drum kit — the sounds each track plays"
              >
                {DRUM_KIT_NAMES.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Filter">
              <div className="join">
                {(["lowpass", "bandpass", "highpass"] as const).map((t) => (
                  <button
                    key={t}
                    id={`btn-drum-filter-${t}`}
                    onClick={() => setDrumFilterType(t)}
                    className={`btn btn-sm join-item text-[10px] font-semibold uppercase ${
                      drumFilterType === t ? "btn-secondary" : "btn-ghost"
                    }`}
                  >
                    {t === "lowpass" ? "LPF" : t === "bandpass" ? "BPF" : "HPF"}
                  </button>
                ))}
              </div>
            </Field>

            {/* `size="sm"` (36px), not the app-wide default 48px: every other
                knob is the main content of its own card, these two are one
                field in a row. No `label` — the stacked one above says it, so
                the knob renders its value readout alone. */}
            <Field label="Cutoff">
              <Knob
                id="knob-drum-filter-cutoff"
                size="sm"
                color="text-secondary"
                layout="horizontal"
                value={drumFilterCutoff}
                min={50}
                max={12000}
                step={10}
                scale="log"
                format={(v) => `${Math.round(v)} Hz`}
                onChange={setDrumFilterCutoff}
              />
            </Field>

            <Field label="Res">
              <Knob
                id="knob-drum-filter-resonance"
                size="sm"
                color="text-secondary"
                layout="horizontal"
                value={drumFilterResonance}
                min={0.1}
                max={20}
                step={0.1}
                scale="linear"
                format={(v) => v.toFixed(1)}
                onChange={setDrumFilterResonance}
              />
            </Field>
          </div>
        </div>
        </div>
      </PanelCard>

      {/* The one mixer: every layer's level and mute, including the drum bus
          whose level used to be a lone strip in the card above. */}
      <SoundMixer />

      {/* Preset Library Sidebar Drawer / Modal */}
      <Suspense
        fallback={
          isLibraryOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/60">
              <span className="loading loading-spinner loading-lg text-primary" />
            </div>
          ) : null
        }
      >
        <SynthPresetLibrary
          isOpen={isLibraryOpen}
          onClose={() => setIsLibraryOpen(false)}
          currentParams={params}
          target={controlTarget}
          showSoundBadges={synthViewMode === "pro"}
          onSelectPreset={(preset) => {
            handleSelectPreset(preset);
            setIsLibraryOpen(false);
          }}
        />
      </Suspense>
    </div>
  );
});
