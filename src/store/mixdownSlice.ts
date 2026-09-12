/**
 * The export mixdown slice.
 *
 * The split follows `projectSlice`'s `destination: 'download'` variant exactly:
 * **the store decides and the component writes.** Nothing here touches
 * `document`, creates an object URL or clicks an anchor — it returns the Blob
 * and the file name, and the header's click handler hands them to the browser.
 * That is what makes the whole export testable with no DOM.
 *
 * `exporting` and `mixdownProgress` are SESSION state: absent from
 * `partializeAppState` and `PROJECT_CONTENT_KEYS`, never persisted, and they
 * do not move `PERSIST_VERSION`.
 */
import type { StoreApi } from 'zustand';
import {
  renderMixdown,
  type MixdownFailureReason,
  type MixdownLoop,
  type MixdownRenderProgress,
  type MixdownSnapshot,
} from '../audio/export/renderMixdown';
import { DRUM_KITS, DRUM_TYPES } from '../data/drumKits';
import { getMeter } from '../utils/meter';
import { slugifyProjectName } from '../utils/projectFileIO';
import { buildProjectContent } from './projectFormat';
import { DEFAULT_FADER_DB, faderDbToGain } from './levelUnits';
import { SOURCE_BUSES } from './sourceBuses';
import type { AppStore } from './types';

export type MixdownProgress =
  | MixdownRenderProgress
  | { phase: 'cancelling' }
  | { phase: 'downloading' };

export type MixdownResult =
  | { ok: true; destination: 'download'; blob: Blob; fileName: string }
  | { ok: false; reason: MixdownFailureReason };

export interface MixdownSlice {
  exporting: boolean;
  mixdownProgress: MixdownProgress | null;
  setMixdownProgress: (progress: MixdownProgress | null) => void;
  cancelMixdown: () => void;
  isMixdownCancelled: () => boolean;
  exportMixdown: () => Promise<MixdownResult>;
  buildMixdownSnapshot: () => MixdownSnapshot;
}

/**
 * One sentence per failure, in the same voice as `SAVE_FAILED_MESSAGE`: what
 * happened, and what the user can do about it. A `Record` over the reason's
 * `kind` rather than a switch, so a new actionable failure is a compile error
 * here instead of an empty toast. Cancellation is deliberate and says nothing.
 */
export const MIXDOWN_FAILURE_MESSAGE: Record<Exclude<MixdownFailureReason['kind'], 'cancelled'>, string> = {
  'empty-arrangement': 'There is nothing to export — the arrangement has no loops.',
  'unsupported-context': 'This browser cannot render audio offline, so the mixdown could not be written.',
  'render-failed': 'The mixdown could not be rendered. Your project is unchanged; try again.',
};

/** The file name an export downloads: the project's slug, with a `.wav` extension. */
export function wavFileName(projectName: string | null): string {
  return `${slugifyProjectName(projectName ?? '')}.wav`;
}

/**
 * Whether an export is running or its download is in flight. One predicate so
 * the header's Export menu and the project menu's replace guard cannot derive
 * "is a mixdown busy" two different ways.
 */
export function selectMixdownBusy(s: AppStore): boolean {
  return s.exporting || s.mixdownProgress !== null;
}

/**
 * The snapshot the renderer works from: the `.solna` CONTENT set plus the mix
 * and bus fields a project body deliberately excludes.
 *
 * Built from `buildProjectContent` rather than from raw state on purpose —
 * "what is exported" and "what is saved" are then the same idea of the song,
 * and a field added to a project body reaches the export without a second
 * edit here. The one addition is each loop's source-bus mixer, converted at
 * this store→audio boundary so song export follows the same per-loop mixer as
 * live arrangement playback.
 *
 * The dB→linear conversion happens HERE, once, and it goes through
 * `faderDbToGain` — the same boundary `engineSync.ts` crosses — so the bottom
 * of a fader is an exact 0 and a bus a user pulled all the way down exports
 * nothing.
 */
function buildMixdownSnapshot(get: () => AppStore): MixdownSnapshot {
  const s = get();
  const content = buildProjectContent(s);
  const loops: MixdownLoop[] = content.loops.map((loop) => ({
    ...loop,
    buses: SOURCE_BUSES.map((bus) => ({
      source: bus.source,
      gain: faderDbToGain(loop[bus.volume]),
      muted: loop[bus.muted],
    })),
    drumFilter: {
      cutoff: loop.drumFilterCutoff,
      resonance: loop.drumFilterResonance,
      type: loop.drumFilterType,
    },
  }));

  return {
    bpm: content.bpm,
    meterId: content.meterId,
    stepsPerBar: getMeter(content.meterId).stepsPerBar,
    masterVolume: faderDbToGain(content.masterVolume),
    effects: content.effects,
    // The raw mute flag, NOT isTrackAudible: solo is a session-only monitoring
    // gesture and must never reach the export, while mute is arrangement intent
    // and must.
    buses: SOURCE_BUSES.map((bus) => ({
      source: bus.source,
      gain: faderDbToGain(s[bus.volume]),
      muted: s[bus.muted],
    })),
    // One row per CANONICAL voice, named or not. `pushDrumTrackGains` resets
    // every voice no track names to DEFAULT_FADER_DB, so a roster missing a
    // voice ends up at unity — stating that here makes the snapshot total and
    // saves the engine from having to know which rows it did not get.
    drumTracks: DRUM_TYPES.map((instrument) => {
      const track = s.sequencerTracks.find((t) => t.instrument === instrument);
      return { instrument, gain: faderDbToGain(track ? track.volume : DEFAULT_FADER_DB) };
    }),
    drumKit: DRUM_KITS[s.soundKit],
    drumKitName: s.soundKit,
    drumFilter: {
      cutoff: s.drumFilterCutoff,
      resonance: s.drumFilterResonance,
      type: s.drumFilterType,
    },
    sequencerParams: s.synthParams,
    loops,
  };
}

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

export function createMixdownSlice(set: Set, get: Get): MixdownSlice {
  let activeJob: { controller: AbortController } | null = null;

  return {
    exporting: false,
    mixdownProgress: null,
    setMixdownProgress: (mixdownProgress) => set({ mixdownProgress }),
    cancelMixdown: () => {
      if (!activeJob && get().mixdownProgress === null) return;
      activeJob?.controller.abort();
      set({ mixdownProgress: { phase: 'cancelling' } });
    },
    isMixdownCancelled: () => get().mixdownProgress?.phase === 'cancelling',
    buildMixdownSnapshot: () => buildMixdownSnapshot(get),

    exportMixdown: async () => {
      const job = { controller: new AbortController() };
      activeJob = job;
      // Capture content and identity in the click's task. The paint yield below
      // must never let a project replacement split the audio from its name.
      const snapshot = buildMixdownSnapshot(get);
      const fileName = wavFileName(get().projectName);
      set({ exporting: true, mixdownProgress: { phase: 'preparing' } });
      try {
        // Put graph construction in the next task so React can paint the
        // pending state before the synchronous scheduling walk begins.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (job.controller.signal.aborted) {
          return { ok: false, reason: { kind: 'cancelled' } };
        }
        const rendered = await renderMixdown(snapshot, (mixdownProgress) => {
          if (activeJob === job && !job.controller.signal.aborted) {
            set({ mixdownProgress });
          }
        }, job.controller.signal);
        if (!rendered.ok) {
          // The FAILURE notice is written here, not by the caller: it is a
          // property of the render, which this slice is the only witness to,
          // and a caller that ignored the result would otherwise leave the
          // user with a button that did nothing. The SUCCESS notice is the
          // component's, because it names a file the component has just
          // handed to the browser — the same split projectSlice's 'download'
          // destination uses.
          if (rendered.reason.kind !== 'cancelled') {
            set({ projectNotice: MIXDOWN_FAILURE_MESSAGE[rendered.reason.kind] });
          }
          return { ok: false, reason: rendered.reason };
        }
        return {
          ok: true,
          destination: 'download',
          blob: rendered.blob,
          fileName,
        };
      } finally {
        if (activeJob === job) {
          activeJob = null;
          set({ exporting: false, mixdownProgress: null });
        }
      }
    },
  };
}
