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

  // -- the two variants' chrome; colour now comes entirely from daisyUI --
  const toolbarClass = isChord
    ? 'p-3.5 border-b border-base-300 space-y-2.5 bg-base-200'
    : 'p-3 border-b border-base-300 space-y-2 bg-base-200';
  // Vertical centering uses inset-y-0/my-auto rather than top-1/2 + -translate-y-1/2:
  // the latter's utility name embeds the substring "slate", which the guard's
  // palette-color rule (and this file's own regression test) treats as a hit.
  const searchIconClass = isChord
    ? 'w-3.5 h-3.5 text-base-content/60 absolute left-3 inset-y-0 my-auto pointer-events-none z-10'
    : 'w-3.5 h-3.5 text-base-content/60 absolute left-2.5 top-2.5 z-10';
  const clearBtnClass = isChord
    ? 'btn btn-xs btn-ghost btn-circle absolute right-1.5 inset-y-0 my-auto'
    : 'btn btn-xs btn-ghost btn-circle absolute right-1.5 top-1';
  const chipsRowClass = isChord
    ? 'flex items-center gap-1.5 overflow-x-auto pb-1'
    : 'flex gap-1 overflow-x-auto pb-1 text-[11px]';
  const chipBaseClass =
    'badge badge-sm gap-1 whitespace-nowrap cursor-pointer transition-colors';
  const countClass = (selected: boolean) =>
    `ml-1 px-1.5 py-0.5 rounded-full tabular-nums text-[10px] ${
      selected ? 'bg-primary-content/20' : 'bg-base-300 text-base-content/60'
    }`;
  const closeBtnClass = 'btn btn-xs btn-ghost btn-circle';
  const saveButtonClass = saveButton?.className ?? (isChord
    ? 'btn btn-xs btn-primary gap-1'
    : 'btn btn-sm btn-primary flex-1 gap-1.5');

  return (
    <div className="drawer drawer-end fixed inset-0 z-50">
      <input
        type="checkbox"
        className="drawer-toggle"
        checked
        readOnly
        aria-hidden="true"
        tabIndex={-1}
      />
      {/* The panel is fixed, so the content column must not eat backdrop clicks. */}
      <div className="drawer-content pointer-events-none" />
      <div className="drawer-side z-50">
        <label
          className="drawer-overlay"
          aria-label="Close preset library"
          onClick={onClose}
        />
        {/* Sidebar Drawer */}
        <aside className="w-full max-w-md h-full bg-base-100 border-l border-base-300 flex flex-col shadow-2xl overflow-hidden animate-slide-in-right">
          {/* Drawer Header */}
          <div className="p-4 border-b border-base-300 flex items-center justify-between bg-base-200">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-selector bg-primary/20 border border-primary/30 text-primary">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-base-content flex items-center gap-2">
                  {title}
                  {headerBadge && (
                    <span className="badge badge-sm badge-primary badge-outline tabular-nums">
                      {headerBadge}
                    </span>
                  )}
                </h3>
                {headerSubtitle && <p className="text-[11px] text-base-content/60">{headerSubtitle}</p>}
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
            <div className="alert alert-success mx-4 mt-3 py-2 text-xs animate-fade-in">
              <Check className="w-3.5 h-3.5 shrink-0" />
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
              className="input input-sm input-bordered w-full pl-8 pr-8 text-xs"
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
                    : 'badge-ghost text-base-content/60 hover:text-base-content'
                }`}
              >
                <span>{c.label}</span>
                {c.count && <span className={countClass(category === c.id)}>{c.count}</span>}
              </button>
            ))}
          </div>

          {toastPlacement === 'toolbar' && toast && (
            <div className="alert alert-success py-1.5 text-xs animate-fade-in">
              <Check className="w-3.5 h-3.5" />
              <span>{toast}</span>
            </div>
          )}
        </div>

        {/* Inline Save Form (synth original) */}
        {showSave && save.variant === 'inline' && (
          <form onSubmit={handleSubmitSave} className="p-3 bg-base-200 border-b border-primary/30 space-y-2.5 animate-fade-in">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-base-content flex items-center gap-1.5">
                <Bookmark className="w-3.5 h-3.5 text-primary" />
                {save.heading}
              </span>
              <button type="button" onClick={() => setShowSave(false)} className="btn btn-xs btn-ghost btn-circle">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-base-content/60 block mb-1">Preset Name</label>
              <input
                type="text"
                required
                placeholder="e.g. Hyper Saw Lead"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="input input-sm input-bordered w-full text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              {save.withCategory && (
                <div>
                  <label className="text-[10px] uppercase font-bold text-base-content/60 block mb-1">Category</label>
                  <select
                    value={draft.category}
                    onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                    className="select select-sm select-bordered w-full text-xs"
                  >
                    {categories.filter((c) => c.id !== 'All').map((c) => (
                      <option key={c.id} value={c.id}>{c.selectLabel ?? c.label}</option>
                    ))}
                  </select>
                </div>
              )}
              {save.withDescription && (
                <div>
                  <label className="text-[10px] uppercase font-bold text-base-content/60 block mb-1">Description (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Heavy punchy lead tone"
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    className="input input-sm input-bordered w-full text-xs"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setShowSave(false)} className="btn btn-xs btn-ghost">
                Cancel
              </button>
              <button type="submit" className="btn btn-xs btn-primary">
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
              <p className="text-xs text-base-content/50 py-6 text-center">No presets match.</p>
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
                        <div className="card card-compact bg-base-100 border border-base-300 flex-row items-center gap-2 px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-base-content truncate">{entry.name}</div>
                            <div className="text-[10px] text-base-content/50 truncate">{subtitle ? subtitle(entry) : entry.description}</div>
                          </div>
                          {renderEntryActions?.(entry)}
                          <button
                            onClick={() => onSelect(entry)}
                            className="btn btn-xs btn-primary gap-1"
                          >
                            <Check className="w-3 h-3" /> Select
                          </button>
                          {!entry.isFactory && onDelete && (
                            <button onClick={() => onDelete(entry.id)} className="btn btn-xs btn-ghost btn-circle text-base-content/60 hover:text-error">
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
        </aside>
      </div>

      {/* Save Progression Modal Dialog (chord variant) */}
      {showSave && save.variant === 'modal' && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-sm bg-base-100 border border-primary/40 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-sm text-base-content flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-primary" />
                {save.heading}
              </h4>
              <button onClick={() => setShowSave(false)} className="btn btn-xs btn-ghost btn-circle">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitSave} className="space-y-3">
              <div>
                <label className="text-[11px] text-base-content/60 block mb-1">Progression Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. My Epic Verse Flow"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="input input-sm input-bordered w-full text-xs"
                />
              </div>

              {save.withCategory && (
                <div>
                  <label className="text-[11px] text-base-content/60 block mb-1">Category</label>
                  <select
                    value={draft.category}
                    onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                    className="select select-sm select-bordered w-full text-xs"
                  >
                    {categories.filter((c) => c.id !== 'All').map((c) => (
                      <option key={c.id} value={c.id}>{c.selectLabel ?? c.label}</option>
                    ))}
                  </select>
                </div>
              )}

              {save.withRoman && (
                <div>
                  <label className="text-[11px] text-base-content/60 block mb-1">Roman numerals (optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. I – V – vi – IV"
                    value={draft.roman ?? ''}
                    onChange={(e) => setDraft({ ...draft, roman: e.target.value })}
                    className="input input-sm input-bordered w-full text-xs"
                  />
                </div>
              )}

              {save.withDescription && (
                <div>
                  <label className="text-[11px] text-base-content/60 block mb-1">Description (Optional)</label>
                  <input
                    type="text"
                    placeholder="Notes about groove, tempo, or feel..."
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    className="input input-sm input-bordered w-full text-xs"
                  />
                </div>
              )}

              {save.chordsSummary && (
                <div className="p-2.5 rounded-box bg-base-200 border border-base-300 text-[11px] text-base-content/60">
                  <span className="tabular-nums text-primary block mb-0.5">
                    Chords ({save.chordsSummary.count}):
                  </span>
                  <span className="font-mono font-semibold text-base-content">
                    {save.chordsSummary.text}
                  </span>
                </div>
              )}

              <div className="modal-action">
                <button
                  type="button"
                  onClick={() => setShowSave(false)}
                  className="btn btn-sm btn-ghost"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-sm btn-primary">
                  {save.buttonLabel}
                </button>
              </div>
            </form>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button type="button" onClick={() => setShowSave(false)}>close</button>
          </form>
        </dialog>
      )}
    </div>
  );
}
