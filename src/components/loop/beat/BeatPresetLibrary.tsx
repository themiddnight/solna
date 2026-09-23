import { useMemo, useState } from 'react';
import { BEAT_PRESETS } from '@/data/beatPresets';
import { useAppStore } from '@/store/store';
import { PresetLibrary } from '@/components/ui/PresetLibrary';
import type { PresetCategory, PresetLibraryEntry, PresetSaveDraft } from '@/components/ui/PresetLibrary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useLibraryToast } from '@/components/ui/useTimedToast';
import type { BeatPreset } from '@/types';

export interface BeatLibraryEntry extends PresetLibraryEntry {
  preset: BeatPreset;
}

/**
 * A preset's `origin` IS its category here — Beat has no user-assigned
 * category field (F5 resolved no custom categories), so "which library it
 * came from" is the only grouping the drawer can offer, and it is always
 * answerable. `description` stays '' rather than undefined: `PresetLibrary`'s
 * default row and search both read it, and a `BeatPreset` carries no prose of
 * its own to put there.
 */
export function toLibraryEntry(preset: BeatPreset): BeatLibraryEntry {
  return {
    id: preset.id,
    name: preset.name,
    category: preset.origin === 'user' ? 'My Kits' : 'Factory',
    description: '',
    isFactory: preset.origin === 'factory',
    preset,
  };
}

export function buildCategories(entries: readonly BeatLibraryEntry[]): PresetCategory[] {
  const userCount = entries.filter((e) => e.category === 'My Kits').length;
  return [
    { id: 'All', label: 'All', badgeClass: 'badge badge-primary', description: '', count: String(entries.length) },
    { id: 'My Kits', label: 'My Kits', badgeClass: 'badge badge-primary', description: '', count: String(userCount) },
    { id: 'Factory', label: 'Factory', badgeClass: 'badge badge-primary', description: '', count: String(entries.length - userCount) },
  ];
}

/**
 * The library's own index: the live catalogue (factory table plus the user's
 * saved kits), as entries and derived categories. User first, then factory —
 * `PresetLibraryProps.entries`' documented merge order — so a just-saved kit
 * is the first thing the list shows rather than buried under the factory set.
 */
function useBeatLibraryIndex() {
  const customBeatPresets = useAppStore((s) => s.customBeatPresets);
  const basePresetId = useAppStore((s) => s.beatParams.basePresetId);

  const allPresets = useMemo<readonly BeatPreset[]>(
    () => [...customBeatPresets, ...BEAT_PRESETS],
    [customBeatPresets],
  );
  const entries = useMemo(() => allPresets.map(toLibraryEntry), [allPresets]);
  const categories = useMemo(() => buildCategories(entries), [entries]);
  const activeEntryId = useMemo(
    () => (basePresetId ? entries.find((e) => e.id === basePresetId)?.id : undefined),
    [entries, basePresetId],
  );

  return { entries, categories, activeEntryId };
}

/**
 * Save and delete, the two library-editing gestures. Save reads the LIVE
 * `beatParams` at submit time — the same "whatever the loop holds now, not
 * whatever it held when the drawer opened" rule the synth library's Save
 * follows — and reports through this drawer's own inline toast (content,
 * R329), never through `showFeedback`: that host toast is Quick Save's, and
 * firing it again here for the same kind of save would duplicate it.
 * Delete goes behind the same confirm step the synth drawer uses, because a
 * kit removed here cannot be undone from this screen.
 */
function useBeatLibraryActions() {
  const saveCustomBeatPreset = useAppStore((s) => s.saveCustomBeatPreset);
  const deleteCustomBeatPreset = useAppStore((s) => s.deleteCustomBeatPreset);
  const { toastMsg, toastTone, showToast } = useLibraryToast();
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  const handleSave = (draft: PresetSaveDraft): boolean => {
    const saved = saveCustomBeatPreset(draft.name, useAppStore.getState().beatParams);
    showToast(`Preset "${saved.name}" saved to My Kits!`);
    return true;
  };

  const requestDelete = (id: string, name: string) => setPendingDelete({ id, name });
  const confirmDelete = () => {
    if (pendingDelete) deleteCustomBeatPreset(pendingDelete.id);
    setPendingDelete(null);
  };
  const cancelDelete = () => setPendingDelete(null);

  return { toastMsg, toastTone, pendingDelete, handleSave, requestDelete, confirmDelete, cancelDelete };
}

export interface BeatPresetLibraryProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * The Beat instrument's user-library drawer (R327: a deletable user library
 * gets a drawer even where a quick pick also exists — `BeatPresetToolbar`'s
 * Kit `<select>` and arrows stay for the fast, in-place pick).
 *
 * No audition (Q2 resolved), no import/export and no custom categories: the
 * three things that make the synth drawer the bigger of the two originals are
 * all absent here on purpose, which is why this file stays a fraction of
 * `SynthPresetLibrary.tsx`'s size and needs no `renderEntry` — the default
 * card `PresetLibrary` already renders (name, Select, delete-if-not-factory)
 * is the whole card.
 */
export function BeatPresetLibrary({ isOpen, onClose }: BeatPresetLibraryProps) {
  const setBeatPreset = useAppStore((s) => s.setBeatPreset);
  const { entries, categories, activeEntryId } = useBeatLibraryIndex();
  const { toastMsg, toastTone, pendingDelete, handleSave, requestDelete, confirmDelete, cancelDelete } =
    useBeatLibraryActions();

  return (
    <>
      <PresetLibrary
        isOpen={isOpen}
        onClose={onClose}
        title="Beat Kit Library"
        headerBadge={`${entries.length} Total`}
        headerSubtitle="Factory kits & your saved Beat presets"
        activeEntryId={activeEntryId}
        saveButton={{ label: 'Save Current Kit', inToolbar: true }}
        toast={toastMsg}
        toastPlacement="toolbar"
        toastTone={toastTone}
        variant="synth"
        searchPlaceholder="Search kits by name..."
        entries={entries}
        categories={categories}
        save={{
          heading: 'Save Beat Preset',
          buttonLabel: 'Save Preset',
          withCategory: false,
          withDescription: false,
          withRoman: false,
          defaultCategory: '',
          variant: 'inline',
          initialName: 'My Beat Kit',
        }}
        onSelect={(entry) => {
          setBeatPreset(entry.id);
          onClose();
        }}
        onDelete={(id) => {
          const entry = entries.find((e) => e.id === id);
          if (entry) requestDelete(id, entry.name);
        }}
        onSave={handleSave}
      />
      {pendingDelete && (
        <ConfirmDialog
          title="Delete preset"
          message={<>Are you sure you want to delete preset <strong>{pendingDelete.name}</strong>?</>}
          confirmLabel="Delete"
          danger
          onConfirm={confirmDelete}
          onCancel={cancelDelete}
        />
      )}
    </>
  );
}
