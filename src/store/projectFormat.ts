import type { MasterEffects } from '../types';
import type { MeterId } from '../utils/meter';
import { DEFAULT_METER_ID } from '../utils/meter';
import { INITIAL_EFFECTS } from './initialState';
import { LOOP_FLAT_KEYS, loopStatePatch, resolveActiveLoop } from './loop';
import { createDefaultLoop } from './loopSlice';
import { DEFAULT_BPM } from './transportSlice';
import type { AppStore, Loop, LoopStatePatch } from './types';

/**
 * The `.solna` / IndexedDB format version. Deliberately separate from the
 * persist `version` in store.ts: that one bumps for private localStorage
 * reshapes, this one only when the content contract changes. The persist
 * migration chain must never be used to read a project body.
 */
export const PROJECT_FORMAT_VERSION = 2;

export interface ProjectEnvelope {
  formatVersion: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

/** What a list row renders — the envelope and nothing else. */
export type ProjectMeta = ProjectEnvelope;

export interface ProjectContent {
  bpm: number;
  meterId: MeterId;
  masterVolume: number;
  effects: MasterEffects;
  loops: Loop[];
}

export interface ProjectBody extends ProjectEnvelope {
  content: ProjectContent;
}

/** The content set, in file order. The fingerprint serialises in this order. */
export const PROJECT_CONTENT_KEYS = ['bpm', 'meterId', 'masterVolume', 'effects', 'loops'] as const;

/**
 * Every field of a Loop, in fingerprint order. Derived from LOOP_FLAT_KEYS so
 * a new per-loop field is picked up automatically — and pinned by a test so
 * adding one is a conscious decision about whether it belongs in a project.
 */
export const PROJECT_LOOP_KEYS = ['id', 'name', 'repeatCount', ...LOOP_FLAT_KEYS] as const;

export type ProjectContentSource = Pick<AppStore, 'bpm' | 'meterId' | 'masterVolume' | 'effects' | 'loops'>;

/**
 * Picks the content set off the live store. Explicit property list, never a
 * spread: the excluded view/session/library keys must not leak into a file.
 */
export function buildProjectContent(state: ProjectContentSource): ProjectContent {
  return {
    bpm: state.bpm,
    meterId: state.meterId,
    masterVolume: state.masterVolume,
    effects: state.effects,
    loops: state.loops,
  };
}

export type ProjectOpenPatch = ProjectContent &
  LoopStatePatch & { activeLoopId: string; selectedVibeId: null };

/**
 * The single store patch that installs a project. Encodes the reset rules:
 * `selectedVibeId` -> null (a project has no vibe until a chip is pressed),
 * `activeLoopId` -> loops[0] through the same resolution persist `merge`
 * uses, and the flat per-loop keys written through loopStatePatch in the SAME
 * patch — writing `loops` without them would leave the previous project's
 * sound on screen and in the engine. `controlTarget` and `metronomeActive`
 * are deliberately absent: they are user preferences, not project state.
 */
export function applyProjectContent(content: ProjectContent): ProjectOpenPatch {
  const active = resolveActiveLoop(content.loops, null);
  return {
    ...content,
    ...loopStatePatch(active),
    activeLoopId: active.id,
    selectedVibeId: null,
  };
}

/** The content of a brand-new project: store defaults plus one default loop. */
export function factoryProjectContent(): ProjectContent {
  return {
    bpm: DEFAULT_BPM,
    meterId: DEFAULT_METER_ID,
    masterVolume: 0.85,
    effects: { ...INITIAL_EFFECTS },
    loops: [createDefaultLoop()],
  };
}

/** Same style as newLoopId / presetsSlice ids: unique per device, no crypto needed. */
export function newProjectId(): string {
  return `project-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

export function makeEnvelope(name: string, now: number): ProjectEnvelope {
  return { formatVersion: PROJECT_FORMAT_VERSION, id: newProjectId(), name, createdAt: now, updatedAt: now };
}
