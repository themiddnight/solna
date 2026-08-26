import { describe, expect, test } from 'bun:test';
import {
  migrateProjectTitleToVibeId,
  migrateTrackColors,
  LEGACY_TRACK_COLOR_MAP,
} from './migrate';

describe('migrateProjectTitleToVibeId', () => {
  test('drops the legacy projectTitle and seeds a null selectedVibeId', () => {
    const migrated = migrateProjectTitleToVibeId({
      projectTitle: 'Neon Highway 1984',
      bpm: 118,
    } as never) as { projectTitle?: string; selectedVibeId: string | null; bpm: number };

    expect('projectTitle' in migrated).toBe(false);
    expect(migrated.selectedVibeId).toBe(null);
    expect(migrated.bpm).toBe(118);
  });

  test('keeps an already-migrated selectedVibeId, including an explicit null', () => {
    const withId = migrateProjectTitleToVibeId({
      selectedVibeId: 'lofi-chill',
    } as never) as { selectedVibeId: string | null };
    expect(withId.selectedVibeId).toBe('lofi-chill');

    const withNull = migrateProjectTitleToVibeId({
      selectedVibeId: null,
    } as never) as { selectedVibeId: string | null };
    expect(withNull.selectedVibeId).toBe(null);
  });

  test('does not mutate the payload it was given', () => {
    const input = { projectTitle: 'Cosmic Floating' };
    migrateProjectTitleToVibeId(input as never);
    expect(input).toEqual({ projectTitle: 'Cosmic Floating' });
  });
});

describe('migrateTrackColors', () => {
  test('rewrites every legacy palette track colour to a semantic token', () => {
    const migrated = migrateTrackColors({
      sequencerTracks: [
        { id: 'track-kick', color: 'bg-rose-500' },
        { id: 'track-snare', color: 'bg-amber-500' },
        { id: 'track-hihat', color: 'bg-emerald-500' },
        { id: 'track-openhat', color: 'bg-cyan-500' },
        { id: 'track-clap', color: 'bg-purple-500' },
      ],
    } as never) as { sequencerTracks: { color: string }[] };

    expect(migrated.sequencerTracks.map((t) => t.color)).toEqual([
      'bg-error',
      'bg-warning',
      'bg-success',
      'bg-accent',
      'bg-secondary',
    ]);
  });

  test('leaves an already-migrated colour alone', () => {
    const migrated = migrateTrackColors({
      sequencerTracks: [{ id: 'track-kick', color: 'bg-error' }],
    } as never) as { sequencerTracks: { color: string }[] };
    expect(migrated.sequencerTracks[0].color).toBe('bg-error');
  });

  test('is a no-op when sequencerTracks is missing or not an array', () => {
    expect(migrateTrackColors({} as never)).toEqual({} as never);
    expect(
      migrateTrackColors({ sequencerTracks: 'nope' } as never)
    ).toEqual({ sequencerTracks: 'nope' } as never);
  });

  test('the map covers exactly the five legacy colours', () => {
    expect(Object.keys(LEGACY_TRACK_COLOR_MAP).sort()).toEqual([
      'bg-amber-500',
      'bg-cyan-500',
      'bg-emerald-500',
      'bg-purple-500',
      'bg-rose-500',
    ]);
  });

  test('preserves every other field, including steps, through the remap', () => {
    const steps = [true, false, true, false];
    const migrated = migrateTrackColors({
      sequencerTracks: [
        { id: 'track-kick', name: 'Kick 808', color: 'bg-rose-500', steps, muted: false },
      ],
    } as never) as { sequencerTracks: { id: string; name: string; color: string; steps: boolean[]; muted: boolean }[] };

    expect(migrated.sequencerTracks[0]).toEqual({
      id: 'track-kick',
      name: 'Kick 808',
      color: 'bg-error',
      steps,
      muted: false,
    });
  });

  test('leaves an inherited-property-name colour like "constructor" alone rather than mangling it', () => {
    const migrated = migrateTrackColors({
      sequencerTracks: [{ id: 'track-kick', color: 'constructor' }],
    } as never) as { sequencerTracks: { color: unknown }[] };
    expect(migrated.sequencerTracks[0].color).toBe('constructor');

    const toStringCase = migrateTrackColors({
      sequencerTracks: [{ id: 'track-kick', color: 'toString' }],
    } as never) as { sequencerTracks: { color: unknown }[] };
    expect(toStringCase.sequencerTracks[0].color).toBe('toString');
  });
});
