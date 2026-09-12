import type { StoreApi } from 'zustand';
import { audioEngine } from '../audio/engine';
import { ACCOMPANIMENT_SOURCES } from '../audio/playback/playbackEngine';
import {
  ensureWritePermission,
  fileNameWithoutExtension,
  pickLocalSaveHandle,
  writeTextToHandle,
} from '../utils/localFileSave';
import { projectFileName } from '../utils/projectFileIO';
import type { AppStore } from './types';
import {
  applyProjectContent,
  buildProjectContent,
  factoryProjectContent,
  makeEnvelope,
  type ProjectBody,
  type ProjectContent,
  type ProjectEnvelope,
} from './projectFormat';
import { serializeProject, unknownLibraryReferences } from './projectFile';
import { loopStatePatch, resolveActiveLoop } from './loop';
import type { ProjectStore, ProjectStoreResult, ProjectStoreStatus } from './projectStore';
import {
  UNTITLED_SOURCE,
  envelopeForSave,
  envelopeForSaveAs,
  newDocumentIdentity,
  saveTarget,
  type DocumentIdentity,
  type ProjectSlotRecord,
  type ProjectSource,
} from './projectSource';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

export type ProjectSaveDestination = 'local' | 'drive' | 'download' | 'cancelled';

/**
 * `download` is an INSTRUCTION, not a failure: the browser has no
 * showSaveFilePicker (Safari, Firefox, a permissions-policy iframe), so the
 * caller must write a copy with downloadTextFile. The store cannot do it —
 * src/store/ does not touch `document`, and a `.solna` copy is exactly what
 * `exportProjectFile` already hands the component layer.
 *
 * `cancelled` is likewise a success with no effect: the user dismissed the
 * picker, so nothing was written and the source did not move.
 */
export type ProjectSaveResult =
  | { ok: true; destination: ProjectSaveDestination }
  | { ok: false; message: string };

export const SAVE_FAILED_MESSAGE = 'Could not write the project file. Your work is still autosaved on this device.';
export const SAVE_HANDLE_DENIED_MESSAGE = 'Write permission for that file was denied. Use Save As to pick another one.';

export interface ProjectSlice {
  /** The envelope's name. null = untitled (never named, or a fresh slot). */
  projectName: string | null;
  /**
   * Where explicit Save writes back to. Session-plus-slot state, NOT a persist
   * key: it lives in the IndexedDB slot record beside the body (see
   * projectSource.ts) and must never join partializeAppState.
   */
  projectSource: ProjectSource;
  projectStoreStatus: ProjectStoreStatus;
  /** A non-blocking toast surface: unknown references, quota, unavailable. */
  projectNotice: string | null;
  setProjectNotice: (notice: string | null) => void;
  setProjectName: (name: string) => void;
  /** Boot: read the one slot and install it (or keep the factory session). */
  loadProject: () => Promise<void>;
  /** The autosave write. Never throws; a failure surfaces as a notice. */
  save: () => Promise<ProjectStoreResult<ProjectSlotRecord>>;
  /** Explicit Save. A pure function of the source — see saveTarget(). */
  saveProject: () => Promise<ProjectSaveResult>;
  /** Save As to this device: pick a target, write it, then re-point. */
  saveProjectAsLocal: () => Promise<ProjectSaveResult>;
  /**
   * The body a Save As writes — built BEFORE the write, adopted after it. Split
   * deliberately: a failed write must leave the live document's identity alone.
   */
  saveAsBody: (name: string) => { body: ProjectBody; identity: DocumentIdentity };
  /** Adopt a Save As that actually landed: identity, name and source, then persist. */
  adoptSaveAs: (identity: DocumentIdentity, name: string, source: ProjectSource) => Promise<void>;
  /**
   * Re-point the source WITHOUT touching content, then persist. The one caller
   * is driveSlice.disconnectDrive: a `drive` id is meaningless once the token
   * is revoked. The slot must learn that too, or a reload resumes a project
   * pointing at a file the browser can no longer reach.
   */
  applyProjectSource: (source: ProjectSource) => Promise<void>;
  newProject: () => void;
  openProjectFile: (body: ProjectBody, source?: ProjectSource) => Promise<ProjectStoreResult<ProjectSlotRecord>>;
  exportProjectFile: () => ProjectBody;
}

/**
 * Same instant-but-clickless release loadLoop uses (LOAD_LOOP_RELEASE in
 * loadLoop.ts). Not imported from there: loadLoop imports the store module,
 * and this slice is part of building it.
 */
export const INSTALL_RELEASE = 0.02;

/** Untitled reads as an empty name on disk; `null` is its in-store spelling. */
function normalizeName(name: string): string | null {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Lifecycle actions. Every path that replaces the live session goes through
 * `install`, in loadLoop's order: hardStopAll (dispatches the reducer's
 * 'stop-all', whose frozen singleton songMode compares by reference) → cut the
 * chord and bass voices → ONE set() carrying the content, the reset rules, the
 * flat per-loop patch and the identity. The cut happens BEFORE the set():
 * engineSync's subscriptions fire synchronously on that write, and a cut after
 * it would race them and let the old project's queued voices ring over the
 * new one. Drums are one-shots; one already-scheduled hit may still land.
 */
export function createProjectSlice(
  set: Set,
  get: Get,
  projectStore: ProjectStore,
  now: () => number = Date.now,
): ProjectSlice {
  let slot: DocumentIdentity = newDocumentIdentity(now());

  const install = (
    content: ProjectContent,
    identity: ProjectEnvelope,
    activeLoopId: string | null = null,
    source: ProjectSource = UNTITLED_SOURCE,
  ): void => {
    get().hardStopAll();
    for (const source of ACCOMPANIMENT_SOURCES) {
      audioEngine.stopSource(source, INSTALL_RELEASE);
    }
    slot = { id: identity.id, createdAt: identity.createdAt };
    set({
      ...applyProjectContent(content, activeLoopId),
      // A song-mode cursor into the OLD project's loops[] must not survive
      // the swap: it would index the new project's loops[] instead (out of
      // range, or in range but pointing at the wrong loop) and enterSongIndex
      // is skipped once the cursor is non-null. loadLoop recomputes it on
      // every loops/activeLoopId change; a wholesale content swap has no
      // such recompute, so it is reset here explicitly.
      songLoopIndex: null,
      // A latched track solo is scoped to the surface the user set it on, and a
      // whole-content swap is the most complete surface change there is.
      // soloNav.ts's SOLO_NAV_KEYS cannot catch this on its own: loop ids are
      // not unique across projects, so the incoming project's first loop can
      // carry the same id the outgoing one did (every fresh project's default
      // loop is `loop-default-1`), and this patch writes neither activeTab nor
      // focusTrack. Clearing it here, in the same atomic set() as the content,
      // is what makes the guarantee hold regardless of which loop id lands.
      soloTracks: [],
      // Same reasoning, same atomic patch: the arm is scoped to the loop the
      // user was recording into, and a whole-content swap leaves nothing for
      // it to still name.
      recordingTrack: null,
      // A clipboard source is scoped to the outgoing project's loops. Loop ids
      // may collide across projects, so keeping only the id could otherwise
      // resolve to unrelated content after the swap.
      loopClipboard: null,
      projectName: normalizeName(identity.name),
      // The source is part of what an install replaces: opening a file that
      // came from Drive must not leave the previous project's handle behind, or
      // the first Save would overwrite a file the user never opened.
      projectSource: source,
    });
  };

  /** Re-publish availability only when it CHANGED — a store write per autosave would re-render every mounted view. */
  const publishStatus = (): void => {
    const next = projectStore.status();
    if (get().projectStoreStatus !== next) set({ projectStoreStatus: next });
  };

  /**
   * `activeLoopId` is persisted while `loops` now comes from IndexedDB, so a
   * stored value can name a loop the loaded project does not have — the same
   * reconciliation persist `merge` does for a localStorage payload.
   */
  const reconcileActiveLoop = (): void => {
    const { loops, activeLoopId } = get();
    if (loops.some((row) => row.id === activeLoopId)) return;
    const active = resolveActiveLoop(loops, null);
    set({ activeLoopId: active.id, ...loopStatePatch(active) });
  };

  const buildBody = (envelope: ProjectEnvelope): ProjectBody => ({
    ...envelope,
    content: buildProjectContent(get()),
  });

  const writeText = async (handle: FileSystemFileHandle, text: string): Promise<ProjectSaveResult> => {
    try {
      await writeTextToHandle(handle, text);
      return { ok: true, destination: 'local' };
    } catch {
      return { ok: false, message: SAVE_FAILED_MESSAGE };
    }
  };

  return {
    projectName: null,
    projectSource: UNTITLED_SOURCE,
    projectStoreStatus: 'unknown',
    projectNotice: null,

    setProjectNotice: (projectNotice) => set({ projectNotice }),

    setProjectName: (name) => set({ projectName: normalizeName(name) }),

    loadProject: async () => {
      const result = await projectStore.load();
      publishStatus();
      if (result.ok === false) {
        if (result.error === 'not-found') {
          // Empty slot: a normal first run. Keep the factory content the
          // slices already booted with — no install, so nothing is announced
          // and the engine is not touched. The first autosave writes the slot.
          slot = newDocumentIdentity(now());
          set({ projectSource: UNTITLED_SOURCE });
        } else {
          set({ projectNotice: result.message });
        }
        reconcileActiveLoop();
        return;
      }
      const { body, source } = result.value;
      install(body.content, body, get().activeLoopId, source);
      const warnings = unknownLibraryReferences(body.content);
      set({
        projectNotice:
          warnings.length > 0 ? `Opened with unrecognised references: ${warnings.join(', ')}` : null,
      });
    },

    save: async () => {
      // The record, not the body: the slot carries the source so a reload
      // resumes a project that still knows which file it belongs to. Autosave
      // READS the source and never changes it — only Open, Save As, New and a
      // Drive sign-out re-point it.
      const record: ProjectSlotRecord = { body: get().exportProjectFile(), source: get().projectSource };
      const result = await projectStore.save(record);
      publishStatus();
      // A failed autosave never blocks the app and never rolls the live
      // session back — the notice is the only signal. The failure is not
      // re-scheduled: `projectAutosave.write()` fires this `save()` once and
      // clears its handle, so the slot stays stale until the next content
      // change schedules a write. That re-attempt covers everything, because
      // autosave writes the whole content set rather than a delta.
      if (result.ok === false) set({ projectNotice: result.message });
      return result;
    },

    saveProject: async () => {
      const target = saveTarget(get().projectSource);
      switch (target.kind) {
        case 'save-as':
          // No target to overwrite, so Save IS Save As. Nothing is clobbered.
          return get().saveProjectAsLocal();
        case 'drive-update':
          return get().saveToDrive();
        case 'local-write': {
          if (!(await ensureWritePermission(target.handle))) {
            return { ok: false, message: SAVE_HANDLE_DENIED_MESSAGE };
          }
          return writeText(target.handle, serializeProject(get().exportProjectFile()));
        }
      }
    },

    saveProjectAsLocal: async () => {
      const picked = await pickLocalSaveHandle(projectFileName(get().projectName ?? ''));
      if (picked.ok === false) {
        return { ok: true, destination: picked.reason === 'cancelled' ? 'cancelled' : 'download' };
      }
      if (!(await ensureWritePermission(picked.handle))) {
        return { ok: false, message: SAVE_HANDLE_DENIED_MESSAGE };
      }
      const name = fileNameWithoutExtension(picked.handle.name);
      const { body, identity } = get().saveAsBody(name);
      const written = await writeText(picked.handle, serializeProject(body));
      if (written.ok === false) return written;
      await get().adoptSaveAs(identity, name, { kind: 'local', handle: picked.handle });
      return { ok: true, destination: 'local' };
    },

    saveAsBody: (name) => {
      // One clock read, carried by the identity: a document created at
      // 12:00:00.000 and "updated" at 12:00:00.004 is a lie the envelope should
      // not have to tell, and envelopeForSaveAs takes no second `now` for
      // exactly that reason.
      const identity = newDocumentIdentity(now());
      return { body: buildBody(envelopeForSaveAs(identity, name)), identity };
    },

    adoptSaveAs: async (identity, name, source) => {
      slot = identity;
      set({ projectName: normalizeName(name), projectSource: source });
      // Explicit, not left to the autosave subscription: `projectSource` is not
      // a content key, so a re-point that changed no content would otherwise
      // never reach the slot, and a reload would resume a project that forgot
      // which file it belongs to.
      //
      // AWAITED, and that is why this is async: the slot write has to have
      // landed before the action that triggered it resolves, or a caller (or a
      // test) that reads the slot next sees the old source and the ordering
      // depends on how many microtask hops the backend happens to take.
      await get().save();
    },

    applyProjectSource: async (source) => {
      const current = get().projectSource;
      const unchanged =
        (current.kind === 'untitled' && source.kind === 'untitled') ||
        (current.kind === 'drive' && source.kind === 'drive' && current.fileId === source.fileId) ||
        (current.kind === 'local' && source.kind === 'local' && current.handle === source.handle);
      if (unchanged) return;
      set({ projectSource: source });
      // Explicit, like adoptSaveAs: the source is not a content key, so nothing
      // else would schedule a write and the slot would keep the stale pointer.
      // Awaited, so that a caller which reads the slot next sees this write.
      await get().save();
    },

    newProject: () => {
      install(factoryProjectContent(), makeEnvelope('', now()));
      set({ projectNotice: null });
      // Explicit, not left to the content subscription: New on an
      // already-factory session changes nothing content-wise, so nothing
      // would schedule a write and the slot would stay empty.
      void get().save();
    },

    openProjectFile: async (body, source = UNTITLED_SOURCE) => {
      install(body.content, body, null, source);
      const result = await get().save();
      const warnings = unknownLibraryReferences(body.content);
      // `save()` has already published its own failure notice, and this set()
      // runs after it. Writing the warnings unconditionally would ERASE it: an
      // ordinary file has no warnings, so a file opened on a device with
      // unavailable storage would install correctly and say nothing at all —
      // the exact case the notice exists for. Both are combined instead, and
      // the failure leads because it is the one that costs the user work.
      const notices = [
        ...(result.ok === false ? [result.message] : []),
        ...(warnings.length > 0 ? [`Opened with unrecognised references: ${warnings.join(', ')}`] : []),
      ];
      set({ projectNotice: notices.length > 0 ? notices.join(' ') : null });
      return result;
    },

    exportProjectFile: (): ProjectBody => buildBody(envelopeForSave(slot, get().projectName ?? '', now())),
  };
}
