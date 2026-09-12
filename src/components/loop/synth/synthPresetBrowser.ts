import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useAppStore } from '@/store/store';
import { isMelodicFocus, type MixLayerId } from '@/store/focusTrack';
import type { SynthPresetItem, SynthPresetCategory } from '@/data/synthPresets';
import {
  applyPreset,
  findPresetByName,
  getAllSynthPresets,
  getPresetsGroupedByCategory,
  getCategoryMeta,
} from '@/audio/presetRegistry';
import type { SynthParams } from '@/types';

/**
 * `isLibraryOpen` / `isQuickSaving` are SoundSynthSection's own `useState`, and
 * that section never unmounts (every tab stays mounted — see the layering note
 * in SoundView's neighbours). Unmounting the Synth section on a drum focus does
 * not reset them, so without this the preset library or the quick-save popover
 * a user opened, then left by switching focus to Beat, pops back open the
 * moment focus returns to a melodic track — a surface the user never asked to
 * see again. Exported so the decision is testable directly: `renderToString`
 * runs no effect, so a render-only test can only ever see the FIRST render's
 * default state and could never actually catch this regression.
 */
export const shouldCloseSynthOverlays = (focusTrack: MixLayerId): boolean =>
  !isMelodicFocus(focusTrack);

/** Whether a preset group belongs in the dropdown under a category filter. */
export const groupInCategory = (groupCategory: string, categoryId: string): boolean =>
  categoryId === "All"
    ? true
    : categoryId === "User"
      ? groupCategory === "User"
      : groupCategory === categoryId;

/** Whether a preset belongs to a category chip. 'User' is the odd one: it is
 *  every custom preset regardless of its saved category, plus factory entries
 *  stored under 'User'. One predicate, so the chip's count, the chip's click
 *  and the step navigation cannot disagree about what a filter selects. */
export const presetInCategory = (preset: SynthPresetItem, categoryId: string): boolean =>
  categoryId === "All"
    ? true
    : categoryId === "User"
      ? !preset.isFactory || preset.category === "User"
      : preset.category === categoryId;

/** The presets a category chip selects. */
const presetsInCategory = (
  allPresets: SynthPresetItem[],
  categoryId: string,
): SynthPresetItem[] => allPresets.filter((p) => presetInCategory(p, categoryId));

/** What a category chip's badge counts. */
export const categoryPresetCount = (allPresets: SynthPresetItem[], categoryId: string): number =>
  presetsInCategory(allPresets, categoryId).length;

/** Simple vs Pro UI Mode, with its localStorage persistence. */
export function useSynthViewMode() {
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

  return { synthViewMode, handleToggleSynthViewMode };
}

/**
 * The preset the patch is on, the list it can be stepped through, and the four
 * ways to change it — chips, dropdown, steppers, and the toast that confirms a
 * load. One hook because all of them answer the same question about the same
 * list, and `customPresets` is a local mirror of the store's list, refreshed by
 * `reloadPresets` whenever the drawer opens.
 */
export function useSynthPresetBrowser(
  params: SynthParams,
  onChangeParams: (params: SynthParams) => void,
) {
  const [customPresets, setCustomPresets] = useState<SynthPresetItem[]>([]);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>("All");
  const [saveToast, setSaveToast] = useState<string | null>(null);

  const allPresets = useMemo(() => getAllSynthPresets(customPresets), [customPresets]);

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
  const selectablePresets = useMemo(
    () => presetsInCategory(allPresets, selectedCategoryFilter),
    [selectedCategoryFilter, allPresets],
  );

  // Sync custom presets from local storage
  const reloadPresets = useCallback(() => {
    setCustomPresets(useAppStore.getState().customSynthPresets);
  }, []);

  const handleSelectPreset = (preset: SynthPresetItem) => {
    onChangeParams(applyPreset(params, preset));
    setSaveToast(`Loaded [${preset.category}] "${preset.name}"`);
    setTimeout(() => setSaveToast(null), 2500);
  };

  // Saving reloads first (the new preset is in the store, not in the mirror),
  // then announces: `handleSelectPreset`'s "Loaded ..." line is overwritten by
  // the saved line on the next statement, exactly as the original did it.
  const notifySaved = (preset: SynthPresetItem) => {
    handleSelectPreset(preset);
    setSaveToast(`Preset "${preset.name}" saved to ${preset.category}!`);
    setTimeout(() => setSaveToast(null), 3000);
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

  const handleDropdownChange = (name: string) => {
    const preset = findPresetByName(name, allPresets);
    if (preset) handleSelectPreset(preset);
  };

  const handleCategoryFilterClick = (catId: string) => {
    setSelectedCategoryFilter(catId);
    if (catId === "All") return;
    const matching = presetsInCategory(allPresets, catId);
    if (matching.length > 0) {
      const currentInCat = matching.some((p) => p.name === params.preset);
      if (!currentInCat) {
        handleSelectPreset(matching[0]);
      }
    }
  };

  return {
    allPresets,
    categoryGroups,
    activePresetItem,
    activeCategoryMeta,
    selectedCategoryFilter,
    saveToast,
    reloadPresets,
    selectPreset: handleSelectPreset,
    notifySaved,
    stepPreset: handleStepPreset,
    selectByName: handleDropdownChange,
    filterByCategory: handleCategoryFilterClick,
  };
}

/**
 * The synth patch's overlay state: the preset library drawer, the quick-save
 * popover, what that popover's form holds, and the focus rule that closes both.
 */
export function useSynthOverlays({
  focusTrack,
  params,
  reloadPresets,
  onSaved,
}: {
  focusTrack: MixLayerId;
  params: SynthParams;
  reloadPresets: () => void;
  onSaved: (preset: SynthPresetItem) => void;
}) {
  const [isLibraryOpen, setIsLibraryOpen] = useState<boolean>(false);
  const [isQuickSaving, setIsQuickSaving] = useState<boolean>(false);
  const [quickSaveName, setQuickSaveName] = useState<string>("");
  const [quickSaveCategory, setQuickSaveCategory] =
    useState<SynthPresetCategory>("User");

  // Close the two synth-only overlays the moment focus leaves a melodic
  // track — see shouldCloseSynthOverlays above for why leaving them open is
  // a bug rather than a no-op.
  useEffect(() => {
    if (shouldCloseSynthOverlays(focusTrack)) {
      setIsLibraryOpen(false);
      setIsQuickSaving(false);
    }
  }, [focusTrack]);

  useEffect(() => {
    reloadPresets();
  }, [reloadPresets, isLibraryOpen]);

  const openQuickSave = (
    presetName: string | undefined,
    presetCategory: SynthPresetCategory | undefined,
  ) => {
    setQuickSaveName(presetName ? `${presetName} (Custom)` : "My Synth Patch");
    setQuickSaveCategory(presetCategory ?? "User");
    setIsQuickSaving(true);
  };

  const handleQuickSaveSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!quickSaveName.trim()) return;

    const saved = useAppStore.getState().saveCustomPreset(quickSaveName, params, quickSaveCategory);
    reloadPresets();
    setIsQuickSaving(false);
    setQuickSaveName("");
    onSaved(saved);
  };

  return {
    isLibraryOpen,
    openLibrary: () => setIsLibraryOpen(true),
    closeLibrary: () => setIsLibraryOpen(false),
    isQuickSaving,
    closeQuickSave: () => setIsQuickSaving(false),
    quickSaveName,
    setQuickSaveName,
    quickSaveCategory,
    setQuickSaveCategory,
    openQuickSave,
    handleQuickSaveSubmit,
  };
}

export type SynthPresetBrowser = ReturnType<typeof useSynthPresetBrowser>;
export type SynthOverlays = ReturnType<typeof useSynthOverlays>;

