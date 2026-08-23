import React, { useState } from 'react';
import {
  Sparkles,
  Bookmark,
  Plus,
  Trash2,
  Search,
  Check,
  X,
  FolderOpen,
  Download,
  Upload,
  Play,
  Music,
  Layers,
} from 'lucide-react';
import { ChordItem, SynthParams } from '../types';
import type { CustomChordProgressionItem } from '../types';
import { useAppStore } from '../store/store';
import {
  ProgressionTemplate,
  CHORD_PROGRESSION_TEMPLATES,
} from './ChordView';
import { audioEngine } from '../audio/engine';
import { generateBlockChordNotes, reharmonizeProgressionToScale, rootSemitone, ROOTS, formatChordLabel } from '../utils/musicTheory';

export type { CustomChordProgressionItem };

export function getCustomChordProgressions(): CustomChordProgressionItem[] {
  return useAppStore.getState().customChordProgressions;
}

export function saveCustomChordProgression(
  name: string,
  chords: ChordItem[],
  category = 'User',
  description = '',
  roman = ''
): CustomChordProgressionItem {
  return useAppStore
    .getState()
    .saveCustomChordProgression(name, chords, category, description, roman);
}

export function deleteCustomChordProgression(id: string): CustomChordProgressionItem[] {
  return useAppStore.getState().deleteCustomChordProgression(id);
}

interface ChordPresetLibraryProps {
  currentChords: ChordItem[];
  scaleRoot: string;
  scaleType: string;
  autoReharmonize: boolean;
  synthParams: SynthParams;
  onApplyChords: (chords: ChordItem[]) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const ChordPresetLibrary: React.FC<ChordPresetLibraryProps> = ({
  currentChords,
  scaleRoot,
  scaleType,
  autoReharmonize,
  synthParams,
  onApplyChords,
  isOpen,
  onClose,
}) => {
  const customProgressions = useAppStore((s) => s.customChordProgressions);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showSaveModal, setShowSaveModal] = useState<boolean>(false);
  const [newProgName, setNewProgName] = useState<string>('');
  const [newProgCategory, setNewProgCategory] = useState<string>('User');
  const [newProgDesc, setNewProgDesc] = useState<string>('');
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [auditioningName, setAuditioningName] = useState<string | null>(null);

  const categories = [
    'All',
    'User',
    'Pop & EDM',
    'Jazz & Neo-Soul',
    'Lofi & R&B',
    'Anime & J-Pop',
    'Rock & Blues',
    'Cinematic & Modal',
    'Classical & Baroque',
  ];

  // Helper to convert template into chords transposed to scaleRoot and optionally auto-reharmonized
  const resolveTemplateChords = (template: ProgressionTemplate): ChordItem[] => {
    const baseRootIndex = rootSemitone(scaleRoot);
    let chords: ChordItem[] = template.relativeChords.map((rc, i) => {
      const transposedRoot = ROOTS[(baseRootIndex + rc.interval) % 12];
      return {
        id: `tpl-chord-${Date.now()}-${i}`,
        root: transposedRoot,
        quality: rc.quality,
        bars: rc.bars,
        notes: generateBlockChordNotes(rc.quality, transposedRoot, 4),
      };
    });

    if (autoReharmonize) {
      chords = reharmonizeProgressionToScale(chords, scaleRoot, scaleType);
    }
    return chords;
  };

  const resolveCustomChords = (customChords: ChordItem[]): ChordItem[] => {
    let chords = customChords.map((c, i) => ({
      ...c,
      id: c.id || `custom-chord-${Date.now()}-${i}`,
      notes: generateBlockChordNotes(c.quality, c.root, 4),
    }));

    if (autoReharmonize) {
      chords = reharmonizeProgressionToScale(chords, scaleRoot, scaleType);
    }
    return chords;
  };

  // Filter Factory Templates
  const filteredTemplates = CHORD_PROGRESSION_TEMPLATES.filter((tpl) => {
    const matchesCategory =
      selectedCategory === 'All'
        ? true
        : selectedCategory === 'User'
        ? false
        : tpl.category === selectedCategory;

    const matchesSearch =
      searchQuery.trim() === '' ||
      tpl.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tpl.roman.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tpl.description.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesCategory && matchesSearch;
  });

  // Filter User Progressions
  const filteredCustom = customProgressions.filter((item) => {
    const matchesCategory =
      selectedCategory === 'All' || selectedCategory === 'User' || item.category === selectedCategory;

    const matchesSearch =
      searchQuery.trim() === '' ||
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.roman.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesCategory && matchesSearch;
  });

  const handleSaveCurrentProgression = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProgName.trim() || currentChords.length === 0) return;

    const romanSummary = currentChords.map((c) => formatChordLabel(c.root, c.quality)).join(' → ');
    const saved = saveCustomChordProgression(
      newProgName.trim(),
      currentChords,
      newProgCategory,
      newProgDesc.trim(),
      romanSummary
    );

    setShowSaveModal(false);
    setNewProgName('');
    setNewProgDesc('');
    setSaveSuccessMsg(`Progression "${saved.name}" saved!`);
    setTimeout(() => setSaveSuccessMsg(null), 3000);
  };

  const handleDeleteCustom = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Delete custom progression "${name}"?`)) {
      deleteCustomChordProgression(id);
    }
  };

  const handleAudition = (chordsToPlay: ChordItem[], progName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    audioEngine.init();
    setAuditioningName(progName);

    // Play quick arpeggiated strum of all chords in sequence
    const chordDurationMs = 500;
    chordsToPlay.forEach((chord, chordIdx) => {
      setTimeout(() => {
        chord.notes.forEach((n) => {
          audioEngine.triggerSynthNoteOn(n, synthParams, 0.75);
        });

        setTimeout(() => {
          chord.notes.forEach((n) => {
            audioEngine.triggerSynthNoteOff(n, 0.3);
          });
        }, chordDurationMs * 0.85);
      }, chordIdx * chordDurationMs);
    });

    setTimeout(() => {
      setAuditioningName(null);
    }, chordsToPlay.length * chordDurationMs + 200);
  };

  const handleExport = () => {
    const dataStr =
      'data:text/json;charset=utf-8,' +
      encodeURIComponent(JSON.stringify(customProgressions, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute(
      'download',
      `murva-chord-progressions-${new Date().toISOString().slice(0, 10)}.json`
    );
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
            .forEach((item: CustomChordProgressionItem) => {
              saveCustomChordProgression(
                item.name,
                item.chords,
                item.category,
                item.description,
                item.roman
              );
            });
          setSaveSuccessMsg(`Imported ${imported.length} chord progressions!`);
          setTimeout(() => setSaveSuccessMsg(null), 3000);
        }
      } catch (err) {
        alert('Invalid JSON chord progression file');
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
                Chord Progression Manager
              </h3>
              <p className="text-[11px] text-slate-400">
                Key of {scaleRoot} • {CHORD_PROGRESSION_TEMPLATES.length + customProgressions.length} Total Progressions
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowSaveModal(true)}
              className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer shadow-xs"
              title="Save current chord progression"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Save Current</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-[#1A1F3B] hover:bg-[#252B48] text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Save Success Toast */}
        {saveSuccessMsg && (
          <div className="mx-4 mt-3 p-2 bg-emerald-950/80 border border-emerald-500/40 rounded-lg text-xs text-emerald-300 flex items-center gap-2 animate-in fade-in">
            <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>{saveSuccessMsg}</span>
          </div>
        )}

        {/* Search & Filter Toolbar */}
        <div className="p-3.5 border-b border-[#252B48] space-y-2.5 bg-[#0F1226]">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by name, Roman numerals (ii-V-I, vi-IV-I-V)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#0B0D19] border border-[#252B48] rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 text-xs"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Category Filter Badges */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  selectedCategory === cat
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-[#0B0D19] hover:bg-[#1A1F3B] text-slate-400 hover:text-slate-200 border border-[#252B48]'
                }`}
              >
                {cat}
                {cat === 'User' && customProgressions.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full bg-indigo-900/80 text-[10px]">
                    {customProgressions.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Progression List Content */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5 divide-y divide-[#1C213E]/60">
          {/* User Custom Progressions Section */}
          {filteredCustom.length > 0 && (
            <div className="space-y-2 pb-2">
              <div className="flex items-center justify-between text-[11px] font-bold text-purple-400 uppercase tracking-wider px-1">
                <span>My Custom Progressions ({filteredCustom.length})</span>
              </div>
              <div className="space-y-2">
                {filteredCustom.map((item) => {
                  const resolvedCustom = resolveCustomChords(item.chords);
                  const previewNames = resolvedCustom.map((c) => formatChordLabel(c.root, c.quality)).join(' → ');

                  return (
                    <div
                      key={item.id}
                      className="p-3 rounded-xl bg-[#0B0D19] border border-[#2D355A] hover:border-purple-500/50 transition-all flex flex-col gap-2 group relative shadow-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-xs text-slate-200 truncate">
                              {item.name}
                            </span>
                            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-purple-950/80 border border-purple-800 text-purple-300">
                              Custom
                            </span>
                            {autoReharmonize && (
                              <span className="text-[9px] font-semibold text-purple-300 bg-purple-500/20 px-1.5 py-0.2 rounded border border-purple-500/30 flex items-center gap-0.5">
                                <Sparkles className="w-2.5 h-2.5 text-purple-400" /> Auto
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-indigo-400 font-semibold mt-0.5">
                            {item.roman}
                          </div>
                          {item.description && (
                            <p className="text-[10px] text-slate-400 mt-1 line-clamp-1">
                              {item.description}
                            </p>
                          )}
                          <div className="text-[10px] font-mono text-slate-500 mt-1">
                            In {scaleRoot} {scaleType}: <span className="text-slate-300 font-semibold">{previewNames}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0 pt-0.5">
                          {/* Play/Audition Button */}
                          <button
                            onClick={(e) => handleAudition(resolvedCustom, item.name, e)}
                            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                              auditioningName === item.name
                                ? 'bg-purple-600 border-purple-400 text-white animate-pulse'
                                : 'bg-[#171B36] hover:bg-[#20264A] text-purple-400 border-[#2D355A]'
                            }`}
                            title="Audition Progression Sound"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                          </button>

                          {/* Apply Button */}
                          <button
                            onClick={() => {
                              onApplyChords(resolvedCustom);
                              onClose();
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer flex items-center gap-1"
                          >
                            <span>Load</span>
                          </button>

                          {/* Delete Button */}
                          <button
                            onClick={(e) => handleDeleteCustom(item.id, item.name, e)}
                            className="p-1.5 rounded-lg bg-[#171B36] hover:bg-red-950/80 text-slate-400 hover:text-red-400 border border-[#2D355A] hover:border-red-800/50 transition-colors cursor-pointer"
                            title="Delete Custom Progression"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Standard Progression Templates Section */}
          <div className="space-y-2 pt-2">
            {selectedCategory !== 'User' && (
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-wider px-1">
                <span>Standard Library Templates ({filteredTemplates.length})</span>
                <span className="text-[10px] font-normal font-mono text-indigo-400">
                  Key: {scaleRoot}
                </span>
              </div>
            )}

            {filteredTemplates.length === 0 && filteredCustom.length === 0 ? (
              <div className="p-8 text-center text-slate-500 space-y-2">
                <Music className="w-8 h-8 mx-auto opacity-40 text-slate-400" />
                <p className="text-xs">No chord progressions found matching your filter.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredTemplates.map((tpl) => {
                  const resolvedChords = resolveTemplateChords(tpl);
                  const previewNames = resolvedChords.map((c) => formatChordLabel(c.root, c.quality)).join(' → ');

                  return (
                    <div
                      key={tpl.name}
                      className="p-3 rounded-xl bg-[#0B0D19] border border-[#252B48] hover:border-indigo-500/50 transition-all flex flex-col gap-2 group shadow-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-xs text-slate-200 group-hover:text-indigo-300 transition-colors truncate">
                              {tpl.name}
                            </span>
                            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[#1C213E] text-indigo-300 shrink-0">
                              {tpl.category}
                            </span>
                            {autoReharmonize && (
                              <span className="text-[9px] font-semibold text-purple-300 bg-purple-500/20 px-1.5 py-0.2 rounded border border-purple-500/30 flex items-center gap-0.5">
                                <Sparkles className="w-2.5 h-2.5 text-purple-400" /> Auto
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-purple-400 font-semibold mt-0.5">
                            {tpl.roman}
                          </div>
                          <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">
                            {tpl.description}
                          </p>
                          <div className="text-[10px] font-mono text-slate-500 mt-1">
                            In {scaleRoot}: <span className="text-slate-300 font-semibold">{previewNames}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                          {/* Audition Play Button */}
                          <button
                            onClick={(e) => handleAudition(resolvedChords, tpl.name, e)}
                            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                              auditioningName === tpl.name
                                ? 'bg-indigo-600 border-indigo-400 text-white animate-pulse'
                                : 'bg-[#171B36] hover:bg-[#20264A] text-indigo-400 border-[#2D355A]'
                            }`}
                            title="Audition Sound"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                          </button>

                          {/* Apply Button */}
                          <button
                            onClick={() => {
                              onApplyChords(resolvedChords);
                              onClose();
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer flex items-center gap-1"
                          >
                            <span>Load</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Drawer Footer: Import / Export */}
        <div className="p-3 border-t border-[#252B48] bg-[#0E1022] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              disabled={customProgressions.length === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#1A1F3B] hover:bg-[#252B48] disabled:opacity-40 text-slate-300 hover:text-white text-xs font-medium border border-[#2D355A] transition-colors cursor-pointer"
              title="Export user chord progressions as JSON"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
            </button>

            <label
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#1A1F3B] hover:bg-[#252B48] text-slate-300 hover:text-white text-xs font-medium border border-[#2D355A] transition-colors cursor-pointer"
              title="Import chord progressions from JSON"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import</span>
              <input type="file" accept=".json" onChange={handleImport} className="hidden" />
            </label>
          </div>

          <span className="text-[10px] text-slate-500 font-mono">
            {customProgressions.length} custom saved
          </span>
        </div>
      </div>

      {/* Save Progression Modal Dialog */}
      {showSaveModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm bg-[#171B38] border border-indigo-500/40 rounded-xl p-5 shadow-2xl space-y-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-indigo-400" />
                Save Progression Preset
              </h4>
              <button
                onClick={() => setShowSaveModal(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCurrentProgression} className="space-y-3">
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">Progression Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. My Epic Verse Flow"
                  value={newProgName}
                  onChange={(e) => setNewProgName(e.target.value)}
                  className="w-full bg-[#0B0D19] border border-[#2D355A] rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-400 block mb-1">Category</label>
                <select
                  value={newProgCategory}
                  onChange={(e) => setNewProgCategory(e.target.value)}
                  className="w-full bg-[#0B0D19] border border-[#2D355A] rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                >
                  <option value="User">User</option>
                  <option value="Pop & EDM">Pop & EDM</option>
                  <option value="Jazz & Neo-Soul">Jazz & Neo-Soul</option>
                  <option value="Lofi & R&B">Lofi & R&B</option>
                  <option value="Anime & J-Pop">Anime & J-Pop</option>
                  <option value="Rock & Blues">Rock & Blues</option>
                  <option value="Cinematic & Modal">Cinematic & Modal</option>
                  <option value="Classical & Baroque">Classical & Baroque</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] text-slate-400 block mb-1">Description (Optional)</label>
                <input
                  type="text"
                  placeholder="Notes about groove, tempo, or feel..."
                  value={newProgDesc}
                  onChange={(e) => setNewProgDesc(e.target.value)}
                  className="w-full bg-[#0B0D19] border border-[#2D355A] rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="p-2.5 rounded-lg bg-[#0B0D19] border border-[#252B48] text-[11px] text-slate-400">
                <span className="font-mono text-indigo-300 block mb-0.5">
                  Chords ({currentChords.length}):
                </span>
                <span className="font-semibold text-slate-200">
                  {currentChords.map((c) => formatChordLabel(c.root, c.quality)).join(' → ')}
                </span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSaveModal(false)}
                  className="px-3 py-1.5 rounded-lg bg-[#0B0D19] text-slate-400 hover:text-slate-200 text-xs border border-[#252B48]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs"
                >
                  Save Progression
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
