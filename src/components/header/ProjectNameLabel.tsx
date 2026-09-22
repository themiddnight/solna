import { useState } from 'react';
import { useLiveStore } from '@/components/ui/useLiveStore';
import { GROUP_LABEL, HEADER_FIELD_SHELL } from '@/components/ui/fieldClasses';

/** What an unnamed project reads as, in the header and in the menu. */
export const UNTITLED_PROJECT_LABEL = 'Untitled project';

/**
 * The one place a project's name becomes display text. `null` is the store's
 * spelling of "never named" (see projectSlice's `normalizeName`), so the
 * label is derived rather than stored — a stored label would go stale the
 * moment the name changed.
 */
export function projectDisplayName(name: string | null): string {
  return name ?? UNTITLED_PROJECT_LABEL;
}

/**
 * The project's name, song layer only, editable in place. Song layer only
 * through its `HEADER_TOOLS` row (`headerTools.ts`), which is its only gate
 * (R317).
 *
 * `draft` is local state, never a store value: a keystroke must not write the
 * store (each write would re-render every mounted view, and the name is
 * envelope rather than content). Commit is Enter or blur; Escape reverts.
 */
export function ProjectNameLabel() {
  const name = useLiveStore((s) => s.projectName);
  const setProjectName = useLiveStore((s) => s.setProjectName);
  const [draft, setDraft] = useState<string | null>(null);
  const label = projectDisplayName(name);
  const value = draft ?? name ?? '';
  const commit = () => {
    setProjectName(value);
    setDraft(null);
  };
  return (
    // Same shell and caption as the loop picker on the other layer, in the same
    // place in the row: each layer opens with what its tabs are editing — a
    // loop there, the project here.
    <div className={HEADER_FIELD_SHELL}>
      <label className={GROUP_LABEL} htmlFor="header-project-name">
        Project
      </label>
      <input
        id="header-project-name"
        type="text"
        value={value}
        placeholder={UNTITLED_PROJECT_LABEL}
        aria-label="Project name"
        title={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(null);
          }
        }}
        className="input input-xs w-20 sm:w-32 max-w-[10rem] text-xs font-semibold bg-transparent border-0 focus:outline-none"
      />
    </div>
  );
}
