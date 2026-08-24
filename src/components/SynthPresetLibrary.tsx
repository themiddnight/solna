import React, { useMemo, useState } from 'react';
import {
  Activity,
  Download,
  FolderOpen,
  Sliders,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react';
import type { SynthParams } from '../types';
import {
  getAllSynthPresets,
  SynthPresetItem,
  SynthPresetCategory,
  SYNTH_CATEGORIES,
  getCategoryMeta,
  getPresetsGroupedByCategory,
} from '../audio/synthPresets';
import { useAppStore } from '../store/store';
import { INITIAL_SYNTH_PARAMS } from '../store/initialState';
import { PresetLibrary } from './ui/PresetLibrary';
import type { PresetLibraryEntry, PresetCategory, PresetLibraryGroup, PresetSaveDraft } from './ui/PresetLibrary';
import { previewSynthPreset } from '../audio/playback/presetPreview';

interface SynthPresetLibraryProps {
  currentParams: SynthParams;
  onSelectPreset: (preset: SynthPresetItem) => void;
  isOpen: boolean;
  onClose: () => void;
}

// Wrapper entries: one per SynthPresetItem (custom first via getAllSynthPresets);
// the underlying preset is what onSelect hands to onSelectPreset.
interface SynthLibraryEntry extends PresetLibraryEntry {
  preset: SynthPresetItem;
}

export const SynthPresetLibrary: React.FC<SynthPresetLibraryProps> = ({
  currentParams,
  onSelectPreset,
  isOpen,
  onClose,
}) => {
  const customPresets = useAppStore((s) => s.customSynthPresets);
  const savePreset = useAppStore((s) => s.saveCustomPreset);
  const deletePreset = useAppStore((s) => s.deleteCustomPreset);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg(null), 3000);
  };

  const allPresets = useMemo(() => getAllSynthPresets(customPresets), [customPresets]);

  const entries = useMemo<SynthLibraryEntry[]>(
    () =>
      allPresets.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        description: p.description ?? '',
        isFactory: p.isFactory,
        preset: p,
      })),
    [allPresets]
  );

  // PORT of the original category chips (original lines ~57-67, ~257-289):
  // 'All' first with the total count, then the eight categories in
  // SYNTH_CATEGORIES order; chip labels are the original's ('Custom' for User)
  // and counts live in `count`; the save-form select uses selectLabel to keep
  // the original 'Custom / User' wording.
  const categories = useMemo<PresetCategory[]>(
    () => [
      { id: 'All', label: 'All', badgeClass: 'badge badge-primary', description: '', count: String(allPresets.length) },
      ...SYNTH_CATEGORIES.map((meta) => {
        const count =
          meta.id === 'User'
            ? allPresets.filter((p) => !p.isFactory || p.category === 'User').length
            : allPresets.filter((p) => p.category === meta.id).length;
        return {
          id: meta.id,
          label: meta.shortLabel,
          selectLabel: meta.label,
          badgeClass: 'badge badge-primary',
          description: meta.description,
          count: String(count),
        };
      }),
    ],
    [allPresets]
  );

  // PORT of the original filteredPresets predicate: the 'User' chip matches
  // every custom entry regardless of its saved category (plus any factory entry
  // stored under 'User'); search covers name + description.
  const filterEntries = (e: SynthLibraryEntry, query: string, categoryId: string) => {
    const matchesCategory =
      categoryId === 'All'
        ? true
        : categoryId === 'User'
        ? !e.isFactory || e.category === 'User'
        : e.category.toLowerCase() === categoryId.toLowerCase();

    const matchesSearch =
      query.trim() === '' ||
      e.name.toLowerCase().includes(query.toLowerCase()) ||
      (e.description && e.description.toLowerCase().includes(query.toLowerCase()));

    return matchesCategory && matchesSearch;
  };

  // PORT of the original save handler: save the current params (the store
  // action strips the `preset` label and trims name/description internally),
  // toast the original message, then select the created preset. Always returns
  // true — there is no guard, so the generic always closes on submit.
  const handleSave = (draft: PresetSaveDraft): boolean => {
    const created = savePreset(
      draft.name,
      currentParams,
      draft.category as SynthPresetCategory,
      draft.description
    );
    showToast(`Preset "${created.name}" saved to [${created.category}]!`);
    onSelectPreset(created);
    return true;
  };

  const handleDelete = (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete preset "${name}"?`)) {
      deletePreset(id);
    }
  };

  const handleAudition = (preset: SynthPresetItem) => {
    previewSynthPreset(preset, currentParams);
  };

  const handleExport = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(customPresets, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `musibox-synth-presets-${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const imported = JSON.parse(evt.target?.result as string);
        if (Array.isArray(imported)) {
          // Each save prepends to the store, so walk backwards to keep the
          // imported file's original order on top of the existing list.
          [...imported]
            .reverse()
            .forEach((item: SynthPresetItem) => {
              savePreset(
                item.name,
                // Imported params may be partial; save the full shape so the
                // stored preset stands on its own (all saved presets do).
                { ...INITIAL_SYNTH_PARAMS, ...item.params },
                item.category,
                item.description
              );
            });
          showToast(`Imported ${imported.length} presets!`);
        }
      } catch {
        alert('Invalid JSON preset file');
      }
    };
    reader.readAsText(file);
  };

  // PORT of the original list organization (original lines ~375-416): grouped
  // category sections when viewing All without a search, flat list otherwise.
  const groupEntries = (
    filtered: SynthLibraryEntry[],
    query: string,
    category: string
  ): PresetLibraryGroup<SynthLibraryEntry>[] => {
    if (category !== 'All' || query.trim()) {
      return [
        { key: 'flat', className: 'space-y-3', innerClassName: 'space-y-3', entries: filtered },
      ];
    }

    return getPresetsGroupedByCategory(filtered.map((e) => e.preset)).map((group) => ({
      key: group.category,
      className: 'space-y-2',
      header: (
        <div className="flex items-center justify-between px-1 pt-2 pb-1 border-b border-base-300">
          <div className="flex items-center gap-2">
            <span className={`${group.badgeClass} badge-sm font-mono font-semibold`}>
              {group.category}
            </span>
            <span className="text-xs font-bold text-base-content">{group.label}</span>
          </div>
          {group.description && (
            <span className="text-[10px] text-base-content/50 truncate max-w-40">
              {group.description}
            </span>
          )}
        </div>
      ),
      entries: group.presets.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        description: p.description ?? '',
        isFactory: p.isFactory,
        preset: p,
      })),
    }));
  };

  // PORT of the original empty state (original lines ~376-388): icon, "No
  // presets found for ..." text, and the "Save your first custom preset now"
  // link (opens the save form) when the User category is empty.
  const emptyState = (query: string, category: string, openSave: () => void) => (
    <div className="text-center py-12 text-base-content/50 text-xs space-y-2">
      <FolderOpen className="w-8 h-8 mx-auto opacity-40 text-primary" />
      <p>No presets found for "{query || category}"</p>
      {category === 'User' && (
        <button onClick={openSave} className="link link-primary text-xs">
          Save your first custom preset now
        </button>
      )}
    </div>
  );

  // PORT of the original preset card (original lines ~432-509): whole-card
  // select, Active badge + category badge, description, sound badges
  // (osc type + filter label/cutoff), audition + delete buttons.
  const renderEntry = (e: SynthLibraryEntry) => {
    const preset = e.preset;
    const isCurrent = currentParams.preset === preset.name;
    const oscType = preset.params.oscType || 'sawtooth';
    const filterType = preset.params.filterType || 'lowpass';
    const cutoff = preset.params.filterCutoff || 2000;
    const meta = getCategoryMeta(preset.category);

    return (
      <div
        className={`card p-0 border transition-all group relative ${
          isCurrent
            ? 'bg-primary/10 border-primary shadow-md ring-1 ring-primary/50'
            : 'bg-base-200 border-base-300 hover:border-primary/50 hover:bg-base-300'
        }`}
      >
        <button
          type="button"
          onClick={() => onSelectPreset(preset)}
          className="w-full text-left p-3 cursor-pointer"
        >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h4 className="font-semibold text-xs text-base-content truncate group-hover:text-primary transition-colors">
                {preset.name}
              </h4>
              {isCurrent && (
                <span className="badge badge-xs badge-primary py-0.5 font-bold uppercase tracking-wider">
                  Active
                </span>
              )}
              <span
                className={`${meta.badgeClass} badge-xs py-0.5 font-mono`}
              >
                {preset.category}
              </span>
            </div>

            {preset.description && (
              <p className="text-[11px] text-base-content/60 line-clamp-1 mb-2">
                {preset.description}
              </p>
            )}

            {/* Sound Badge Attributes */}
            <div className="flex items-center gap-1.5 text-[10px] text-base-content/60 font-mono">
              <span className="badge badge-sm badge-ghost font-mono gap-1">
                <Activity className="w-2.5 h-2.5 text-primary" />
                {oscType}
              </span>
              <span className="badge badge-sm badge-ghost font-mono gap-1">
                <Sliders className="w-2.5 h-2.5 text-accent" />
                {filterType === 'lowpass' ? 'LPF' : filterType === 'highpass' ? 'HPF' : 'BPF'} {Math.round(cutoff)}Hz
              </span>
            </div>
          </div>
        </div>
        </button>

        {/* Action buttons */}
        <div className="absolute top-3 right-3 flex items-center gap-1 shrink-0">
          <button
            onClick={() => handleAudition(preset)}
            className="btn btn-xs btn-ghost btn-square hover:btn-primary"
            title="Audition Sound (Play Note)"
          >
            <Volume2 className="w-3.5 h-3.5" />
          </button>

          {!preset.isFactory && (
            <button
              onClick={() => handleDelete(preset.id, preset.name)}
              className="btn btn-xs btn-ghost btn-square hover:btn-error"
              title="Delete Custom Preset"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  };

  // PORT of the original toolbar action row (original lines ~206-234): the
  // Save Current Sound button is the generic's saveButton; the icon-only
  // Export/Import buttons follow it in the same flex row.
  const toolbarActions = (
    <>
      <button
        onClick={handleExport}
        disabled={customPresets.length === 0}
        className="btn btn-sm btn-ghost btn-square disabled:opacity-40"
        title="Export User Presets to JSON"
      >
        <Download className="w-3.5 h-3.5" />
      </button>

      <label
        className="btn btn-sm btn-ghost btn-square disabled:opacity-40"
        title="Import Presets from JSON"
      >
        <Upload className="w-3.5 h-3.5" />
        <input type="file" accept=".json" onChange={handleImport} className="hidden" />
      </label>
    </>
  );

  // PORT of the original footer (original lines ~418-427): LocalStorage note +
  // Done button.
  const footer = (
    <div className="p-3 border-t border-base-300 bg-base-200 flex items-center justify-between text-[11px] text-base-content/60">
      <span>Storage: Browser LocalStorage</span>
      <button
        onClick={onClose}
        className="btn btn-sm btn-ghost font-medium"
      >
        Done
      </button>
    </div>
  );

  return (
    <PresetLibrary
      isOpen={isOpen}
      onClose={onClose}
      title="Synth Presets Library"
      headerBadge={`${allPresets.length} Total`}
      headerSubtitle="Categorized factory sounds & custom user patches"
      saveButton={{ label: 'Save Current Sound', inToolbar: true }}
      toolbarActions={toolbarActions}
      toast={toastMsg}
      toastPlacement="toolbar"
      variant="synth"
      searchPlaceholder="Search presets by name or tone..."
      entries={entries}
      categories={categories}
      listContainerClass="flex-1 overflow-y-auto p-3 space-y-3"
      groupEntries={groupEntries}
      renderEntry={renderEntry}
      emptyState={emptyState}
      filterEntries={filterEntries}
      footer={footer}
      save={{
        heading: 'Save New Preset to LocalStorage',
        buttonLabel: 'Save Preset',
        withCategory: true,
        withDescription: true,
        withRoman: false,
        defaultCategory: 'Lead',
        variant: 'inline',
        initialName: currentParams.preset ? `${currentParams.preset} (Custom)` : 'My Synth Patch',
      }}
      onSelect={(entry) => onSelectPreset(entry.preset)}
      onDelete={(id) => {
        const entry = entries.find((en) => en.id === id);
        if (entry && confirm(`Are you sure you want to delete preset "${entry.name}"?`)) {
          deletePreset(id);
        }
      }}
      onSave={handleSave}
    />
  );
};
