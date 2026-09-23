import { describe, expect, test } from 'bun:test';
import { partializeAppState, sanitizePersistedState, useAppStore } from './store';

describe('driveUser, the remembered Drive account', () => {
  test('is validated on read, rebuilt field by field, never cast through', () => {
    expect(sanitizePersistedState({ driveUser: { email: 'me@example.com', name: 'Me', extra: 1 } }).driveUser)
      .toEqual({ email: 'me@example.com', name: 'Me' });
    expect(sanitizePersistedState({ driveUser: { email: 'me@example.com' } }).driveUser)
      .toEqual({ email: 'me@example.com', name: '' });
  });

  test('anything that names no account reads back as none remembered', () => {
    for (const bad of [null, 'me@example.com', [], { email: 1, name: 2 }, { email: '', name: '' }]) {
      expect(sanitizePersistedState({ driveUser: bad }).driveUser).toBeNull();
    }
    expect(sanitizePersistedState({}).driveUser).toBeNull();
  });

  test('persists the identity and never the sign-in mirror', () => {
    useAppStore.setState({ driveUser: { email: 'me@example.com', name: 'Me' }, driveSignedIn: true });
    const persisted = partializeAppState(useAppStore.getState()) as unknown as Record<string, unknown>;
    expect(persisted.driveUser).toEqual({ email: 'me@example.com', name: 'Me' });
    expect(persisted).not.toHaveProperty('driveSignedIn');
    useAppStore.setState({ driveUser: null, driveSignedIn: false });
  });
});

describe('focusTrack persistence', () => {
  /**
   * `controlTarget` was persisted with NO sanitize clause at all — nothing
   * validated it on read, and `resolveSynthControlChannel`'s trailing
   * `?? channels.synth` was standing in for the validation. That fallback
   * becomes a trap once the roster includes 'drum', so the clause below is
   * written from nothing; there is no old clause to rename.
   */
  test('sanitize maps a missing, non-string or out-of-roster focusTrack to synth', () => {
    expect(sanitizePersistedState({}).focusTrack).toBe('synth');
    expect(sanitizePersistedState({ focusTrack: 7 }).focusTrack).toBe('synth');
    expect(sanitizePersistedState({ focusTrack: 'lead' }).focusTrack).toBe('synth');
    expect(sanitizePersistedState({ focusTrack: null }).focusTrack).toBe('synth');
  });

  test('sanitize leaves a valid focusTrack untouched, including drum', () => {
    expect(sanitizePersistedState({ focusTrack: 'fx' }).focusTrack).toBe('fx');
    expect(sanitizePersistedState({ focusTrack: 'drum' }).focusTrack).toBe('drum');
  });

  /**
   * The old keys are simply ignored — not read, not translated, not carried
   * forward (ADR-0023: no migration chains). A user who had FX selected on
   * Sound reopens on Lead; that is one click.
   */
  test('an old payload carrying only controlTarget/patternSegment still resolves focusTrack to synth', () => {
    const out = sanitizePersistedState({ controlTarget: 'bass', patternSegment: 'beat' });
    expect(out.focusTrack).toBe('synth');
  });
});
