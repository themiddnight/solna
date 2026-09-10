export const PROJECT_LOADING_LABEL = 'Loading your project…';

/**
 * The fullscreen gate the app renders until the single project slot has been
 * read. It exists because launch is now ASYNC: the content comes from
 * IndexedDB, so there is a real window in which the store still holds factory
 * content. Rendering the workspace through that window would flash a default
 * project and let a stray edit autosave over the real one.
 *
 * Role and theme tokens only — `bg-base-100` / `text-base-content` — so it
 * passes `bun run check:theme` in both themes, and daisyUI's `loading` spinner
 * so it needs no asset of its own.
 */
export function ProjectLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="h-dvh bg-base-100 text-base-content flex flex-col items-center justify-center gap-4"
    >
      <span className="loading loading-spinner loading-lg text-primary" aria-hidden="true" />
      <p className="text-sm font-semibold text-base-content/70">{PROJECT_LOADING_LABEL}</p>
    </div>
  );
}
