import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Bookmark,
  Plus,
  Trash2,
  Search,
  Check,
  X,
  Sliders,
  Activity,
  FolderOpen,
  Download,
  Upload,
  Volume2,
} from 'lucide-react';
import { SynthParams } from '../types';
import {
  getAllSynthPresets,
  SynthPresetItem,
  getCustomPresets,
  saveCustomPreset,
  deleteCustomPreset,
} from '../audio/synthPresets';
import { audioEngine } from '../audio/engine';

interface SynthPresetLibraryProps {
  currentParams: SynthParams;
  onSelectPreset: (preset: SynthPresetItem) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const SynthPresetLibrary: React.FC<SynthPresetLibraryProps> = ({
  currentParams,
  onSelectPreset,
  isOpen,
  onClose,
}) => {
  const [customPresets, setCustomPresets] = useState<SynthPresetItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showSaveModal, setShowSaveModal] = useState<boolean>(false);
  const [newPresetName, setNewPresetName] = useState<string>('');
  const [newPresetCategory, setNewPresetCategory] = useState<SynthPresetItem['category']>('User');
  const [newPresetDesc, setNewPresetDesc] = useState<string>('');
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Load custom presets on mount / when opened
  useEffect(() => {
    setCustomPresets(getCustomPresets());
  }, [isOpen]);

  const allPresets: SynthPresetItem[] = getAllSynthPresets(customPresets);

  const categories = ['All', 'User', 'Lead', 'Bass', 'Pad', 'Keys', 'Pluck', 'Brass', 'FX'];

  const filteredPresets = allPresets.filter((item) => {
    const matchesCategory =
      selectedCategory === 'All'
        ? true
        : selectedCategory === 'User'
        ? !item.isFactory
        : item.category.toLowerCase() === selectedCategory.toLowerCase();

    const matchesSearch =
      searchQuery.trim() === '' ||
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.description && item.description.toLowerCase().includes(searchQuery.toLowerCase()));

    return matchesCategory && matchesSearch;
  });

  const handleSavePreset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPresetName.trim()) return;

    const created = saveCustomPreset(
      newPresetName,
      currentParams,
      newPresetCategory,
      newPresetDesc
    );
    setCustomPresets(getCustomPresets());
    setShowSaveModal(false);
    setNewPresetName('');
    setNewPresetDesc('');
    setSaveSuccessMsg(`Preset "${created.name}" saved!`);
    setTimeout(() => setSaveSuccessMsg(null), 3000);
    onSelectPreset(created);
  };

  const handleDelete = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Are you sure you want to delete preset "${name}"?`)) {
      const updated = deleteCustomPreset(id);
      setCustomPresets(updated);
    }
  };

  const handleAudition = (preset: SynthPresetItem, e: React.MouseEvent) => {
    e.stopPropagation();
    audioEngine.init();
    const testParams: SynthParams = {
      ...currentParams,
      ...preset.params,
      preset: preset.name,
    };
    audioEngine.triggerSynthNoteOn('C4', testParams, 0.85);
    setTimeout(() => {
      audioEngine.triggerSynthNoteOff('C4', testParams.release || 0.4);
    }, 450);
  };

  const handleExport = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(customPresets, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `murva-synth-presets-${new Date().toISOString().slice(0, 10)}.json`);
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
          const merged = [...imported, ...customPresets];
          localStorage.setItem('murva_synth_custom_presets_v1', JSON.stringify(merged));
          setCustomPresets(getCustomPresets());
          setSaveSuccessMsg(`Imported ${imported.length} presets!`);
          setTimeout(() => setSaveSuccessMsg(null), 3000);
        }
      } catch (err) {
        alert('Invalid JSON preset file');
      }
    };
    reader.readAsText(file);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      {/* Sidebar Drawer */}
      <div className="w-full max-w-md h-full bg-[#12152A] border-l border-[#252B48] flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-right duration-200">
        {/* Drawer Header */}
        <div className="p-4 border-b border-[#252B48] flex items-center justify-between bg-[#0E1022]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                Synth Presets Library
                <span className="text-[10px] font-mono bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-500/30">
                  {allPresets.length} Total
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">Browse, audition, and save custom sound patches</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-[#1C213E] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action Toolbar */}
        <div className="p-3 border-b border-[#252B48] space-y-2 bg-[#12152A]">
          <div className="flex gap-2">
            <button
              onClick={() => {
                setNewPresetName(currentParams.preset ? `${currentParams.preset} (Custom)` : 'My Synth Patch');
                setShowSaveModal(true);
              }}
              className="flex-1 flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-2 px-3 rounded-lg shadow-md transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Save Current Sound
            </button>

            <button
              onClick={handleExport}
              disabled={customPresets.length === 0}
              className="px-2.5 py-2 bg-[#0B0D19] hover:bg-[#1A1F3A] disabled:opacity-40 text-slate-300 text-xs rounded-lg border border-[#252B48] transition-colors flex items-center gap-1"
              title="Export User Presets to JSON"
            >
              <Download className="w-3.5 h-3.5" />
            </button>

            <label
              className="px-2.5 py-2 bg-[#0B0D19] hover:bg-[#1A1F3A] text-slate-300 text-xs rounded-lg border border-[#252B48] transition-colors flex items-center gap-1 cursor-pointer"
              title="Import Presets from JSON"
            >
              <Upload className="w-3.5 h-3.5" />
              <input type="file" accept=".json" onChange={handleImport} className="hidden" />
            </label>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Search presets by name or tone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#0B0D19] border border-[#252B48] rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-200"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Category Chips */}
          <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none text-[11px]">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap transition-colors ${
                  selectedCategory === cat
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-[#0B0D19] text-slate-400 hover:text-slate-200 border border-[#252B48]'
                }`}
              >
                {cat === 'User' ? `Custom (${customPresets.length})` : cat}
              </button>
            ))}
          </div>

          {saveSuccessMsg && (
            <div className="bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 animate-in fade-in">
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span>{saveSuccessMsg}</span>
            </div>
          )}
        </div>

        {/* Save Preset Inline Modal / Popover */}
        {showSaveModal && (
          <form onSubmit={handleSavePreset} className="p-3 bg-[#1A1E38] border-b border-indigo-500/30 space-y-2.5 animate-in fade-in">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Bookmark className="w-3.5 h-3.5 text-indigo-400" />
                Save New Preset to LocalStorage
              </span>
              <button
                type="button"
                onClick={() => setShowSaveModal(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Preset Name</label>
              <input
                type="text"
                required
                placeholder="e.g. Blade Runner Lead"
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                className="w-full bg-[#0B0D19] border border-[#252B48] rounded-md px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Category</label>
                <select
                  value={newPresetCategory}
                  onChange={(e) => setNewPresetCategory(e.target.value as any)}
                  className="w-full bg-[#0B0D19] border border-[#252B48] rounded-md px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="Lead">Lead</option>
                  <option value="Bass">Bass</option>
                  <option value="Pad">Pad</option>
                  <option value="Keys">Keys</option>
                  <option value="Pluck">Pluck</option>
                  <option value="Brass">Brass</option>
                  <option value="FX">FX</option>
                  <option value="User">User / Custom</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Description (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Heavy filtered sound"
                  value={newPresetDesc}
                  onChange={(e) => setNewPresetDesc(e.target.value)}
                  className="w-full bg-[#0B0D19] border border-[#252B48] rounded-md px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowSaveModal(false)}
                className="px-3 py-1 bg-[#0B0D19] text-slate-400 hover:text-slate-200 text-xs rounded-md border border-[#252B48]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-md shadow-xs"
              >
                Save Preset
              </button>
            </div>
          </form>
        )}

        {/* Preset Cards List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {filteredPresets.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs space-y-2">
              <FolderOpen className="w-8 h-8 mx-auto opacity-40 text-indigo-400" />
              <p>No presets found for "{searchQuery || selectedCategory}"</p>
              {selectedCategory === 'User' && (
                <button
                  onClick={() => setShowSaveModal(true)}
                  className="text-indigo-400 hover:underline text-xs"
                >
                  Save your first custom preset now
                </button>
              )}
            </div>
          ) : (
            filteredPresets.map((preset) => {
              const isCurrent = currentParams.preset === preset.name;
              const oscType = preset.params.oscType || 'sawtooth';
              const filterType = preset.params.filterType || 'lowpass';
              const cutoff = preset.params.filterCutoff || 2000;

              return (
                <div
                  key={preset.id}
                  onClick={() => onSelectPreset(preset)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer group relative ${
                    isCurrent
                      ? 'bg-indigo-950/40 border-indigo-500/80 shadow-md ring-1 ring-indigo-500/50'
                      : 'bg-[#0B0D19] border-[#252B48] hover:border-indigo-500/50 hover:bg-[#151933]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-semibold text-xs text-slate-100 truncate group-hover:text-indigo-300 transition-colors">
                          {preset.name}
                        </h4>
                        {isCurrent && (
                          <span className="text-[9px] bg-indigo-500 text-white px-1.5 py-0.2 rounded font-bold uppercase tracking-wider">
                            Active
                          </span>
                        )}
                        <span
                          className={`text-[9px] px-1.5 py-0.2 rounded border font-mono ${
                            preset.isFactory
                              ? 'bg-slate-800/80 text-slate-400 border-slate-700'
                              : 'bg-purple-950/60 text-purple-300 border-purple-800/50'
                          }`}
                        >
                          {preset.category}
                        </span>
                      </div>

                      {preset.description && (
                        <p className="text-[11px] text-slate-400 line-clamp-1 mb-2">
                          {preset.description}
                        </p>
                      )}

                      {/* Sound Badge Attributes */}
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono">
                        <span className="bg-[#12152A] px-1.5 py-0.5 rounded border border-[#252B48] flex items-center gap-1">
                          <Activity className="w-2.5 h-2.5 text-indigo-400" />
                          {oscType}
                        </span>
                        <span className="bg-[#12152A] px-1.5 py-0.5 rounded border border-[#252B48] flex items-center gap-1">
                          <Sliders className="w-2.5 h-2.5 text-pink-400" />
                          {filterType === 'lowpass' ? 'LPF' : filterType === 'highpass' ? 'HPF' : 'BPF'} {Math.round(cutoff)}Hz
                        </span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={(e) => handleAudition(preset, e)}
                        className="p-1.5 rounded-lg bg-[#161B36] hover:bg-indigo-600 text-slate-300 hover:text-white transition-colors border border-[#252B48]"
                        title="Audition Sound (Play Note)"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                      </button>

                      {!preset.isFactory && (
                        <button
                          onClick={(e) => handleDelete(preset.id, preset.name, e)}
                          className="p-1.5 rounded-lg bg-[#161B36] hover:bg-red-600 text-slate-400 hover:text-white transition-colors border border-[#252B48]"
                          title="Delete Custom Preset"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer info */}
        <div className="p-3 border-t border-[#252B48] bg-[#0E1022] flex items-center justify-between text-[11px] text-slate-400">
          <span>Storage: Browser LocalStorage</span>
          <button
            onClick={onClose}
            className="px-3 py-1 bg-[#1A1F3A] hover:bg-[#252B48] text-slate-200 rounded-lg text-xs transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
