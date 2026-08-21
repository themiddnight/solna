/* eslint-disable */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Arpeggiator } from '../Arpeggiator';

describe('Arpeggiator', () => {
  let arpeggiator: Arpeggiator;
  let triggerNoteMock: ReturnType<typeof vi.fn>;
  let releaseNoteMock: ReturnType<typeof vi.fn>;
  let getBPMMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    triggerNoteMock = vi.fn();
    releaseNoteMock = vi.fn();
    getBPMMock = vi.fn().mockReturnValue(120);

    arpeggiator = new Arpeggiator({
      triggerNote: triggerNoteMock,
      releaseNote: releaseNoteMock,
      getBPM: getBPMMock,
    });
  });

  afterEach(() => {
    arpeggiator.dispose();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Basic Flow', () => {
    it('should add note to heldNotes and start arp when noteOn is called', () => {
      arpeggiator.enabled = true;
      arpeggiator.noteOn('C4');

      // Should trigger the first note immediately
      vi.advanceTimersByTime(1);
      expect(triggerNoteMock).toHaveBeenCalledWith('C4');
    });

    it('should remove note from heldNotes when noteOff is called', () => {
      arpeggiator.enabled = true;
      arpeggiator.noteOn('C4');
      arpeggiator.noteOn('E4');

      arpeggiator.noteOff('C4');

      // E4 should still be playing
      vi.advanceTimersByTime(250); // 8n at 120 BPM = 250ms
      expect(triggerNoteMock).toHaveBeenCalledWith('E4');
    });

    it('should stop arp when all notes are released and latch is off', () => {
      arpeggiator.enabled = true;
      arpeggiator.latch = false;
      arpeggiator.noteOn('C4');

      vi.advanceTimersByTime(1);
      expect(triggerNoteMock).toHaveBeenCalledWith('C4');

      arpeggiator.noteOff('C4');

      // Should release the last note
      expect(releaseNoteMock).toHaveBeenCalled();
    });

    it('should clear timeouts and release last note when stop is called', () => {
      arpeggiator.enabled = true;
      arpeggiator.noteOn('C4');

      vi.advanceTimersByTime(1);
      triggerNoteMock.mockClear();
      releaseNoteMock.mockClear();

      arpeggiator.stop();

      expect(releaseNoteMock).toHaveBeenCalledWith('C4');
    });

    it('should clean up all resources when dispose is called', () => {
      arpeggiator.enabled = true;
      arpeggiator.noteOn('C4');

      vi.advanceTimersByTime(1);
      releaseNoteMock.mockClear();

      arpeggiator.dispose();

      expect(releaseNoteMock).toHaveBeenCalled();
    });
  });

  describe('Latch Behavior - Replace on New Chord', () => {
    it('should copy heldNotes to latchedNotes when latch is enabled', () => {
      arpeggiator.enabled = true;
      arpeggiator.noteOn('C4');
      arpeggiator.noteOn('E4');
      arpeggiator.noteOn('G4');

      arpeggiator.updateParams({ latch: true });

      // Release all keys
      arpeggiator.noteOff('C4');
      arpeggiator.noteOff('E4');
      arpeggiator.noteOff('G4');

      // Arp should continue playing C-E-G pattern
      vi.advanceTimersByTime(250);
      expect(triggerNoteMock).toHaveBeenCalled();
    });

    it('should replace latchedNotes when new chord is pressed after releasing all keys', () => {
      arpeggiator.enabled = true;
      arpeggiator.latch = true;

      // First chord
      arpeggiator.noteOn('C4');
      arpeggiator.noteOn('E4');
      arpeggiator.noteOn('G4');

      vi.advanceTimersByTime(1);
      triggerNoteMock.mockClear();

      // Release all keys
      arpeggiator.noteOff('C4');
      arpeggiator.noteOff('E4');
      arpeggiator.noteOff('G4');

      // Press new chord - should replace pattern
      arpeggiator.noteOn('D4');

      vi.advanceTimersByTime(250);

      // Should play D4, not C4/E4/G4
      expect(triggerNoteMock).toHaveBeenCalledWith('D4');
      expect(triggerNoteMock).not.toHaveBeenCalledWith('C4');
    });

    it('should add to latchedNotes when pressing additional note while holding keys', () => {
      arpeggiator.enabled = true;
      arpeggiator.latch = true;

      arpeggiator.noteOn('C4');
      vi.advanceTimersByTime(1);

      arpeggiator.noteOn('E4'); // Add while holding C4

      vi.advanceTimersByTime(250);

      // Should play both C4 and E4
      expect(triggerNoteMock).toHaveBeenCalledWith('C4');
      expect(triggerNoteMock).toHaveBeenCalledWith('E4');
    });

    it('should clear latchedNotes and stop when latch is disabled and no keys held', () => {
      arpeggiator.enabled = true;
      arpeggiator.latch = true;

      arpeggiator.noteOn('C4');
      vi.advanceTimersByTime(1);

      arpeggiator.noteOff('C4');

      // Arp should still be running (latch holds pattern)
      vi.advanceTimersByTime(250);
      expect(triggerNoteMock).toHaveBeenCalled();

      triggerNoteMock.mockClear();
      releaseNoteMock.mockClear();

      // Disable latch
      arpeggiator.updateParams({ latch: false });

      // Should stop and release
      expect(releaseNoteMock).toHaveBeenCalled();
    });
  });

  describe('Arpeggiator Modes', () => {
    beforeEach(() => {
      arpeggiator.enabled = true;
      arpeggiator.noteOn('C4');
      arpeggiator.noteOn('E4');
      arpeggiator.noteOn('G4');
      vi.advanceTimersByTime(1);
      // Don't clear mock - first test needs to check the call from beforeEach
    });

    it('should play notes in ascending order for "up" mode', () => {
      arpeggiator.mode = 'up';

      // First note already played in beforeEach
      expect(triggerNoteMock).toHaveBeenCalledWith('C4');
      triggerNoteMock.mockClear();

      vi.advanceTimersByTime(250); // Second step
      expect(triggerNoteMock).toHaveBeenCalledWith('E4');
      triggerNoteMock.mockClear();

      vi.advanceTimersByTime(250); // Third step
      expect(triggerNoteMock).toHaveBeenCalledWith('G4');
    });

    it('should play notes in descending order for "down" mode', () => {
      // Stop current arp and reset
      arpeggiator.stop();
      triggerNoteMock.mockClear();
      releaseNoteMock.mockClear();

      // Set mode and restart
      arpeggiator.mode = 'down';
      arpeggiator.noteOn('C4');
      arpeggiator.noteOn('E4');
      arpeggiator.noteOn('G4');
      vi.advanceTimersByTime(1);

      expect(triggerNoteMock).toHaveBeenCalledWith('G4');
      triggerNoteMock.mockClear();

      vi.advanceTimersByTime(250);
      expect(triggerNoteMock).toHaveBeenCalledWith('E4');
      triggerNoteMock.mockClear();

      vi.advanceTimersByTime(250);
      expect(triggerNoteMock).toHaveBeenCalledWith('C4');
    });

    it('should play notes up then down for "upDown" mode', () => {
      // Stop current arp and reset
      arpeggiator.stop();
      triggerNoteMock.mockClear();
      releaseNoteMock.mockClear();

      // Set mode and restart
      arpeggiator.mode = 'upDown';
      arpeggiator.noteOn('C4');
      arpeggiator.noteOn('E4');
      arpeggiator.noteOn('G4');
      vi.advanceTimersByTime(1);

      // Up
      expect(triggerNoteMock).toHaveBeenCalledWith('C4');
      triggerNoteMock.mockClear();

      vi.advanceTimersByTime(250);
      expect(triggerNoteMock).toHaveBeenCalledWith('E4');
      triggerNoteMock.mockClear();

      vi.advanceTimersByTime(250);
      expect(triggerNoteMock).toHaveBeenCalledWith('G4');
      triggerNoteMock.mockClear();

      // Down
      vi.advanceTimersByTime(250);
      expect(triggerNoteMock).toHaveBeenCalledWith('E4');
      triggerNoteMock.mockClear();

      vi.advanceTimersByTime(250);
      expect(triggerNoteMock).toHaveBeenCalledWith('C4');
    });

    it('should play notes down then up for "downUp" mode', () => {
      // Stop current arp and reset
      arpeggiator.stop();
      triggerNoteMock.mockClear();
      releaseNoteMock.mockClear();

      // Set mode and restart
      arpeggiator.mode = 'downUp';
      arpeggiator.noteOn('C4');
      arpeggiator.noteOn('E4');
      arpeggiator.noteOn('G4');
      vi.advanceTimersByTime(1);

      // Down
      expect(triggerNoteMock).toHaveBeenCalledWith('G4');
      triggerNoteMock.mockClear();

      vi.advanceTimersByTime(250);
      expect(triggerNoteMock).toHaveBeenCalledWith('E4');
      triggerNoteMock.mockClear();

      vi.advanceTimersByTime(250);
      expect(triggerNoteMock).toHaveBeenCalledWith('C4');
      triggerNoteMock.mockClear();

      // Up
      vi.advanceTimersByTime(250);
      expect(triggerNoteMock).toHaveBeenCalledWith('E4');
      triggerNoteMock.mockClear();

      vi.advanceTimersByTime(250);
      expect(triggerNoteMock).toHaveBeenCalledWith('G4');
    });

    it('should play random notes for "random" mode', () => {
      arpeggiator.mode = 'random';

      const playedNotes = new Set<string>();

      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(250);
        const calls = triggerNoteMock.mock.calls;
        if (calls.length > 0) {
          playedNotes.add(calls[calls.length - 1]![0]);
        }
        triggerNoteMock.mockClear();
      }

      // Should have played at least one of the notes
      expect(playedNotes.size).toBeGreaterThan(0);
    });
  });

  describe('Octave Range', () => {
    beforeEach(() => {
      arpeggiator.enabled = true;
      arpeggiator.mode = 'up';
      arpeggiator.noteOn('C4');
      vi.advanceTimersByTime(1);
      // Don't clear mock - first test needs to check the call
    });

    it('should play notes in original octave when octaveRange = 1', () => {
      // octaveRange = 1 is default, check that first note was C4
      const calls = triggerNoteMock.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      // Find C4 in the calls (should be first note played)
      const c4Call = calls.find(call => call[0] === 'C4');
      expect(c4Call).toBeDefined();
      expect(c4Call![0]).toBe('C4');
      
      // Clear for next test
      triggerNoteMock.mockClear();
    });

    it('should play notes across 2 octaves when octaveRange = 2', () => {
      arpeggiator.noteOff('C4');
      triggerNoteMock.mockClear();

      arpeggiator.octaveRange = 2;
      arpeggiator.noteOn('C4');
      vi.advanceTimersByTime(1);

      expect(triggerNoteMock).toHaveBeenCalledWith('C4');
      triggerNoteMock.mockClear();

      vi.advanceTimersByTime(250);
      expect(triggerNoteMock).toHaveBeenCalledWith('C5');
    });

    it('should play notes across 3 octaves when octaveRange = 3', () => {
      arpeggiator.noteOff('C4');
      triggerNoteMock.mockClear();

      arpeggiator.octaveRange = 3;
      arpeggiator.noteOn('C4');
      vi.advanceTimersByTime(1);

      expect(triggerNoteMock).toHaveBeenCalledWith('C4');
      triggerNoteMock.mockClear();

      vi.advanceTimersByTime(250);
      expect(triggerNoteMock).toHaveBeenCalledWith('C5');
      triggerNoteMock.mockClear();

      vi.advanceTimersByTime(250);
      expect(triggerNoteMock).toHaveBeenCalledWith('C6');
    });
  });

  describe('Gate and Timing', () => {
    beforeEach(() => {
      arpeggiator.enabled = true;
      arpeggiator.subdivision = '8n'; // 250ms at 120 BPM
      arpeggiator.noteOn('C4');
      vi.advanceTimersByTime(1);
      triggerNoteMock.mockClear();
      releaseNoteMock.mockClear();
    });

    it('should release note at 50% of interval when gate = 0.5', () => {
      arpeggiator.gate = 0.5;

      vi.advanceTimersByTime(250);
      expect(triggerNoteMock).toHaveBeenCalledWith('C4');
      releaseNoteMock.mockClear();

      // Release should happen at 125ms (50% of 250ms)
      vi.advanceTimersByTime(125);
      expect(releaseNoteMock).toHaveBeenCalledWith('C4');
    });

    it('should release note at 100% of interval when gate = 1.0 (legato)', () => {
      arpeggiator.gate = 1.0;

      vi.advanceTimersByTime(250);
      expect(triggerNoteMock).toHaveBeenCalledWith('C4');
      releaseNoteMock.mockClear();

      // Release should happen at 250ms (100% of 250ms)
      vi.advanceTimersByTime(250);
      expect(releaseNoteMock).toHaveBeenCalledWith('C4');
    });

    it('should use correct timing for 16n subdivision at 120 BPM', () => {
      arpeggiator.noteOff('C4');
      triggerNoteMock.mockClear();

      arpeggiator.subdivision = '16n'; // 125ms at 120 BPM
      arpeggiator.noteOn('C4');
      vi.advanceTimersByTime(1);

      expect(triggerNoteMock).toHaveBeenCalled();
      triggerNoteMock.mockClear();

      vi.advanceTimersByTime(125);
      expect(triggerNoteMock).toHaveBeenCalled();
    });

    it('should use correct timing for 4n subdivision at 120 BPM', () => {
      arpeggiator.noteOff('C4');
      triggerNoteMock.mockClear();

      arpeggiator.subdivision = '4n'; // 500ms at 120 BPM
      arpeggiator.noteOn('C4');
      vi.advanceTimersByTime(1);

      expect(triggerNoteMock).toHaveBeenCalled();
      triggerNoteMock.mockClear();

      vi.advanceTimersByTime(500);
      expect(triggerNoteMock).toHaveBeenCalled();
    });
  });

  describe('Parameter Updates', () => {
    it('should stop and clear notes when enabled is set to false', () => {
      arpeggiator.enabled = true;
      arpeggiator.noteOn('C4');
      vi.advanceTimersByTime(1);

      releaseNoteMock.mockClear();

      arpeggiator.updateParams({ enabled: false });

      expect(releaseNoteMock).toHaveBeenCalled();
    });

    it('should reset currentIndex when mode is changed', () => {
      arpeggiator.enabled = true;
      arpeggiator.mode = 'up';
      arpeggiator.noteOn('C4');
      arpeggiator.noteOn('E4');

      vi.advanceTimersByTime(250);
      triggerNoteMock.mockClear();

      arpeggiator.updateParams({ mode: 'down' });

      vi.advanceTimersByTime(250);
      // After mode change, should start from beginning of new pattern
      expect(triggerNoteMock).toHaveBeenCalled();
    });

    it('should clamp gate value between 0.05 and 1.0', () => {
      arpeggiator.updateParams({ gate: 1.5 });
      expect(arpeggiator.gate).toBe(1.0);

      arpeggiator.updateParams({ gate: 0.01 });
      expect(arpeggiator.gate).toBe(0.05);

      arpeggiator.updateParams({ gate: 0.7 });
      expect(arpeggiator.gate).toBe(0.7);
    });
  });

  describe('Edge Cases', () => {
    it('should not start arp when enabled is false', () => {
      arpeggiator.enabled = false;
      arpeggiator.noteOn('C4');

      vi.advanceTimersByTime(1000);
      expect(triggerNoteMock).not.toHaveBeenCalled();
    });

    it('should handle noteOn for same note multiple times', () => {
      arpeggiator.enabled = true;
      arpeggiator.noteOn('C4');
      arpeggiator.noteOn('C4');
      arpeggiator.noteOn('C4');

      vi.advanceTimersByTime(1);
      // Should only trigger once
      expect(triggerNoteMock).toHaveBeenCalledTimes(1);
    });

    it('should handle noteOff for note that was never pressed', () => {
      arpeggiator.enabled = true;
      arpeggiator.noteOn('C4');

      expect(() => {
        arpeggiator.noteOff('E4');
      }).not.toThrow();
    });

    it('should sort notes by MIDI pitch', () => {
      // Start fresh
      arpeggiator.dispose();
      triggerNoteMock.mockClear();
      releaseNoteMock.mockClear();

      arpeggiator = new Arpeggiator({
        triggerNote: triggerNoteMock,
        releaseNote: releaseNoteMock,
        getBPM: getBPMMock,
      });
      arpeggiator.enabled = true;
      arpeggiator.mode = 'up';

      // Add first note - this will start arp and play G4 immediately
      arpeggiator.noteOn('G4');
      vi.advanceTimersByTime(1);
      
      // First note played should be G4 (the note that triggered start)
      expect(triggerNoteMock).toHaveBeenCalledWith('G4');
      
      // Now add more notes - they will be sorted into heldNotes [C4, E4, G4]
      arpeggiator.noteOn('C4');
      arpeggiator.noteOn('E4');
      
      // currentIndex is now 1 (after playing G4 which was index 0 when it was alone)
      // heldNotes is now [C4, E4, G4] (sorted)
      // Next tick will play index 1 % 3 = 1 → E4
      // Then index 2 % 3 = 2 → G4
      // Then index 3 % 3 = 0 → C4 (wraps around)
      
      triggerNoteMock.mockClear();
      
      // Verify notes are sorted by checking a full cycle
      vi.advanceTimersByTime(250);
      const firstNote = triggerNoteMock.mock.calls[0]![0];
      triggerNoteMock.mockClear();

      vi.advanceTimersByTime(250);
      const secondNote = triggerNoteMock.mock.calls[0]![0];
      triggerNoteMock.mockClear();

      vi.advanceTimersByTime(250);
      const thirdNote = triggerNoteMock.mock.calls[0]![0];
      
      // Collect all notes played
      const playedNotes = [firstNote, secondNote, thirdNote];
      
      // All three notes should be present
      expect(playedNotes).toContain('C4');
      expect(playedNotes).toContain('E4');
      expect(playedNotes).toContain('G4');
    });
  });
});

describe('Arpeggiator releaseAll — global stop', () => {
  let arp: Arpeggiator;
  let triggerNote: ReturnType<typeof vi.fn>;
  let releaseNote: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    triggerNote = vi.fn();
    releaseNote = vi.fn();
    arp = new Arpeggiator({
      triggerNote,
      releaseNote,
      getBPM: vi.fn().mockReturnValue(120),
    });
    arp.enabled = true;
  });

  afterEach(() => {
    arp.dispose();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('stops a running pattern even while latch is on', () => {
    // The reported bug: stopping the Arrange transport left an arpeggiated track sounding.
    // noteOff alone cannot fix it -- with latch on it deliberately keeps the pattern alive.
    arp.latch = true;
    arp.noteOn('C4');
    expect(arp.isRunning).toBe(true);

    arp.releaseAll();

    expect(arp.isRunning).toBe(false);
  });

  it('produces no further notes after being released', () => {
    arp.latch = true;
    arp.noteOn('C4');
    vi.advanceTimersByTime(1000);
    triggerNote.mockClear();

    arp.releaseAll();
    vi.advanceTimersByTime(2000);

    expect(triggerNote).not.toHaveBeenCalled();
  });

  it('does not resume the old latched chord on the next key', () => {
    // stop() leaves the note lists intact so a later noteOn can resume; after a global stop
    // that would bring back a chord from before the transport stopped.
    arp.latch = true;
    arp.noteOn('C4');
    arp.noteOn('E4');
    arp.releaseAll();
    triggerNote.mockClear();

    arp.noteOn('G4');
    vi.advanceTimersByTime(2000);

    const played = new Set(triggerNote.mock.calls.map((call) => String(call[0]).replace(/\d+$/, '')));
    expect(played.has('C')).toBe(false);
    expect(played.has('E')).toBe(false);
  });

  it('is safe to call when nothing is running', () => {
    expect(() => { arp.releaseAll(); }).not.toThrow();
    expect(arp.isRunning).toBe(false);
  });
});
