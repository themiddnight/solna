import React, { useMemo, useState } from 'react';
import { Bookmark, Check, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';

export interface PresetLibraryEntry {
  id: string;
  name: string;
  category: string;
  description: string;
  isFactory?: boolean;
}

export interface PresetCategory {
  id: string;
  label: string;
  badgeClass: string;
  description: string;
  count?: string;       // optional per-chip count badge (styling follows the variant)
  selectLabel?: string; // label used in the save-form category select (defaults to label)
}

export interface PresetSaveDraft {
  name: string;
  category: string;
  description: string;
  roman?: string;
}

export interface PresetLibraryGroup<T extends PresetLibraryEntry> {
  key: string;
  className?: string;      // section container classes
  innerClassName?: string; // card-list container classes
  header?: React.ReactNode;
  entries: T[];
}

export interface PresetLibraryProps<T extends PresetLibraryEntry> {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  headerSubtitle?: string;       // e.g. "Key of C • 35 Total Progressions"
  headerBadge?: string;          // e.g. "24 Total" pill beside the title
  saveButton?: {                 // "Save Current"-style button (header or toolbar row)
    label: string;
    title?: string;
    inToolbar?: boolean;         // false = header (chord original), true = toolbar row (synth original)
    className?: string;          // overrides the variant-default button classes
  };
  renderHeaderActions?: React.ReactNode; // extra header-row content before the close button
  toolbarActions?: React.ReactNode;      // extra toolbar-row content after the save button
  toast?: string | null;         // wrapper-controlled success message
  toastPlacement?: 'top' | 'toolbar';
  searchPlaceholder?: string;
  variant: 'chord' | 'synth';    // toolbar/chip/search/close styling of the two originals
  entries: T[];                  // merged: custom first, factory after
  categories: PresetCategory[];  // full chip list including 'All' (counts in `count`)
  listContainerClass?: string;   // scrollable list container classes (the originals differ)
  subtitle?: (entry: T) => string;   // used by the default row only
  renderEntryActions?: (entry: T) => React.ReactNode; // default-row extra buttons
  renderEntry?: (entry: T) => React.ReactNode;   // full custom card renderer (the originals' cards)
  groupEntries?: (filtered: T[], query: string, category: string) => PresetLibraryGroup<T>[];
  emptyState?: (query: string, category: string, openSave: () => void) => React.ReactNode;
  filterEntries?: (entry: T, query: string, category: string) => boolean;
  footer?: React.ReactNode;      // drawer footer content
  save: {
    heading: string;             // form heading ("Save Progression Preset" / "Save New Preset to LocalStorage")
    buttonLabel: string;
    withCategory: boolean;
    withDescription: boolean;
    withRoman: boolean;
    defaultCategory: string;
    variant: 'modal' | 'inline'; // chord = centered modal, synth = inline section under the toolbar
    initialName?: string;        // name prefilled when the form opens (synth original)
    chordsSummary?: { count: number; text: string }; // chord modal's "Chords (N):" box
  };
  onSelect: (entry: T) => void;  // default-row Select
  onDelete?: (id: string) => void; // default-row delete
  onSave: (draft: PresetSaveDraft) => boolean; // false keeps the save form open (wrapper-level guard, e.g. empty grid)
}

export function PresetLibrary<T extends PresetLibraryEntry>({
  isOpen, onClose, title, headerSubtitle, headerBadge, saveButton, renderHeaderActions, toolbarActions, toast, toastPlacement, searchPlaceholder, variant, entries, categories, listContainerClass, subtitle, renderEntryActions, renderEntry, groupEntries, emptyState, filterEntries, footer, save, onSelect, onDelete, onSave,
}: PresetLibraryProps<T>) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [showSave, setShowSave] = useState(false);
  const [draft, setDraft] = useState<PresetSaveDraft>({ name: '', category: save.defaultCategory, description: '', roman: '' });

  const openSave = () => {
    setDraft({ name: save.initialName ?? '', category: save.defaultCategory, description: '', roman: '' });
    setShowSave(true);
  };

  const filtered = useMemo(
    () =>
      entries.filter((e) =>
        filterEntries
          ? filterEntries(e, query, category)
          : (category === 'All' || e.category === category) &&
            (query.trim() === '' ||
              e.name.toLowerCase().includes(query.trim().toLowerCase()) ||
              e.description.toLowerCase().includes(query.trim().toLowerCase())),
      ),
    [entries, category, query, filterEntries],
  );

  if (!isOpen) return null;

  const isChord = variant === 'chord';
  const groups = groupEntries
    ? groupEntries(filtered, query, category)
    : [{ key: 'all', className: undefined, innerClassName: undefined, header: undefined, entries: filtered }];

  const handleSubmitSave = (e: React.FormEvent) => {
    e.preventDefault();
    const ok = onSave(draft);
    // Only close on success: a false return (wrapper guard, e.g. empty chord
    // grid) keeps the form open so the user sees nothing was saved.
    if (ok) {
      setShowSave(false);
    }
  };

  // -- the two originals' chrome variants --
  const toolbarClass = isChord
    ? 'p-3.5 border-b border-[#252B48] space-y-2.5 bg-[#0F1226]'
    : 'p-3 border-b border-[#252B48] space-y-2 bg-[#12152A]';
  const searchIconClass = isChord
    ? 'w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none'
    : 'w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5';
  const clearBtnClass = isChord
    ? 'absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 text-xs'
    : 'absolute right-2.5 top-2 text-slate-400 hover:text-slate-200';
  const chipsRowClass = isChord
    ? 'flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none'
    : 'flex gap-1 overflow-x-auto pb-1 scrollbar-none text-[11px]';
  const chipBaseClass = isChord
    ? 'px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer'
    : 'px-2 py-1 rounded-md font-semibold whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1 text-xs';
  const countClass = (selected: boolean) =>
    isChord
      ? 'ml-1 px-1.5 py-0.2 rounded-full bg-indigo-900/80 text-[10px]'
      : `text-[9px] px-1 rounded-full font-mono ${selected ? 'bg-indigo-700 text-white' : 'bg-[#161B36] text-slate-400'}`;
  const closeBtnClass = isChord
    ? 'p-1.5 rounded-lg bg-[#1A1F3B] hover:bg-[#252B48] text-slate-400 hover:text-slate-200 transition-colors cursor-pointer'
    : 'p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-[#1C213E] transition-colors cursor-pointer';
  const saveButtonClass = saveButton?.className ?? (isChord
    ? 'p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer shadow-xs'
    : 'flex-1 flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-2 px-3 rounded-lg shadow-md transition-colors cursor-pointer');

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
                {title}
                {headerBadge && (
                  <span className="text-[10px] font-mono bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-500/30">
                    {headerBadge}
                  </span>
                )}
              </h3>
              {headerSubtitle && <p className="text-[11px] text-slate-400">{headerSubtitle}</p>}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {saveButton && !saveButton.inToolbar && (
              <button
                onClick={openSave}
                className={saveButtonClass}
                title={saveButton.title}
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{saveButton.label}</span>
              </button>
            )}
            {renderHeaderActions}
            <button onClick={onClose} className={closeBtnClass}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Save Success Toast */}
        {toastPlacement === 'top' && toast && (
          <div className="mx-4 mt-3 p-2 bg-emerald-950/80 border border-emerald-500/40 rounded-lg text-xs text-emerald-300 flex items-center gap-2 animate-in fade-in">
            <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>{toast}</span>
          </div>
        )}

        {/* Search & Filter Toolbar */}
        <div className={toolbarClass}>
          {(saveButton?.inToolbar || toolbarActions) && (
            <div className="flex gap-2">
              {saveButton?.inToolbar && (
                <button onClick={openSave} className={saveButtonClass} title={saveButton.title}>
                  <Plus className="w-3.5 h-3.5" />
                  {saveButton.label}
                </button>
              )}
              {toolbarActions}
            </div>
          )}

          <div className="relative">
            <Search className={searchIconClass} />
            <input
              type="text"
              placeholder={searchPlaceholder ?? 'Search...'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-[#0B0D19] border border-[#252B48] rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
            />
            {query && (
              <button onClick={() => setQuery('')} className={clearBtnClass}>
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Category Filter Badges */}
          <div className={chipsRowClass}>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={`${chipBaseClass} ${
                  category === c.id
                    ? c.badgeClass
                    : 'bg-[#0B0D19] hover:bg-[#1A1F3B] text-slate-400 hover:text-slate-200 border border-[#252B48]'
                }`}
              >
                <span>{c.label}</span>
                {c.count && <span className={countClass(category === c.id)}>{c.count}</span>}
              </button>
            ))}
          </div>

          {toastPlacement === 'toolbar' && toast && (
            <div className="bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 animate-in fade-in">
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span>{toast}</span>
            </div>
          )}
        </div>

        {/* Inline Save Form (synth original) */}
        {showSave && save.variant === 'inline' && (
          <form onSubmit={handleSubmitSave} className="p-3 bg-[#1A1E38] border-b border-indigo-500/30 space-y-2.5 animate-in fade-in">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Bookmark className="w-3.5 h-3.5 text-indigo-400" />
                {save.heading}
              </span>
              <button type="button" onClick={() => setShowSave(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Preset Name</label>
              <input
                type="text"
                required
                placeholder="e.g. Hyper Saw Lead"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full bg-[#0B0D19] border border-[#252B48] rounded-md px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              {save.withCategory && (
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Category</label>
                  <select
                    value={draft.category}
                    onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                    className="w-full bg-[#0B0D19] border border-[#252B48] rounded-md px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    {categories.filter((c) => c.id !== 'All').map((c) => (
                      <option key={c.id} value={c.id}>{c.selectLabel ?? c.label}</option>
                    ))}
                  </select>
                </div>
              )}
              {save.withDescription && (
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Description (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Heavy punchy lead tone"
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    className="w-full bg-[#0B0D19] border border-[#252B48] rounded-md px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setShowSave(false)} className="px-3 py-1 bg-[#0B0D19] text-slate-400 hover:text-slate-200 text-xs rounded-md border border-[#252B48] cursor-pointer">
                Cancel
              </button>
              <button type="submit" className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-md shadow-xs cursor-pointer">
                {save.buttonLabel}
              </button>
            </div>
          </form>
        )}

        {/* List Content */}
        <div className={listContainerClass ?? 'flex-1 overflow-y-auto p-3.5 space-y-2.5'}>
          {filtered.length === 0 ? (
            emptyState ? (
              emptyState(query, category, openSave)
            ) : (
              <p className="text-xs text-slate-500 py-6 text-center">No presets match.</p>
            )
          ) : (
            groups.map((group) => (
              <div key={group.key} className={group.className ?? 'space-y-2'}>
                {group.header}
                <div className={group.innerClassName ?? 'space-y-2'}>
                  {group.entries.map((entry) => (
                    <div key={entry.id}>
                      {renderEntry ? (
                        renderEntry(entry)
                      ) : (
                        <div className="flex items-center gap-2 bg-[#171B36] border border-[#2D355A] rounded-lg px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-slate-200 truncate">{entry.name}</div>
                            <div className="text-[10px] text-slate-500 truncate">{subtitle ? subtitle(entry) : entry.description}</div>
                          </div>
                          {renderEntryActions?.(entry)}
                          <button
                            onClick={() => onSelect(entry)}
                            className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-semibold px-2.5 py-1 rounded-md cursor-pointer"
                          >
                            <Check className="w-3 h-3" /> Select
                          </button>
                          {!entry.isFactory && onDelete && (
                            <button onClick={() => onDelete(entry.id)} className="text-slate-400 hover:text-red-400 cursor-pointer">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {footer}
      </div>

      {/* Save Progression Modal Dialog (chord original) */}
      {showSave && save.variant === 'modal' && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm bg-[#171B38] border border-indigo-500/40 rounded-xl p-5 shadow-2xl space-y-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-indigo-400" />
                {save.heading}
              </h4>
              <button onClick={() => setShowSave(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitSave} className="space-y-3">
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">Progression Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. My Epic Verse Flow"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="w-full bg-[#0B0D19] border border-[#2D355A] rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {save.withCategory && (
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Category</label>
                  <select
                    value={draft.category}
                    onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                    className="w-full bg-[#0B0D19] border border-[#2D355A] rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                  >
                    {categories.filter((c) => c.id !== 'All').map((c) => (
                      <option key={c.id} value={c.id}>{c.selectLabel ?? c.label}</option>
                    ))}
                  </select>
                </div>
              )}

              {save.withRoman && (
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Roman numerals (optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. I – V – vi – IV"
                    value={draft.roman ?? ''}
                    onChange={(e) => setDraft({ ...draft, roman: e.target.value })}
                    className="w-full bg-[#0B0D19] border border-[#2D355A] rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              {save.withDescription && (
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Description (Optional)</label>
                  <input
                    type="text"
                    placeholder="Notes about groove, tempo, or feel..."
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    className="w-full bg-[#0B0D19] border border-[#2D355A] rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              {save.chordsSummary && (
                <div className="p-2.5 rounded-lg bg-[#0B0D19] border border-[#252B48] text-[11px] text-slate-400">
                  <span className="font-mono text-indigo-300 block mb-0.5">
                    Chords ({save.chordsSummary.count}):
                  </span>
                  <span className="font-semibold text-slate-200">
                    {save.chordsSummary.text}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSave(false)}
                  className="px-3 py-1.5 rounded-lg bg-[#0B0D19] text-slate-400 hover:text-slate-200 text-xs border border-[#252B48]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs"
                >
                  {save.buttonLabel}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
