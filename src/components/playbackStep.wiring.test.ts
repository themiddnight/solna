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
  producer: { file: string; regex: RegExp };
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
      file: 'src/components/ui/StepRow.tsx',
      regex: /export function PlayingStepRow[\s\S]*?useCurrentStep\(\s*(?:'([^']+)'|(\w+))\s*\)/,
      expected: 'player',
    },
    // PlayingStepRow and PlayingStepHeader both take their id at runtime, so
    // the literal that actually binds 'chords' lives at each call site. Each
    // module panel holds a pair — the step-number strip and the buttons under
    // it must read the SAME player or the numbers would highlight a different
    // column than the one lit up below them.
    consumerCallSites: {
      files: [
        'src/components/loop/chord/ChordModulePanel.tsx',
        'src/components/loop/chord/BassModulePanel.tsx',
      ],
      regex: /\bplayer\s*=\s*"chords"/g,
      expectedCount: 4,
    },
  },
  {
    player: 'lead',
    producer: {
      file: 'src/components/loop/lead/useLeadPlayback.ts',
      regex: /publishStepAt\(\s*'([^']+)'/,
    },
    consumer: {
      file: 'src/components/loop/lead/LeadMelodyGrid.tsx',
      regex: /useCurrentStep\(\s*(?:'([^']+)'|(\w+))\s*\)/,
      expected: 'lead',
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

// Reordering this early-out after the publish call would fire the lead's
// step publish during pre-arm and stopping too — silently, since nothing
// else observes the call order. A manual grep confirmed the order once; this
// pins it so a future edit can't reverse it back unnoticed.
describe('useLeadPlayback publishes only after its action !== "play" early-out', () => {
  test('the early-out return precedes the publishStepAt call in source order', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/loop/lead/useLeadPlayback.ts'),
      'utf8',
    );
    const earlyOutIndex = source.indexOf("if (action !== 'play') return;");
    const publishIndex = source.indexOf("publishStepAt('lead', stepInLoop, time);");
    expect(earlyOutIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(-1);
    expect(earlyOutIndex).toBeLessThan(publishIndex);
  });
});

describe('playbackStep producer/consumer wiring', () => {
  for (const wiring of WIRINGS) {
    test(`'${wiring.player}' publisher and reader agree on the id`, () => {
      const producerSource = readFileSync(join(process.cwd(), wiring.producer.file), 'utf8');
      const producerMatch = producerSource.match(wiring.producer.regex);
      expect(producerMatch).not.toBeNull();
      expect(producerMatch![1]).toBe(wiring.player);

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
