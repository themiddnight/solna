import type { ArpSettings } from '@/types/synth';
import { EnableToggle, KnobGrid, ProModule, ToggleRow } from './proControls';

/**
 * Pro-Mode module 8 — the Arpeggiator (prototype Variant A's modulation row).
 *
 * It takes `arp`/`onArp` and NO patch at all. Arp is performance state, not
 * patch state: a panel holding both writers could push a patch to every
 * sounding voice on an Arp toggle, and the type is what makes that impossible
 * rather than a convention someone has to remember.
 *
 * Arming it reaches no engine. It used to call `initSynthPlayback()` so the
 * AudioContext existed by the time the arp ran, which made a toggle with
 * nothing to play create an audio graph — the same shape as the metronome that
 * once started the transport. An armed arp is silent until a note is held, and
 * every note path (`useInputDeck`) inits the engine itself.
 *
 * Two prototype controls are deliberately not built, for the same reason as
 * Voice's Drift: `ArpSettings` has no gate and no swing, so both knobs would
 * write nowhere. They are their own spec.
 */
const ARP_COLOR = 'text-module-arp' as const;

export interface ArpeggiatorPanelProps {
  arp: ArpSettings;
  onArp: (next: ArpSettings) => void;
}

export function ArpeggiatorPanel({ arp, onArp }: ArpeggiatorPanelProps) {
  return (
    <ProModule
      badge={8}
      title="Arpeggiator"
      color={ARP_COLOR}
      chip={
        <EnableToggle
          id="btn-toggle-arp"
          name="Arpeggiator"
          enabled={arp.active}
          color={ARP_COLOR}
          onToggle={() => onArp({ ...arp, active: !arp.active })}
        />
      }
    >
      <ToggleRow
        idPrefix="btn-arp-rate"
        caption="Rate"
        color={ARP_COLOR}
        value={arp.rate}
        options={[
          // Each name opens with the visible fraction: a speech-input user
          // says what is on the button (WCAG 2.5.3), and the words after it
          // are what a screen reader needs to hear "1/16" as a note length.
          { value: '4n', label: '1/4, quarter notes', content: '1/4' },
          { value: '8n', label: '1/8, eighth notes', content: '1/8' },
          { value: '16n', label: '1/16, sixteenth notes', content: '1/16' },
          { value: '32n', label: '1/32, thirty-second notes', content: '1/32' },
        ]}
        onSelect={(rate) => onArp({ ...arp, rate })}
      />

      <ToggleRow
        idPrefix="btn-arp-mode"
        caption="Direction"
        color={ARP_COLOR}
        value={arp.mode}
        options={[
          { value: 'up', label: 'UP', content: 'UP' },
          { value: 'down', label: 'DOWN', content: 'DOWN' },
          { value: 'updown', label: 'UP/DN, up and down', content: 'UP/DN' },
          { value: 'random', label: 'RND, random', content: 'RND' },
        ]}
        onSelect={(mode) => onArp({ ...arp, mode })}
      />

      <KnobGrid
        color={ARP_COLOR}
        columns={1}
        className="justify-items-start"
        specs={[
          {
            id: 'slider-arp-octaves',
            label: 'Octaves',
            ariaLabel: 'Arpeggiator Octaves',
            value: arp.octaves,
            min: 1,
            max: 4,
            step: 1,
            format: (v) => String(Math.round(v)),
            onChange: (octaves) => onArp({ ...arp, octaves }),
          },
        ]}
      />
    </ProModule>
  );
}
