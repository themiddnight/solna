import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pins that each clock hook publishes under the SAME StepPlayerId its leaf
 * reads with useCurrentStep. publishStepAt/useCurrentStep are matched by
 * runtime string only — nothing in playbackStep.ts itself ties a producer to
 * a consumer, so retyping one side's id (or copy-pasting a hook and
 * forgetting to change it) compiles clean and fails silently at runtime
 * instead of in a test. Add a row here whenever a new player is wired.
 *
 * `consumer.match` differs per row because the id doesn't always reach
 * useCurrentStep as a literal: PlayingStepRow (StepRow.tsx) is generic and
 * receives its player id as a prop from each call site, so what's pinned
 * there is that the prop is actually forwarded — not hardcoded or dropped —
 * rather than one specific id string.
 */
const WIRINGS: Array<{
  player: string;
  producer: {
    file: string;
    regex: RegExp;
    /**
     * What the producer's capture group must equal. Defaults to `player`
     * (the common case: a hardcoded literal id). Set explicitly when the
     * producer and consumer are pinned to each other via a shared
     * expression rather than to the player name itself — see the
     * 'lead/fx (shared)' row.
     */
    expected?: string;
  };
  consumer: { file: string; regex: RegExp; expected: string };
  /**
   * Where the generic reader's id is actually bound as a literal prop, for
   * players whose consumer (like PlayingStepRow) takes the id at runtime
   * rather than hardcoding it. Counts, rather than merely finding one, so
   * this fails both when a literal is retyped to a different id AND when a
   * new call site is added without updating the count here.
   */
  consumerCallSites?: { files: string[]; regex: RegExp; expectedCount: number };
}> = [
  {
    player: 'chords',
    producer: {
      file: 'src/components/loop/chord/useChordPlayback.ts',
      regex: /publishStepAt\(\s*'([^']+)'/,
    },
    consumer: {
      // The chord lane's reader is its own timeline now. The drum-row shell it
      // replaced (CustomPatternSteps wrapping a PlayingStepRow, whose player id
      // arrived as a prop) is gone with this change, so what is pinned here is
      // the literal in the file that actually renders the playhead. Which
      // PANEL files mount that timeline is the panels' own contract —
      // `consumerCallSites` below re-binds it at the two call sites, because a
      // timeline nobody renders draws no playhead and no other test in this
      // repo would notice.
      file: 'src/components/loop/chord/CustomPatternTimeline.tsx',
      regex: /useCurrentStep\(\s*'([^']+)'\s*\)/,
      expected: 'chords',
    },
    consumerCallSites: {
      // One lane per panel, and one published step behind both: the chord and
      // bass lanes fold the SAME absolute step by their own cycle width, which
      // is why both readers subscribe to this one player id.
      files: [
        'src/components/loop/chord/ChordModulePanel.tsx',
        'src/components/loop/chord/BassModulePanel.tsx',
      ],
      regex: /<CustomPatternTimeline\b/g,
      expectedCount: 2,
    },
  },
  {
    // Was a 'lead'-only row pinning two independently-hardcoded literals.
    // The fx-track task parameterized both hooks by a `track: MelodyTrack`
    // argument (src/store/melodyTracks.ts), so useLeadStepPublisher's
    // publishStepAt and useLeadMarker's useCurrentStep now both call with
    // `track.stepPlayer` — the SAME expression, read from the SAME
    // MELODY_TRACKS table row — rather than two separately-typed id
    // strings that could drift. That makes producer/consumer agreement
    // structurally guaranteed by construction for BOTH the lead and fx
    // tracks (there is only one place, MELODY_TRACKS, that defines
    // `stepPlayer` per track), so one row here covers both tracks; a
    // second row for 'fx' would point at these same two files and assert
    // nothing new. What this row still catches: either file reverting to a
    // hardcoded literal, or one of the two starting to read a different
    // field (e.g. `track.player`) while the other still reads
    // `track.stepPlayer`.
    player: 'lead/fx (shared)',
    producer: {
      // DEV-378: the lead's step producer is NOT the scheduler. The marker
      // runs on leadClockActive (any section, or the metronome alone) while
      // useLeadPlayback runs on the lead player, so they are separate hooks
      // with separate gates.
      file: 'src/components/loop/lead/useLeadStepPublisher.ts',
      regex: /publishStepAt\(\s*([^,]+),/,
      expected: 'track.stepPlayer',
    },
    consumer: {
      // DEV-377: the marker's column is read by useLeadMarkerColumn, not by
      // LeadMelodyGrid.tsx directly — the hook owns the useCurrentStep call.
      file: 'src/components/loop/lead/useLeadMarker.ts',
      regex: /useCurrentStep\(\s*([^)]+)\)/,
      expected: 'track.stepPlayer',
    },
  },
  {
    player: 'sequencer',
    producer: {
      file: 'src/components/useSequencerPlayback.ts',
      regex: /publishStepAt\(\s*'([^']+)'/,
    },
    consumer: {
      file: 'src/components/loop/sequencer/SequencerGrid.tsx',
      regex: /useCurrentStep\(\s*(?:'([^']+)'|(\w+))\s*\)/,
      expected: 'sequencer',
    },
  },
];

// The publish used to live inside useLeadPlayback's clock callback, ahead of
// that callback's two early-outs, and a test here pinned that source order so
// the marker could not be stalled during pre-arm or 'stopping' by a later
// edit moving it behind a gate. DEV-378 removed the arrangement instead of
// re-pinning it: the publisher is its own hook now and its callback does
// nothing but publish, so there is no gate left to fall behind. What replaced
// this test is `the lead step producer` in useLeadStepPublisher.test.ts,
// which fails if a second publish reappears in the scheduler.

describe('playbackStep producer/consumer wiring', () => {
  for (const wiring of WIRINGS) {
    test(`'${wiring.player}' publisher and reader agree on the id`, () => {
      const producerSource = readFileSync(join(process.cwd(), wiring.producer.file), 'utf8');
      const producerMatch = producerSource.match(wiring.producer.regex);
      expect(producerMatch).not.toBeNull();
      expect(producerMatch![1]).toBe(wiring.producer.expected ?? wiring.player);

      const consumerSource = readFileSync(join(process.cwd(), wiring.consumer.file), 'utf8');
      const consumerMatch = consumerSource.match(wiring.consumer.regex);
      expect(consumerMatch).not.toBeNull();
      const captured = consumerMatch![1] ?? consumerMatch![2];
      expect(captured).toBe(wiring.consumer.expected);
    });

    if (wiring.consumerCallSites) {
      const { files, regex, expectedCount } = wiring.consumerCallSites;
      test(`'${wiring.player}' is bound at exactly ${expectedCount} call site(s) across ${files.join(', ')}`, () => {
        const total = files.reduce((sum, file) => {
          const source = readFileSync(join(process.cwd(), file), 'utf8');
          const matches = source.match(regex) ?? [];
          return sum + matches.length;
        }, 0);
        expect(total).toBe(expectedCount);
      });
    }
  }
});

/**
 * The chords producer's VALUE contract, not just its id: there is one playback
 * source behind two timeline readers (the chord lane and the bass lane), so it
 * publishes a progression-relative ABSOLUTE step and each reader folds it by
 * its own cycle width. A producer that folded it by a bar here would hand both
 * readers the same 16-column width, and column 20 of a two-bar custom cycle
 * would have no reader that could name it.
 *
 * Pinned against the source because the clock callback needs a DOM harness to
 * run, which this repo deliberately does not have — the same reason the id
 * wiring above is read out of the file.
 */
describe('the chords producer publishes a progression-relative step', () => {
  const producerSource = (): string =>
    readFileSync(join(process.cwd(), 'src/components/loop/chord/useChordPlayback.ts'), 'utf8');

  test('publishes `progressionStep`, not the clock step or a bar remainder', () => {
    const match = producerSource().match(/publishStepAt\(\s*'chords',\s*([^,]+),/);

    expect(match).not.toBeNull();
    expect(match![1].trim()).toBe('progressionStep');
  });

  test('publishes it AFTER the arming transition for that tick', () => {
    // The arm is what sets the run's origin, so a publish placed above it
    // would report the pre-arm step for the tick that starts the run — the
    // first visible column would be the clock's, never zero.
    const source = producerSource();
    const armed = source.indexOf('const action = chordStepAction(');
    const published = source.indexOf("publishStepAt('chords'");

    expect(armed).toBeGreaterThan(-1);
    expect(published).toBeGreaterThan(armed);
  });
});

// renderToString runs no effects, so ArrangeView's tab-gating cannot be
// observed by mounting the component — the guard is asserted directly
// against the source instead. Without this, dropping the `activeTab`
// condition (reintroducing an always-on subscription that reruns the clock
// callback while the tab sits behind `display:none`) would compile clean and
// pass every other test in this repo.
describe('ArrangeView\'s clock effect is gated on both isPlaying and the active tab', () => {
  test('the early-return guard is exactly `!isPlaying || activeTab !== \'arrange\'`', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/song/ArrangeView.tsx'),
      'utf8',
    );
    const match = source.match(
      /if \(([\s\S]*?)\)\s*\{\s*setCurrentStep\(0\);\s*return;\s*\}/,
    );
    expect(match).not.toBeNull();
    // Whitespace/line-break reformatting must not fail this; only the
    // condition's actual content should.
    const condition = match![1].replace(/\s+/g, ' ').trim();
    expect(condition).toBe("!isPlaying || activeTab !== 'arrange'");
  });
});

/**
 * The other half of the chord-lane change: only the MELODIC and CHORD lanes
 * moved to a span timeline. A drum voice is still one hit at one step, so the
 * sequencer keeps the shared `StepRow` — and TrackRow must keep importing and
 * rendering it rather than an inline copy or the new timeline.
 *
 * Asserted against the source for the same reason as everything above: a drum
 * grid that rendered a span timeline would be a design change, not a
 * refactor, and it would compile clean.
 */
describe('the drum sequencer keeps the one-hit step row', () => {
  const trackRowSource = (): string =>
    readFileSync(join(process.cwd(), 'src/components/loop/sequencer/TrackRow.tsx'), 'utf8');

  test('TrackRow.tsx still imports and renders StepRow for drums', () => {
    expect(trackRowSource()).toMatch(
      /import \{ StepRow \} from ['"]@\/components\/ui\/StepRow['"]/,
    );
    expect(trackRowSource()).toMatch(/<StepRow</);
    expect(trackRowSource()).not.toContain('CustomPatternTimeline');
  });
});
