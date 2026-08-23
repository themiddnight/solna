import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Sliders,
  Activity,
  Zap,
  Volume2,
  Sparkles,
  Bookmark,
  Plus,
  Library,
  FolderOpen,
  Check,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { audioEngine } from "../audio/engine";
import { useAppStore } from "../store/store";
import {
  ALL_FACTORY_PRESETS,
  SynthPresetItem,
  SynthPresetCategory,
  SYNTH_CATEGORIES,
  findPresetByName,
  getAllSynthPresets,
  getCustomPresets,
  saveCustomPreset,
  getPresetsGroupedByCategory,
  getCategoryMeta,
} from "../audio/synthPresets";
import { SynthPresetLibrary } from "./SynthPresetLibrary";
import { Knob } from "./ui/Knob";
import { isNoteInScale, getScaleNotes, ROOTS } from "../utils/musicTheory";
import { isTypingTarget, shortcutLabel } from "../utils/keyboard";
import { resolveSynthControlChannel } from "../utils/synthControl";
import type { SynthControlTarget } from "../utils/synthControl";

// Shared per-destination accent styling for the card tint and selector buttons
const TARGET_STYLES: Record<SynthControlTarget, { tint: string; activeBtn: string }> = {
  synth: { tint: "", activeBtn: "bg-slate-600 text-white shadow-xs" },
  chord: {
    tint: "ring-1 ring-indigo-400/40 bg-gradient-to-br from-indigo-500/10 to-transparent",
    activeBtn: "bg-indigo-600 text-white shadow-xs",
  },
  bass: {
    tint: "ring-1 ring-emerald-400/40 bg-gradient-to-br from-emerald-500/10 to-transparent",
    activeBtn: "bg-emerald-600 text-white shadow-xs",
  },
};

export const KEYBOARD_NOTES = [
  { note: "C3", label: "C3", key: "KeyA", isBlack: false },
  { note: "C#3", label: "C#", key: "KeyW", isBlack: true },
  { note: "D3", label: "D3", key: "KeyS", isBlack: false },
  { note: "D#3", label: "D#", key: "KeyE", isBlack: true },
  { note: "E3", label: "E3", key: "KeyD", isBlack: false },
  { note: "F3", label: "F3", key: "KeyF", isBlack: false },
  { note: "F#3", label: "F#", key: "KeyT", isBlack: true },
  { note: "G3", label: "G3", key: "KeyG", isBlack: false },
  { note: "G#3", label: "G#", key: "KeyY", isBlack: true },
  { note: "A3", label: "A3", key: "KeyH", isBlack: false },
  { note: "A#3", label: "A#", key: "KeyU", isBlack: true },
  { note: "B3", label: "B3", key: "KeyJ", isBlack: false },
  { note: "C4", label: "C4", key: "KeyK", isBlack: false },
  { note: "C#4", label: "C#", key: "KeyO", isBlack: true },
  { note: "D4", label: "D4", key: "KeyL", isBlack: false },
  { note: "D#4", label: "D#", key: "KeyP", isBlack: true },
  { note: "E4", label: "E4", key: "Semicolon", isBlack: false },
  { note: "F4", label: "F4", key: "Quote", isBlack: false },
];

export const SynthView = () => {
  // Synth slice state + setters (named after the old props so the rest of the
  // component body is unchanged).
  const controlTarget = useAppStore((s) => s.controlTarget);
  const synthParams = useAppStore((s) => s.synthParams);
  const chordSynthParams = useAppStore((s) => s.chordSynthParams);
  const bassSynthParams = useAppStore((s) => s.bassSynthParams);
  const onChangeControlTarget = useAppStore((s) => s.setControlTarget);
  const onChangeSynthParams = useAppStore((s) => s.setSynthParams);
  const onChangeChordSynthParams = useAppStore((s) => s.setChordSynthParams);
  const onChangeBassSynthParams = useAppStore((s) => s.setBassSynthParams);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);

  // Route the control panel (knobs, preset selects) to the selected
  // destination; the keyboard always plays the main synth (see handleNoteOn)
  const channel = resolveSynthControlChannel(controlTarget, {
    synth: { params: synthParams, setParams: onChangeSynthParams },
    chord: { params: chordSynthParams, setParams: onChangeChordSynthParams },
    bass: { params: bassSynthParams, setParams: onChangeBassSynthParams },
  });
  const params = channel.params;
  const onChangeParams = channel.setParams;

  const tintClass = TARGET_STYLES[controlTarget].tint;
  const [activeNotes, setActiveNotes] = useState<Set<string>>(new Set());
  const [isLibraryOpen, setIsLibraryOpen] = useState<boolean>(false);
  const [customPresets, setCustomPresets] = useState<SynthPresetItem[]>([]);
  const allPresets = useMemo(() => getAllSynthPresets(customPresets), [customPresets]);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>("All");
  const [quickSaveCategory, setQuickSaveCategory] = useState<SynthPresetCategory>("User");
  const [isQuickSaving, setIsQuickSaving] = useState<boolean>(false);
  const [quickSaveName, setQuickSaveName] = useState<string>("");
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [keyboardMode, setKeyboardMode] = useState<
    "chromatic" | "scale-locked"
  >("scale-locked");
  // Keyboard display octave — independent from synth pitch octave (params.octave)
  const [keyboardOctave, setKeyboardOctave] = useState<number>(0);

  // Sync custom presets from local storage
  const reloadPresets = useCallback(() => {
    setCustomPresets(getCustomPresets());
  }, []);

  useEffect(() => {
    reloadPresets();
  }, [reloadPresets, isLibraryOpen]);

  const categoryGroups = useMemo(
    () => getPresetsGroupedByCategory(allPresets),
    [allPresets]
  );

  const activePresetItem = useMemo(
    () => findPresetByName(params.preset, allPresets),
    [params.preset, allPresets]
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
      (p) => p.name === params.preset
    );
    let nextIndex = currentIndex + direction;
    if (nextIndex < 0) nextIndex = selectablePresets.length - 1;
    if (nextIndex >= selectablePresets.length) nextIndex = 0;
    handleSelectPreset(selectablePresets[nextIndex]);
  };

  // The keyboard auditions the currently selected control target (Synth, Chord, or Bass)
  // so the sound designer can hear the immediate adjustments.
  const handleNoteOn = useCallback(
    (note: string) => {
      audioEngine.init();
      audioEngine.triggerSynthNoteOn(note, params, 1.0, undefined, controlTarget);
      setActiveNotes((prev) => new Set(prev).add(note));
    },
    [params, controlTarget],
  );

  const handleNoteOff = useCallback(
    (note: string) => {
      audioEngine.triggerSynthNoteOff(note, params.release, undefined, controlTarget);
      setActiveNotes((prev) => {
        const next = new Set(prev);
        next.delete(note);
        return next;
      });
    },
    [params.release, controlTarget],
  );

  // QWERTY Computer Keyboard mapping — uses keyboardOctave, NOT params.octave
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      if (e.repeat) return;
      const notesList =
        keyboardMode === "scale-locked"
          ? getScaleLockedKeyboardNotes(scaleRoot, scaleType, keyboardOctave)
          : getChromaticKeyboardNotes(keyboardOctave);
      const keyObj = notesList.find((n) => n.key === e.code);
      if (keyObj) {
        handleNoteOn(keyObj.note);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      const notesList =
        keyboardMode === "scale-locked"
          ? getScaleLockedKeyboardNotes(scaleRoot, scaleType, keyboardOctave)
          : getChromaticKeyboardNotes(keyboardOctave);
      const keyObj = notesList.find((n) => n.key === e.code);
      if (keyObj) {
        handleNoteOff(keyObj.note);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [
    handleNoteOn,
    handleNoteOff,
    keyboardMode,
    scaleRoot,
    scaleType,
    keyboardOctave,
  ]);

  const handleSelectPreset = (preset: SynthPresetItem) => {
    onChangeParams({
      ...params,
      ...preset.params,
      preset: preset.name,
    });
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

    const saved = saveCustomPreset(quickSaveName, params, quickSaveCategory);
    reloadPresets();
    setIsQuickSaving(false);
    setQuickSaveName("");
    handleSelectPreset(saved);
    setSaveToast(`Preset "${saved.name}" saved to ${saved.category}!`);
    setTimeout(() => setSaveToast(null), 3000);
  };

  const totalPresetsCount = allPresets.length;

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      {/* Top Synth Header & Presets */}
      <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-4 flex flex-col gap-3.5 shadow-lg relative">
        {/* Row 1: Brand & Control Target + Save & Library Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-base text-slate-100 flex items-center gap-2">
                Analog Polyphonic Synthesizer
              </h2>
            </div>
          </div>

          {/* Control Destination Selector */}
          <div className="flex items-center gap-1 bg-[#0B0D19] border border-[#2D355A] rounded-lg p-1">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold pl-1.5 pr-1">
              Control
            </span>
            {(
              [
                ["synth", "Synth"],
                ["chord", "Chord"],
                ["bass", "Bass"],
              ] as [SynthControlTarget, string][]
            ).map(([target, label]) => (
              <button
                key={target}
                onClick={() => onChangeControlTarget(target)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                  controlTarget === target
                    ? TARGET_STYLES[target].activeBtn
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Actions: Save Current & Full Presets Library */}
          <div className="flex items-center gap-2">
            <button
              id="btn-quick-save-preset"
              onClick={() => {
                setQuickSaveName(
                  params.preset ? `${params.preset} (Custom)` : "My Synth Patch",
                );
                setQuickSaveCategory(activePresetItem?.category ?? "User");
                setIsQuickSaving(true);
              }}
              className="flex items-center gap-1.5 bg-[#171B36] hover:bg-[#22284C] text-slate-200 hover:text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-[#2D355A] transition-colors shadow-xs cursor-pointer"
              title="Save current synth sound to LocalStorage"
            >
              <Bookmark className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">Save</span>
            </button>

            <button
              id="btn-open-presets-library"
              onClick={() => setIsLibraryOpen(true)}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-md transition-colors cursor-pointer"
              title="Open Presets Library (Search, audition, export/import)"
            >
              <Library className="w-3.5 h-3.5" />
              <span>Presets Library</span>
              <span className="bg-indigo-700/80 text-[10px] px-1.5 py-0.2 rounded-full font-mono">
                {totalPresetsCount}
              </span>
            </button>
          </div>
        </div>

        {/* Row 2: Categorized Preset Selection Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 bg-[#0B0D19] border border-[#252B48] p-2 rounded-xl">
          {/* Category Filter Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none text-[11px]">
            <span className="text-[10px] uppercase font-bold text-slate-500 px-1 font-mono">
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
                    ? allPresets.filter((p) => !p.isFactory || p.category === "User").length
                    : allPresets.filter((p) => p.category === cat.id).length;

              return (
                <button
                  key={cat.id}
                  id={`filter-category-${cat.id.toLowerCase()}`}
                  onClick={() => handleCategoryFilterClick(cat.id)}
                  className={`px-2 py-1 rounded-md font-semibold whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1 text-xs ${
                    isSelected
                      ? "bg-indigo-600 text-white shadow-xs"
                      : "text-slate-400 hover:text-slate-200 hover:bg-[#1C213E]/80"
                  }`}
                >
                  <span>{cat.label}</span>
                  <span
                    className={`text-[9px] px-1 rounded-full font-mono ${
                      isSelected
                        ? "bg-indigo-700 text-white"
                        : "bg-[#161B36] text-slate-400"
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
                className={`text-[10px] font-mono px-2 py-0.5 rounded border font-semibold ${activeCategoryMeta.badgeClass}`}
                title={`Category: ${activeCategoryMeta.label} - ${activeCategoryMeta.description}`}
              >
                {activeCategoryMeta.shortLabel}
              </span>
            )}

            {/* Step Previous Preset Button */}
            <button
              id="btn-prev-synth-preset"
              onClick={() => handleStepPreset(-1)}
              className="p-1.5 rounded-lg bg-[#12152A] hover:bg-[#1C213E] text-slate-300 hover:text-white border border-[#2D355A] cursor-pointer transition-colors"
              title="Previous Preset"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            {/* Categorized Dropdown with Optgroups */}
            <div className="flex items-center gap-1.5 bg-[#12152A] border border-[#2D355A] rounded-lg px-2.5 py-1">
              <Sparkles className="w-3.5 h-3.5 text-purple-400 shrink-0" />
              <select
                id="select-synth-preset"
                value={params.preset}
                onChange={(e) => handleDropdownChange(e.target.value)}
                className="bg-transparent text-slate-200 text-xs focus:outline-none cursor-pointer pr-2 font-medium max-w-[180px] sm:max-w-[240px] truncate"
              >
                {categoryGroups
                  .filter((g) =>
                    selectedCategoryFilter === "All"
                      ? true
                      : selectedCategoryFilter === "User"
                        ? g.category === "User"
                        : g.category === selectedCategoryFilter
                  )
                  .map((group) => (
                    <optgroup
                      key={group.category}
                      label={group.label}
                      className="bg-[#12152A] text-indigo-300 font-bold"
                    >
                      {group.presets.map((p) => (
                        <option
                          key={p.id}
                          value={p.name}
                          className={
                            p.isFactory
                              ? "bg-[#0B0D19] text-slate-200 font-normal"
                              : "bg-[#0B0D19] text-purple-300 font-normal"
                          }
                        >
                          {!p.isFactory ? `★ ${p.name}` : p.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
              </select>
            </div>

            {/* Step Next Preset Button */}
            <button
              id="btn-next-synth-preset"
              onClick={() => handleStepPreset(1)}
              className="p-1.5 rounded-lg bg-[#12152A] hover:bg-[#1C213E] text-slate-300 hover:text-white border border-[#2D355A] cursor-pointer transition-colors"
              title="Next Preset"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Floating Save Toast */}
        {saveToast && (
          <div className="absolute top-full right-4 mt-2 z-20 bg-emerald-950 border border-emerald-500/50 text-emerald-300 text-xs px-3 py-1.5 rounded-lg shadow-lg flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1">
            <Check className="w-3.5 h-3.5 text-emerald-400" />
            <span>{saveToast}</span>
          </div>
        )}
      </div>

      {/* Quick Save Modal Popover with Category selection */}
      {isQuickSaving && (
        <div className="bg-[#171B38] border border-indigo-500/40 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-xl animate-in fade-in">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <Bookmark className="w-4 h-4 text-indigo-400" />
            <span>Save Custom Preset to LocalStorage:</span>
          </div>
          <form
            onSubmit={handleQuickSaveSubmit}
            className="flex items-center gap-2 flex-1 max-w-xl flex-wrap sm:flex-nowrap"
          >
            <input
              type="text"
              required
              autoFocus
              placeholder="Preset Name..."
              value={quickSaveName}
              onChange={(e) => setQuickSaveName(e.target.value)}
              className="flex-1 min-w-[140px] bg-[#0B0D19] border border-[#2D355A] rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
            />
            <select
              value={quickSaveCategory}
              onChange={(e) => setQuickSaveCategory(e.target.value as SynthPresetCategory)}
              className="bg-[#0B0D19] border border-[#2D355A] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              {SYNTH_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-xs transition-colors shrink-0 cursor-pointer"
            >
              Save Patch
            </button>
            <button
              type="button"
              onClick={() => setIsQuickSaving(false)}
              className="bg-[#0B0D19] hover:bg-[#1A1F3A] text-slate-400 hover:text-slate-200 text-xs px-2.5 py-1.5 rounded-lg border border-[#252B48] transition-colors shrink-0 cursor-pointer"
            >
              Cancel
            </button>
          </form>
        </div>
      )}

      {/* Control Panels Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Oscillators Section */}
        <div
          className={`bg-[#12152A] border border-[#252B48] rounded-xl p-4 space-y-3.5 shadow-md ${tintClass}`}
        >
          <div className="flex items-center justify-between border-b border-[#252B48] pb-2">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-indigo-400" />
              1. Oscillators
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              OSC 1 + SUB
            </span>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1.5 font-medium">
              Waveform
            </label>
            <div className="grid grid-cols-4 gap-1">
              {(["sawtooth", "square", "sine", "triangle"] as const).map(
                (w) => (
                  <button
                    key={w}
                    id={`btn-wave-${w}`}
                    onClick={() => onChangeParams({ ...params, oscType: w })}
                    className={`py-1 text-[11px] rounded font-semibold capitalize transition-all cursor-pointer ${
                      params.oscType === w
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "bg-[#0B0D19] text-slate-400 hover:text-slate-200 border border-[#252B48]"
                    }`}
                  >
                    {w.slice(0, 4)}
                  </button>
                ),
              )}
            </div>
          </div>

          <div className="flex items-start justify-between gap-2">
            <Knob
              id="slider-sub-osc"
              label="Sub-Osc Volume"
              color="text-indigo-400"
              value={params.subOscVolume}
              min={0}
              max={1}
              step={0.01}
              format={(v) => `${(v * 100).toFixed(0)}%`}
              onChange={(v) => onChangeParams({ ...params, subOscVolume: v })}
            />

            <Knob
              id="slider-detune"
              label="Detune Spread"
              color="text-indigo-400"
              value={params.detune}
              min={0}
              max={50}
              step={1}
              format={(v) => `${v} ct`}
              onChange={(v) => onChangeParams({ ...params, detune: v })}
            />

            <Knob
              id="slider-noise"
              label="Noise Generator"
              color="text-indigo-400"
              value={params.noiseVolume}
              min={0}
              max={0.5}
              step={0.01}
              format={(v) => `${(v * 100).toFixed(0)}%`}
              onChange={(v) => onChangeParams({ ...params, noiseVolume: v })}
            />
          </div>
        </div>
        {/* 2. Filter Section */}
        <div
          className={`bg-[#12152A] border border-[#252B48] rounded-xl p-4 space-y-3.5 shadow-md ${tintClass}`}
        >
          <div className="flex items-center justify-between border-b border-[#252B48] pb-2">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-pink-400" />
              2. VCF Filter
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              24dB/OCT
            </span>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1.5 font-medium">
              Filter Type
            </label>
            <div className="grid grid-cols-3 gap-1">
              {(["lowpass", "bandpass", "highpass"] as const).map((t) => (
                <button
                  key={t}
                  id={`btn-filter-${t}`}
                  onClick={() => onChangeParams({ ...params, filterType: t })}
                  className={`py-1 text-[11px] rounded font-semibold uppercase transition-all cursor-pointer ${
                    params.filterType === t
                      ? "bg-pink-600 text-white shadow-sm"
                      : "bg-[#0B0D19] text-slate-400 hover:text-slate-200 border border-[#252B48]"
                  }`}
                >
                  {t === "lowpass" ? "LPF" : t === "bandpass" ? "BPF" : "HPF"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-start justify-between gap-2">
            <Knob
              id="slider-filter-cutoff"
              label="Cutoff Frequency"
              color="text-pink-400"
              value={params.filterCutoff}
              min={50}
              max={12000}
              step={10}
              scale="log"
              format={(v) => `${Math.round(v)} Hz`}
              onChange={(v) => onChangeParams({ ...params, filterCutoff: v })}
            />

            <Knob
              id="slider-filter-resonance"
              label="Resonance (Q)"
              color="text-pink-400"
              value={params.filterResonance}
              min={0.1}
              max={20}
              step={0.1}
              scale="linear"
              format={(v) => v.toFixed(1)}
              onChange={(v) => onChangeParams({ ...params, filterResonance: v })}
            />

            <Knob
              id="slider-filter-env"
              label="Env Mod Depth"
              color="text-pink-400"
              value={params.filterEnvAmount}
              min={0}
              max={6000}
              step={50}
              scale="linear"
              format={(v) => `+${Math.round(v)} Hz`}
              onChange={(v) => onChangeParams({ ...params, filterEnvAmount: v })}
            />
          </div>
        </div>
        {/* 3. Envelope ADSR */}
        <div
          className={`bg-[#12152A] border border-[#252B48] rounded-xl p-4 space-y-3 shadow-md ${tintClass}`}
        >
          <div className="flex items-center justify-between border-b border-[#252B48] pb-2">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
              3. ADSR Envelope
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              AMP + FILTER
            </span>
          </div>

          {/* AMP / VCA */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-mono text-emerald-400 uppercase tracking-wider">
                AMP / VCA
              </span>
              <span className="flex-1 h-px bg-[#252B48]" />
            </div>
            <div className="flex items-start justify-between gap-2">
              {/* Attack */}
              <Knob
                id="slider-env-attack"
                label="ATT"
                color="text-emerald-400"
                value={params.attack}
                min={0.005}
                max={2.0}
                step={0.01}
                format={(v) => `${v.toFixed(2)}s`}
                onChange={(v) => onChangeParams({ ...params, attack: v })}
              />

              {/* Decay */}
              <Knob
                id="slider-env-decay"
                label="DEC"
                color="text-emerald-400"
                value={params.decay}
                min={0.01}
                max={2.0}
                step={0.01}
                format={(v) => `${v.toFixed(2)}s`}
                onChange={(v) => onChangeParams({ ...params, decay: v })}
              />

              {/* Sustain */}
              <Knob
                id="slider-env-sustain"
                label="SUS"
                color="text-emerald-400"
                value={params.sustain}
                min={0}
                max={1.0}
                step={0.01}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onChange={(v) => onChangeParams({ ...params, sustain: v })}
              />

              {/* Release */}
              <Knob
                id="slider-env-release"
                label="REL"
                color="text-emerald-400"
                value={params.release}
                min={0.01}
                max={3.0}
                step={0.01}
                format={(v) => `${v.toFixed(2)}s`}
                onChange={(v) => onChangeParams({ ...params, release: v })}
              />
            </div>
          </div>

          {/* FILTER / VCF */}
          <div className="border-t border-[#252B48] pt-2.5">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-mono text-pink-400 uppercase tracking-wider">
                FILTER / VCF
              </span>
              <span className="flex-1 h-px bg-[#252B48]" />
            </div>
            <div className="flex items-start justify-between gap-2">
              {/* Filter Attack */}
              <Knob
                id="slider-env-filter-attack"
                label="ATT"
                color="text-pink-400"
                value={params.filterAttack}
                min={0.005}
                max={2.0}
                step={0.01}
                format={(v) => `${v.toFixed(2)}s`}
                onChange={(v) => onChangeParams({ ...params, filterAttack: v })}
              />

              {/* Filter Decay */}
              <Knob
                id="slider-env-filter-decay"
                label="DEC"
                color="text-pink-400"
                value={params.filterDecay}
                min={0.01}
                max={2.0}
                step={0.01}
                format={(v) => `${v.toFixed(2)}s`}
                onChange={(v) => onChangeParams({ ...params, filterDecay: v })}
              />

              {/* Filter Sustain */}
              <Knob
                id="slider-env-filter-sustain"
                label="SUS"
                color="text-pink-400"
                value={params.filterSustain}
                min={0}
                max={1.0}
                step={0.01}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onChange={(v) => onChangeParams({ ...params, filterSustain: v })}
              />

              {/* Filter Release */}
              <Knob
                id="slider-env-filter-release"
                label="REL"
                color="text-pink-400"
                value={params.filterRelease}
                min={0.01}
                max={3.0}
                step={0.01}
                format={(v) => `${v.toFixed(2)}s`}
                onChange={(v) => onChangeParams({ ...params, filterRelease: v })}
              />
            </div>
          </div>
        </div>{" "}
        {/* 4. LFO & Master Pitch */}
        <div
          className={`bg-[#12152A] border border-[#252B48] rounded-xl p-4 space-y-3.5 shadow-md ${tintClass}`}
        >
          <div className="flex items-center justify-between border-b border-[#252B48] pb-2">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              4. LFO & Octave
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              MODULATION
            </span>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1.5 font-medium">
              LFO Destination
            </label>
            <div className="grid grid-cols-3 gap-1">
              {(["cutoff", "pitch", "volume"] as const).map((t) => (
                <button
                  key={t}
                  id={`btn-lfo-target-${t}`}
                  onClick={() => onChangeParams({ ...params, lfoTarget: t })}
                  className={`py-1 text-[11px] rounded font-semibold capitalize transition-all cursor-pointer ${
                    params.lfoTarget === t
                      ? "bg-cyan-600 text-white shadow-sm"
                      : "bg-[#0B0D19] text-slate-400 hover:text-slate-200 border border-[#252B48]"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-start justify-between gap-2">
            <Knob
              id="slider-lfo-rate"
              label="LFO Rate"
              color="text-cyan-400"
              value={params.lfoRate}
              min={0.1}
              max={20}
              step={0.1}
              format={(v) => `${v.toFixed(1)} Hz`}
              onChange={(v) => onChangeParams({ ...params, lfoRate: v })}
            />

            <Knob
              id="slider-lfo-depth"
              label="LFO Depth"
              color="text-cyan-400"
              value={params.lfoDepth}
              min={0}
              max={1}
              step={0.01}
              format={(v) => `${(v * 100).toFixed(0)}%`}
              onChange={(v) => onChangeParams({ ...params, lfoDepth: v })}
            />
          </div>

          <div className="pt-1 flex items-center justify-between">
            <span className="text-xs text-slate-400">Octave Pitch</span>
            <div className="flex items-center gap-1">
              {([-2, -1, 0, 1, 2] as const).map((oct) => (
                <button
                  key={oct}
                  id={`btn-octave-${oct}`}
                  onClick={() => onChangeParams({ ...params, octave: oct })}
                  className={`w-6 h-6 rounded text-xs font-mono font-bold flex items-center justify-center transition-colors cursor-pointer ${
                    params.octave === oct
                      ? "bg-indigo-600 text-white"
                      : "bg-[#0B0D19] text-slate-400 hover:text-white border border-[#252B48]"
                  }`}
                >
                  {oct > 0 ? `+${oct}` : oct}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Piano Keyboard */}
      <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-4 shadow-xl">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Interactive Keyboard
            </span>
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                controlTarget === "synth"
                  ? "bg-slate-700/50 border-slate-600 text-slate-200"
                  : controlTarget === "chord"
                    ? "bg-indigo-600/20 border-indigo-500/40 text-indigo-300"
                    : "bg-emerald-600/20 border-emerald-500/40 text-emerald-300"
              }`}
              title="Current audition sound engine"
            >
              Audition: {controlTarget === "synth" ? "Main Synth" : controlTarget === "chord" ? "Chord Synth" : "Bass Synth"}
            </span>
            <button
              onClick={() =>
                setKeyboardMode(
                  keyboardMode === "chromatic" ? "scale-locked" : "chromatic",
                )
              }
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer border ${
                keyboardMode === "scale-locked"
                  ? "bg-indigo-600 border-indigo-500 text-white shadow-xs"
                  : "bg-[#0B0D19] border-[#252B48] text-slate-400 hover:text-slate-200"
              }`}
              title="Toggle Scale Locked Mode (cuts notes outside active scale)"
            >
              {keyboardMode === "scale-locked"
                ? `Scale Locked (${scaleRoot} ${scaleType})`
                : "Chromatic Mode"}
            </button>
          </div>

          {/* Keyboard Octave Pagination — independent from synth pitch octave */}
          <div className="flex items-center gap-1.5">
            <div className="text-[11px] font-mono text-slate-500 mr-2">
              {Array.from(activeNotes).join(", ") || "No note"}
            </div>

            <span className="text-[11px] text-slate-500 font-mono mr-1">
              KB OCT
            </span>
            <button
              id="btn-keyboard-octave-down"
              onClick={() => setKeyboardOctave((o) => Math.max(-2, o - 1))}
              disabled={keyboardOctave <= -2}
              className="w-7 h-7 flex items-center justify-center rounded-md bg-[#0B0D19] border border-[#252B48] text-slate-400 hover:text-white hover:border-indigo-500 hover:bg-indigo-600/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
              title="Keyboard Octave Down"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="min-w-[52px] h-7 flex items-center justify-center rounded-md bg-indigo-600/15 border border-indigo-500/40 px-2">
              <span className="text-xs font-mono font-bold text-indigo-300">
                {keyboardOctave >= 0 ? `+${keyboardOctave}` : keyboardOctave}{" "}
                Oct
              </span>
            </div>
            <button
              id="btn-keyboard-octave-up"
              onClick={() => setKeyboardOctave((o) => Math.min(2, o + 1))}
              disabled={keyboardOctave >= 2}
              className="w-7 h-7 flex items-center justify-center rounded-md bg-[#0B0D19] border border-[#252B48] text-slate-400 hover:text-white hover:border-indigo-500 hover:bg-indigo-600/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
              title="Keyboard Octave Up"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Keyboard Keys Layout — uses keyboardOctave for display range */}
        <div className="relative h-[130px] flex select-none bg-[#0B0D19] p-2 rounded-lg border border-[#252B48] overflow-x-auto">
          {(keyboardMode === "scale-locked"
            ? getScaleLockedKeyboardNotes(scaleRoot, scaleType, keyboardOctave)
            : getChromaticKeyboardNotes(keyboardOctave)
          ).map((k, noteIndex) => {
            const isActive = activeNotes.has(k.note);
            // Render all scale-locked keys as white
            if (keyboardMode !== "scale-locked" && k.isBlack) {
              const marginLeft = getBlackKeyMargin(k.note);
              return (
                <div
                  key={k.note}
                  id={`key-${k.note}`}
                  onMouseDown={() => handleNoteOn(k.note)}
                  onMouseUp={() => handleNoteOff(k.note)}
                  onMouseLeave={() => isActive && handleNoteOff(k.note)}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    handleNoteOn(k.note);
                  }}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    handleNoteOff(k.note);
                  }}
                  className={`absolute z-10 w-9 h-[80px] rounded-b-md border border-slate-900 cursor-pointer flex flex-col justify-end pb-2 items-center transition-all ${
                    isActive
                      ? "bg-gradient-to-b from-indigo-500 to-indigo-700 shadow-lg shadow-indigo-500/50 scale-[0.98]"
                      : "bg-gradient-to-b from-slate-800 to-slate-950 hover:bg-slate-800"
                  }`}
                  style={{
                    left: `${getBlackKeyLeftOffset(noteIndex)}%`,
                    marginLeft: `${marginLeft}px`,
                  }}
                >
                  <span className="text-[9px] font-mono font-bold text-slate-300">
                    {k.label}
                  </span>
                  <span className="text-[8px] font-mono text-indigo-400 uppercase">
                    {shortcutLabel(k.key)}
                  </span>
                </div>
              );
            }

            return (
              <div
                key={k.note}
                id={`key-${k.note}`}
                onMouseDown={() => handleNoteOn(k.note)}
                onMouseUp={() => handleNoteOff(k.note)}
                onMouseLeave={() => isActive && handleNoteOff(k.note)}
                onTouchStart={(e) => {
                  e.preventDefault();
                  handleNoteOn(k.note);
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  handleNoteOff(k.note);
                }}
                className={`flex-1 h-full rounded-b-md border border-slate-700 mx-0.5 cursor-pointer flex flex-col justify-end pb-2 items-center transition-all ${
                  isActive
                    ? "bg-gradient-to-b from-indigo-200 to-indigo-400 text-slate-950 shadow-inner scale-[0.99]"
                    : "bg-gradient-to-b from-slate-100 to-slate-200 text-slate-800 hover:from-white hover:to-slate-100"
                }`}
              >
                <span className="text-[10px] font-mono font-bold">
                  {k.label}
                </span>
                <span className="text-[9px] font-mono text-indigo-600 uppercase font-semibold">
                  {shortcutLabel(k.key)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Preset Library Sidebar Drawer / Modal */}
      <SynthPresetLibrary
        isOpen={isLibraryOpen}
        onClose={() => setIsLibraryOpen(false)}
        currentParams={params}
        onSelectPreset={(preset) => {
          handleSelectPreset(preset);
          setIsLibraryOpen(false);
        }}
      />
    </div>
  );
};

// Use note index within KEYBOARD_NOTES (0-based) to compute black key position
// Index positions of black keys in KEYBOARD_NOTES: 1(C#), 3(D#), 6(F#), 8(G#), 10(A#), 13(C#), 15(D#)
// This is index-based so it works correctly regardless of which octave range is displayed
function getBlackKeyLeftOffset(noteIndex: number): number {
  const whiteKeyWidth = 100 / 11;
  const offsets: Record<number, number> = {
    1: whiteKeyWidth * 0.7, // C#
    3: whiteKeyWidth * 1.7, // D#
    6: whiteKeyWidth * 3.7, // F#
    8: whiteKeyWidth * 4.7, // G#
    10: whiteKeyWidth * 5.7, // A#
    13: whiteKeyWidth * 7.7, // C# (2nd octave)
    15: whiteKeyWidth * 8.7, // D# (2nd octave)
  };
  return offsets[noteIndex] ?? 0;
}

function getBlackKeyMargin(note: string): number {
  const margins: Record<string, number> = {
    "C#3": 18,
    "D#3": 18,
    "F#3": 12,
    "G#3": 12,
    "A#3": 12,
    "C#4": 8,
    "D#4": 8,
  };
  return margins[note] ?? 0;
}

function getScaleLockedKeyboardNotes(
  root: string,
  scaleType: string,
  octaveOffset: number,
) {
  const scaleNotes = getScaleNotes(root, scaleType);
  const shortcutKeys = [
    "KeyA",
    "KeyS",
    "KeyD",
    "KeyF",
    "KeyG",
    "KeyH",
    "KeyJ",
    "KeyK",
    "KeyL",
    "Semicolon",
    "Quote",
  ];

  let currentOctave = 3 + octaveOffset;
  let prevNoteIndex = -1;

  const octavesToGenerate = 2;
  const allScaleNotesWithOctave: { note: string; label: string }[] = [];

  for (let oct = 0; oct < octavesToGenerate; oct++) {
    for (let i = 0; i < scaleNotes.length; i++) {
      const noteName = scaleNotes[i];
      const noteIndex = ROOTS.indexOf(noteName as any);

      if (prevNoteIndex !== -1 && noteIndex < prevNoteIndex) {
        currentOctave++;
      }

      allScaleNotesWithOctave.push({
        note: `${noteName}${currentOctave}`,
        label: `${noteName}${currentOctave}`,
      });

      prevNoteIndex = noteIndex;
    }
  }

  return allScaleNotesWithOctave.map((item, index) => {
    return {
      note: item.note,
      label: item.label,
      key: index < shortcutKeys.length ? shortcutKeys[index] : "",
      isBlack: false,
    };
  });
}

// Chromatic keyboard always starts from C — octaveOffset shifts the range up/down
// Not affected by master key/scale; regex supports any octave number
function getChromaticKeyboardNotes(octaveOffset: number) {
  return KEYBOARD_NOTES.map((k) => {
    const match = k.note.match(/^([A-G][#b]?)(-?\d+)/);
    if (match) {
      const noteName = match[1];
      const origOct = parseInt(match[2], 10);
      const targetOct = origOct + octaveOffset;
      return {
        ...k,
        note: `${noteName}${targetOct}`,
        label: k.isBlack ? noteName : `${noteName}${targetOct}`,
      };
    }
    return k;
  });
}
