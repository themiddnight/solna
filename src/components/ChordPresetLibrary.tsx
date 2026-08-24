import React, { useMemo, useState } from 'react';
import { Download, Music, Play, Sparkles, Trash2, Upload } from 'lucide-react';
import type { ChordItem, SynthParams, CustomChordProgressionItem } from '../types';
import { useAppStore } from '../store/store';
import { CHORD_PROGRESSION_TEMPLATES } from '../audio/data/chordProgressions';
import type { ProgressionTemplate } from '../audio/data/chordProgressions';
import { PresetLibrary } from './ui/PresetLibrary';
import type { PresetLibraryEntry, PresetCategory, PresetLibraryGroup, PresetSaveDraft } from './ui/PresetLibrary';
import { previewChordProgression } from '../audio/playback/presetPreview';
import {
  generateBlockChordNotes,
  reharmonizeProgressionToScale,
  rootSemitone,
  ROOTS,
  formatChordLabel,
} from '../utils/musicTheory';

export type { CustomChordProgressionItem };

// Wrapper entries: factory templates and custom progressions both render through
// the generic; the template pointer is what the onSelect handler transposes.
interface ChordLibraryEntry extends PresetLibraryEntry {
  template?: ProgressionTemplate; // factory templates carry their source
  chords?: ChordItem[];           // custom progressions carry their chords
  roman?: string;                 // custom progressions carry their roman summary (searchable)
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

// The original file's category chip list, rebuilt as PresetCategory[] (the
// original included 'All' as the first chip). The User chip's count badge is
// carried in `count` and rendered by the generic like the original's.
const BASE_CHORD_CATEGORIES: PresetCategory[] = [
  { id: 'All', label: 'All', badgeClass: 'bg-indigo-600 text-white', description: '' },
  { id: 'User', label: 'User', badgeClass: 'bg-indigo-600 text-white', description: '' },
  { id: 'Pop & EDM', label: 'Pop & EDM', badgeClass: 'bg-indigo-600 text-white', description: '' },
  { id: 'Jazz & Neo-Soul', label: 'Jazz & Neo-Soul', badgeClass: 'bg-indigo-600 text-white', description: '' },
  { id: 'Lofi & R&B', label: 'Lofi & R&B', badgeClass: 'bg-indigo-600 text-white', description: '' },
  { id: 'Anime & J-Pop', label: 'Anime & J-Pop', badgeClass: 'bg-indigo-600 text-white', description: '' },
  { id: 'Rock & Blues', label: 'Rock & Blues', badgeClass: 'bg-indigo-600 text-white', description: '' },
  { id: 'Cinematic & Modal', label: 'Cinematic & Modal', badgeClass: 'bg-indigo-600 text-white', description: '' },
  { id: 'Classical & Baroque', label: 'Classical & Baroque', badgeClass: 'bg-indigo-600 text-white', description: '' },
];

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
  const saveProgression = useAppStore((s) => s.saveCustomChordProgression);
  const deleteProgression = useAppStore((s) => s.deleteCustomChordProgression);
  const [auditioningName, setAuditioningName] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg(null), 3000);
  };

  const entries = useMemo<ChordLibraryEntry[]>(
    () => [
      ...customProgressions.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        description: p.description,
        isFactory: false,
        chords: p.chords,
        roman: p.roman,
      })),
      ...CHORD_PROGRESSION_TEMPLATES.map((t) => ({
        id: `factory-${t.name}`,
        name: t.name,
        category: t.category,
        description: t.description,
        isFactory: true,
        template: t,
      })),
    ],
    [customProgressions],
  );

  const categories = useMemo<PresetCategory[]>(
    () =>
      BASE_CHORD_CATEGORIES.map((c) =>
        c.id === 'User' && customProgressions.length > 0
          ? { ...c, count: String(customProgressions.length) }
          : c
      ),
    [customProgressions]
  );

  // PORT of the original filteredTemplates + filteredCustom predicates: the
  // 'User' chip shows every custom progression regardless of its saved category
  // and hides factory templates; search covers name, roman, and description.
  const filterEntries = (e: ChordLibraryEntry, query: string, categoryId: string) => {
    const matchesCategory =
      categoryId === 'All'
        ? true
        : categoryId === 'User'
        ? !e.isFactory
        : e.category === categoryId;

    const matchesSearch =
      query.trim() === '' ||
      e.name.toLowerCase().includes(query.toLowerCase()) ||
      (e.template ? e.template.roman : e.roman ?? '').toLowerCase().includes(query.toLowerCase()) ||
      e.description.toLowerCase().includes(query.toLowerCase());

    return matchesCategory && matchesSearch;
  };

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

  // PORT of the original Apply handlers: resolve (transpose/reharmonize), apply, and close.
  const applyEntry = (entry: ChordLibraryEntry) => {
    if (entry.template) {
      const resolved = resolveTemplateChords(entry.template);
      onApplyChords(resolved);
      onClose();
    } else if (entry.chords) {
      const resolved = resolveCustomChords(entry.chords);
      onApplyChords(resolved);
      onClose();
    }
  };

  // PORT of the original handleAudition: engine trigger moved to
  // presetPreview.ts; the auditioning-name pulse state stays here.
  const handleAudition = (chordsToPlay: ChordItem[], progName: string) => {
    previewChordProgression(chordsToPlay, synthParams);
    setAuditioningName(progName);
    window.setTimeout(() => {
      setAuditioningName(null);
    }, chordsToPlay.length * 500 + 200);
  };

  const handleDeleteCustom = (id: string, name: string) => {
    if (confirm(`Delete custom progression "${name}"?`)) {
      deleteProgression(id);
    }
  };

  // PORT of the original save handler: the roman default is the original's
  // romanSummary computed from currentChords; the user's typed roman (a field
  // the plan's generic adds) wins when provided.
  const handleSave = (draft: PresetSaveDraft): boolean => {
    // Original guard: refuse to save when nothing is on the grid. Returning
    // false keeps the save modal open (the generic only closes on true).
    if (currentChords.length === 0) return false;
    const saved = saveProgression(
      draft.name.trim(),
      currentChords,
      draft.category,
      draft.description.trim(),
      draft.roman?.trim()
        ? draft.roman
        : currentChords.map((c) => formatChordLabel(c.root, c.quality)).join(' → ')
    );
    // saved.name is the trimmed name passed above, so the toast shows it trimmed.
    showToast(`Progression "${saved.name}" saved!`);
    return true;
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
              useAppStore.getState().saveCustomChordProgression(
                item.name,
                item.chords,
                item.category,
                item.description,
                item.roman
              );
            });
          showToast(`Imported ${imported.length} chord progressions!`);
        }
      } catch {
        alert('Invalid JSON chord progression file');
      }
    };
    reader.readAsText(file);
  };

  // PORT of the original two-section list (original lines ~330-501):
  // custom section with purple header, template section with "Key: {scaleRoot}".
  const groupEntries = (
    filtered: ChordLibraryEntry[],
    _query: string,
    category: string
  ): PresetLibraryGroup<ChordLibraryEntry>[] => {
    const groups: PresetLibraryGroup<ChordLibraryEntry>[] = [];
    const filteredCustom = filtered.filter((e) => !e.isFactory);
    const filteredTemplates = filtered.filter((e) => !!e.isFactory);

    if (filteredCustom.length > 0) {
      groups.push({
        key: 'custom',
        className: 'space-y-2 pb-2',
        header: (
          <div className="flex items-center justify-between text-[11px] font-bold text-purple-400 uppercase tracking-wider px-1">
            <span>My Custom Progressions ({filteredCustom.length})</span>
          </div>
        ),
        entries: filteredCustom,
      });
    }

    if (filteredTemplates.length > 0 && category !== 'User') {
      groups.push({
        key: 'templates',
        className: 'space-y-2 pt-2',
        header: (
          <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-wider px-1">
            <span>Standard Library Templates ({filteredTemplates.length})</span>
            <span className="text-[10px] font-normal font-mono text-indigo-400">
              Key: {scaleRoot}
            </span>
          </div>
        ),
        entries: filteredTemplates,
      });
    }

    return groups;
  };

  // PORT of the original empty state (original lines ~428-432).
  const emptyState = () => (
    <div className="p-8 text-center text-slate-500 space-y-2">
      <Music className="w-8 h-8 mx-auto opacity-40 text-slate-400" />
      <p className="text-xs">No chord progressions found matching your filter.</p>
    </div>
  );

  // PORT of the original template card (original lines ~435-499): name row with
  // category tag + Auto badge, roman line, description, "In {scaleRoot}:" preview
  // line, audition (indigo pulse) + Load buttons.
  const renderTemplateCard = (e: ChordLibraryEntry) => {
    const tpl = e.template!;
    const resolvedChords = resolveTemplateChords(tpl);
    const previewNames = resolvedChords.map((c) => formatChordLabel(c.root, c.quality)).join(' → ');

    return (
      <div className="p-3 rounded-xl bg-[#0B0D19] border border-[#252B48] hover:border-indigo-500/50 transition-all flex flex-col gap-2 group relative shadow-xs">
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
              onClick={() => handleAudition(resolvedChords, tpl.name)}
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
  };

  // PORT of the original custom card (original lines ~338-411): name row with
  // Custom tag + Auto badge, roman line, description, "In {scaleRoot} {scaleType}:"
  // preview line, audition (purple pulse) + Load + Delete buttons.
  const renderCustomCard = (e: ChordLibraryEntry) => {
    const chords = e.chords!;
    const resolvedCustom = resolveCustomChords(chords);
    const previewNames = resolvedCustom.map((c) => formatChordLabel(c.root, c.quality)).join(' → ');

    return (
      <div className="p-3 rounded-xl bg-[#0B0D19] border border-[#2D355A] hover:border-purple-500/50 transition-all flex flex-col gap-2 group relative shadow-xs">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-xs text-slate-200 truncate">
                {e.name}
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
              {e.roman}
            </div>
            {e.description && (
              <p className="text-[10px] text-slate-400 mt-1 line-clamp-1">
                {e.description}
              </p>
            )}
            <div className="text-[10px] font-mono text-slate-500 mt-1">
              In {scaleRoot} {scaleType}: <span className="text-slate-300 font-semibold">{previewNames}</span>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0 pt-0.5">
            {/* Play/Audition Button */}
            <button
              onClick={() => handleAudition(resolvedCustom, e.name)}
              className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                auditioningName === e.name
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
              onClick={() => handleDeleteCustom(e.id, e.name)}
              className="p-1.5 rounded-lg bg-[#171B36] hover:bg-red-950/80 text-slate-400 hover:text-red-400 border border-[#2D355A] hover:border-red-800/50 transition-colors cursor-pointer"
              title="Delete Custom Progression"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderEntry = (e: ChordLibraryEntry) => {
    if (e.template) return renderTemplateCard(e);
    return renderCustomCard(e);
  };

  // PORT of the original footer (original lines ~504-530): labeled Export/Import
  // buttons + "{N} custom saved" counter.
  const footer = (
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
  );

  return (
    <PresetLibrary
      isOpen={isOpen}
      onClose={onClose}
      title="Chord Progression Manager"
      headerSubtitle={`Key of ${scaleRoot} • ${CHORD_PROGRESSION_TEMPLATES.length + customProgressions.length} Total Progressions`}
      saveButton={{ label: 'Save Current', title: 'Save current chord progression' }}
      toast={toastMsg}
      toastPlacement="top"
      variant="chord"
      searchPlaceholder="Search by name, Roman numerals (ii-V-I, vi-IV-I-V)..."
      entries={entries}
      categories={categories}
      listContainerClass="flex-1 overflow-y-auto p-3.5 space-y-2.5 divide-y divide-[#1C213E]/60"
      groupEntries={groupEntries}
      renderEntry={renderEntry}
      emptyState={emptyState}
      filterEntries={filterEntries}
      footer={footer}
      save={{
        heading: 'Save Progression Preset',
        buttonLabel: 'Save Progression',
        withCategory: true,
        withDescription: true,
        withRoman: true,
        defaultCategory: 'User',
        variant: 'modal',
        chordsSummary: {
          count: currentChords.length,
          text: currentChords.map((c) => formatChordLabel(c.root, c.quality)).join(' → '),
        },
      }}
      onSelect={applyEntry}
      onDelete={(id) => {
        const entry = entries.find((en) => en.id === id);
        if (entry && confirm(`Delete custom progression "${entry.name}"?`)) {
          deleteProgression(id);
        }
      }}
      onSave={handleSave}
    />
  );
};
