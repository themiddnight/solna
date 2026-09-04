import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Music, Play, Sparkles, Trash2, Upload } from 'lucide-react';
import type { ChordItem, SynthParams, CustomChordProgressionItem } from '../../types';
import { useAppStore } from '../../store/store';
import { CHORD_PROGRESSIONS, resolveProgression } from '../../audio/data/chordProgressions';
import type { ChordProgression } from '../../audio/data/chordProgressions';
import { PresetLibrary } from '../ui/PresetLibrary';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { IconButton } from '../ui/IconButton';
import type { PresetLibraryEntry, PresetCategory, PresetLibraryGroup, PresetSaveDraft } from '../ui/PresetLibrary';
import { previewChordProgression } from '../../audio/playback/presetPreview';
import type { PreviewHandle } from '../../audio/playback/presetPreview';
import {
  generateBlockChordNotes,
  snapProgressionToScale,
  formatChordLabel,
} from '../../utils/musicTheory';
import { isProgressionAvailable } from './chord/progressionAvailability';

export { isProgressionAvailable };
export type { CustomChordProgressionItem };

/**
 * Audition button fill for the template-progression card. `IconButton`
 * always adds `btn-ghost`, which zeroes `--btn-bg` — so the auditioning
 * (filled, pulsing) branch has to restore it explicitly rather than relying
 * on `.btn`'s default fallback to `--btn-color`, the way the un-converted
 * button used to. Exported so the fill can be pinned by a literal-string
 * test without rendering the whole card in that (otherwise unreachable via
 * renderToString) local-state branch.
 */
export function templateAuditionClassName(isAuditioning: boolean): string {
  return isAuditioning
    ? '[--btn-bg:var(--color-module-chord)] [--btn-color:var(--color-module-chord)] [--btn-fg:var(--color-module-chord-content)] animate-pulse'
    : 'btn-ghost text-module-chord';
}

/** Same fix, for the custom-progression card's audition button. */
export function customAuditionClassName(isAuditioning: boolean): string {
  return isAuditioning ? 'btn-secondary [--btn-bg:var(--color-secondary)] animate-pulse' : 'btn-ghost text-secondary';
}


// Wrapper entries: factory templates and custom progressions both render through
// the generic; the template pointer is what the onSelect handler transposes.
interface ChordLibraryEntry extends PresetLibraryEntry {
  progression?: ChordProgression; // factory entries carry their library entry
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
  { id: 'All', label: 'All', badgeClass: 'badge badge-primary', description: '' },
  { id: 'User', label: 'User', badgeClass: 'badge badge-primary', description: '' },
  { id: 'Pop & EDM', label: 'Pop & EDM', badgeClass: 'badge badge-primary', description: '' },
  { id: 'Jazz & Neo-Soul', label: 'Jazz & Neo-Soul', badgeClass: 'badge badge-primary', description: '' },
  { id: 'Lofi & R&B', label: 'Lofi & R&B', badgeClass: 'badge badge-primary', description: '' },
  { id: 'Anime & J-Pop', label: 'Anime & J-Pop', badgeClass: 'badge badge-primary', description: '' },
  { id: 'Rock & Blues', label: 'Rock & Blues', badgeClass: 'badge badge-primary', description: '' },
  { id: 'Cinematic & Modal', label: 'Cinematic & Modal', badgeClass: 'badge badge-primary', description: '' },
  { id: 'Classical & Baroque', label: 'Classical & Baroque', badgeClass: 'badge badge-primary', description: '' },
  { id: 'Ambient & Zen', label: 'Ambient & Zen', badgeClass: 'badge badge-primary', description: '' },
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
  const [toastTone, setToastTone] = useState<'success' | 'error'>('success');
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const previewRef = useRef<PreviewHandle | null>(null);
  useEffect(() => () => previewRef.current?.(), []);

  const showToast = (msg: string, tone: 'success' | 'error' = 'success') => {
    setToastTone(tone);
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
      ...CHORD_PROGRESSIONS.filter((p) => isProgressionAvailable(p, scaleType)).map((p) => ({
        id: `factory-${p.id}`,
        name: p.name,
        category: p.category,
        description: p.description,
        isFactory: true,
        progression: p,
      })),
    ],
    [customProgressions, scaleType],
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
  // Stable identity — see the note in SynthPresetLibrary. The body reads
  // only its own arguments, so [] is complete.
  const filterEntries = useCallback((e: ChordLibraryEntry, query: string, categoryId: string) => {
    const matchesCategory =
      categoryId === 'All'
        ? true
        : categoryId === 'User'
        ? !e.isFactory
        : e.category === categoryId;

    const matchesSearch =
      query.trim() === '' ||
      e.name.toLowerCase().includes(query.toLowerCase()) ||
      (e.progression ? e.progression.roman : e.roman ?? '').toLowerCase().includes(query.toLowerCase()) ||
      e.description.toLowerCase().includes(query.toLowerCase());

    return matchesCategory && matchesSearch;
  }, []);

  // Degree form has no other resolution: the result is in the active key and
  // scale by construction, so this is NOT gated on autoReharmonize any more
  // (and factory cards no longer show the "Auto" badge).
  const resolveFactoryChords = (progression: ChordProgression): ChordItem[] =>
    resolveProgression(progression, scaleRoot, scaleType, 4);

  const resolveCustomChords = (customChords: ChordItem[]): ChordItem[] => {
    let chords = customChords.map((c, i) => ({
      ...c,
      id: c.id || `custom-chord-${Date.now()}-${i}`,
      notes: generateBlockChordNotes(c.quality, c.root, 4),
    }));

    if (autoReharmonize) {
      chords = snapProgressionToScale(chords, scaleRoot, scaleType);
    }
    return chords;
  };

  // PORT of the original Apply handlers: resolve (transpose/reharmonize), apply, and close.
  const applyEntry = (entry: ChordLibraryEntry) => {
    if (entry.progression) {
      const resolved = resolveFactoryChords(entry.progression);
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
    previewRef.current?.();
    previewRef.current = previewChordProgression(chordsToPlay, synthParams);
    setAuditioningName(progName);
    window.setTimeout(() => {
      setAuditioningName(null);
    }, chordsToPlay.length * 500 + 200);
  };

  const handleDeleteCustom = (id: string, name: string) => {
    setPendingDelete({ id, name });
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
      `musibox-chord-progressions-${new Date().toISOString().slice(0, 10)}.json`
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
        showToast('Invalid JSON chord progression file', 'error');
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
          <div className="flex items-center justify-between text-[11px] font-bold text-secondary uppercase tracking-wider px-1">
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
          <div className="flex items-center justify-between text-[11px] font-bold text-base-content/60 uppercase tracking-wider px-1">
            <span>Standard Library Templates ({filteredTemplates.length})</span>
            <span className="text-[10px] font-normal font-mono text-module-chord">
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
    <div className="p-8 text-center text-base-content/50 space-y-2">
      <Music className="w-8 h-8 mx-auto opacity-40 text-base-content/60" />
      <p className="text-xs">No chord progressions found matching your filter.</p>
    </div>
  );

  // PORT of the original template card (original lines ~435-499): name row with
  // category tag + Auto badge, roman line, description, "In {scaleRoot}:" preview
  // line, audition (indigo pulse) + Load buttons.
  const renderTemplateCard = (e: ChordLibraryEntry) => {
    const progression = e.progression!;
    const resolvedChords = resolveFactoryChords(progression);
    const previewNames = resolvedChords.map((c) => formatChordLabel(c.root, c.quality)).join(' → ');

    return (
      <div className="card bg-base-200 border border-base-300 hover:border-module-chord/50 p-3 transition-all flex flex-col gap-2 group relative shadow-xs">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-bold text-xs text-base-content group-hover:text-module-chord transition-colors truncate">
                {progression.name}
              </span>
              <span className="badge badge-sm bg-base-300 text-module-chord py-0.5 shrink-0">
                {progression.category}
              </span>
            </div>
            <div className="text-[11px] font-mono text-secondary font-semibold mt-0.5">
              {progression.roman}
            </div>
            <p className="text-[11px] text-base-content/60 mt-1 line-clamp-2">
              {progression.description}
            </p>
            <div className="text-[10px] font-mono text-base-content/50 mt-1">
              In {scaleRoot}: <span className="text-base-content font-semibold">{previewNames}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
            {/* Audition Play Button */}
            <IconButton
              label="Audition Sound"
              icon={<Play className="w-3.5 h-3.5 fill-current" />}
              size="xs"
              className={templateAuditionClassName(auditioningName === progression.name)}
              onClick={() => handleAudition(resolvedChords, progression.name)}
            />

            {/* Apply Button */}
            <button
              onClick={() => {
                onApplyChords(resolvedChords);
                onClose();
              }}
              className="btn btn-xs gap-1 [--btn-color:var(--color-module-chord)] [--btn-fg:var(--color-module-chord-content)]"
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
      <div className="card bg-base-200 border border-base-300 hover:border-secondary/50 p-3 transition-all flex flex-col gap-2 group relative shadow-xs">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-xs text-base-content truncate">
                {e.name}
              </span>
              <span className="badge badge-sm badge-secondary badge-outline py-0.5">
                Custom
              </span>
              {autoReharmonize && (
                <span className="badge badge-sm badge-secondary badge-outline py-0.5 gap-0.5">
                  <Sparkles className="w-2.5 h-2.5 text-secondary" /> Auto
                </span>
              )}
            </div>
            <div className="text-[11px] font-mono text-module-chord font-semibold mt-0.5">
              {e.roman}
            </div>
            {e.description && (
              <p className="text-[10px] text-base-content/60 mt-1 line-clamp-1">
                {e.description}
              </p>
            )}
            <div className="text-[10px] font-mono text-base-content/50 mt-1">
              In {scaleRoot} {scaleType}: <span className="text-base-content font-semibold">{previewNames}</span>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0 pt-0.5">
            {/* Play/Audition Button */}
            <IconButton
              label="Audition Progression Sound"
              icon={<Play className="w-3.5 h-3.5 fill-current" />}
              size="xs"
              className={customAuditionClassName(auditioningName === e.name)}
              onClick={() => handleAudition(resolvedCustom, e.name)}
            />

            {/* Apply Button */}
            <button
              onClick={() => {
                onApplyChords(resolvedCustom);
                onClose();
              }}
              className="btn btn-xs gap-1 [--btn-color:var(--color-module-chord)] [--btn-fg:var(--color-module-chord-content)]"
            >
              <span>Load</span>
            </button>

            {/* Delete Button */}
            <IconButton
              label="Delete Custom Progression"
              icon={<Trash2 className="w-3.5 h-3.5" />}
              size="xs"
              className="hover:btn-error"
              onClick={() => handleDeleteCustom(e.id, e.name)}
            />
          </div>
        </div>
      </div>
    );
  };

  const renderEntry = (e: ChordLibraryEntry) => {
    if (e.progression) return renderTemplateCard(e);
    return renderCustomCard(e);
  };

  // PORT of the original footer (original lines ~504-530): labeled Export/Import
  // buttons + "{N} custom saved" counter. Guarded on isOpen: PresetLibrary
  // itself bails to null while closed, but without this guard this ~10-node
  // tree was still built and discarded on every parent render regardless —
  // at pointer rate during a knob drag (App-level synthParams cascade) and
  // 8x/sec during chord playback (currentStep).
  const footer = !isOpen ? null : (
    <div className="p-3 border-t border-base-300 bg-base-200 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <button
          onClick={handleExport}
          disabled={customProgressions.length === 0}
          className="btn btn-sm btn-ghost gap-1 hover:text-base-content disabled:opacity-40"
          title="Export user chord progressions as JSON"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export</span>
        </button>

        <label
          className="btn btn-sm btn-ghost gap-1 hover:text-base-content disabled:opacity-40"
          title="Import chord progressions from JSON"
        >
          <Upload className="w-3.5 h-3.5" />
          <span>Import</span>
          <input type="file" accept=".json" onChange={handleImport} className="hidden" />
        </label>
      </div>

      <span className="text-[10px] text-base-content/50 tabular-nums">
        {customProgressions.length} custom saved
      </span>
    </div>
  );

  return (
    <>
      <PresetLibrary
        isOpen={isOpen}
        onClose={onClose}
        title="Progression Library"
        headerSubtitle={`Key of ${scaleRoot} • ${entries.length} Total Progressions`}
        saveButton={{ label: 'Save Current', title: 'Save current chord progression' }}
        toast={toastMsg}
        toastPlacement="top"
        toastTone={toastTone}
        variant="chord"
        searchPlaceholder="Search by name, Roman numerals (ii-V-I, vi-IV-I-V)..."
        entries={entries}
        categories={categories}
        listContainerClass="flex-1 overflow-y-auto p-3.5 space-y-2.5 divide-y divide-base-300/60"
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
          if (entry) setPendingDelete({ id, name: entry.name });
        }}
        onSave={handleSave}
      />
      {pendingDelete && (
        <ConfirmDialog
          title="Delete progression"
          message={<>Delete custom progression <strong>{pendingDelete.name}</strong>?</>}
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            deleteProgression(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
};
