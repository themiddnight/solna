import { v4 as uuidv4 } from 'uuid';
import {
  buildArrangeTemplate,
  GENRE_PRESETS,
  type ArrangeLoop,
  type ArrangeTemplate,
  type CompanionGenrePreset,
} from '@jam-band/shared';
import type { MidiRegion, Track } from '../domain/models/ArrangeRoomState';
import { UNITY_DB } from '../domain/models/ArrangeRoomState';

const SECTION_BEATS = 32; // 8 bars * 4 beats

const ROLE_COLORS: Record<ArrangeLoop['role'], string> = {
  beat: '#f97316',
  bass: '#22c55e',
  chord: '#3b82f6',
  pad: '#a855f7',
};

/** Loop category (shared enum keys) → backend `instrumentCategory` value (InstrumentCategory enum values). */
const CATEGORY_BY_LOOP: Record<ArrangeLoop['instrumentCategory'], string> = {
  DrumBeat: 'drum_beat',
  AcousticDrumset: 'acoustic_drumset',
  Melodic: 'melodic',
};

const GENRE_IDS = new Set<string>(GENRE_PRESETS.map((g) => g.id));

export function isGenreTemplateId(templateId: string): templateId is CompanionGenrePreset {
  return GENRE_IDS.has(templateId);
}

export interface TemplateInitialState {
  bpm: number;
  scale: { rootNote: string; scale: 'major' | 'minor' };
  tracks: Track[];
  regions: MidiRegion[];
}

/**
 * Assemble the initial arrange-room state (bpm + scale + tracks + regions) for a genre,
 * one MIDI track per generated role with one region per section. Mirrors the frontend
 * preview builder but produces backend domain models. Run once at room creation so the
 * template is the room's single source of truth (no client-applied seeding → no race).
 */
export function buildTemplateInitialState(genre: CompanionGenrePreset): TemplateInitialState {
  const template: ArrangeTemplate = buildArrangeTemplate(genre);
  const tracks: Track[] = [];
  const regions: MidiRegion[] = [];

  // Unique roles in section order.
  const roles = [...new Set(template.sections.flatMap((s) => s.loops.map((l) => l.role)))];

  for (const role of roles) {
    const sample = template.sections.flatMap((s) => s.loops).find((l) => l.role === role);
    if (!sample) continue;

    const trackId = uuidv4();
    const track: Track = {
      id: trackId,
      name: role.charAt(0).toUpperCase() + role.slice(1),
      type: 'midi',
      instrumentId: sample.defaultInstrument,
      instrumentCategory: CATEGORY_BY_LOOP[sample.instrumentCategory],
      volume: UNITY_DB, // DEV-303: generic default track volume, was linear 0.8
      pan: 0,
      color: ROLE_COLORS[role],
      regionIds: [],
      isTransposable: sample.isTransposable,
    };
    tracks.push(track);

    template.sections.forEach((section, sectionIdx) => {
      const loop = section.loops.find((l) => l.role === role);
      if (!loop) return;
      const regionId = uuidv4();
      regions.push({
        id: regionId,
        trackId,
        name: section.label,
        start: sectionIdx * SECTION_BEATS,
        length: SECTION_BEATS,
        loopEnabled: false,
        loopIterations: 1,
        color: ROLE_COLORS[role],
        type: 'midi',
        notes: loop.notes.map((n) => ({ ...n, id: uuidv4() })),
        sustainEvents: [],
      });
      track.regionIds.push(regionId);
    });
  }

  return {
    bpm: template.bpm,
    scale: { rootNote: template.referenceKey, scale: template.scale },
    tracks,
    regions,
  };
}
