import type { ControlType } from "@/shared/types";
import type { IconName } from "@/shared/ui/icon/registry";

/**
 * A single playable Versilian region for a percussion pad: which VCSL
 * instrument to load, and which SFZ note within it to trigger.
 */
export interface PercussionRegion {
  instrument: string;
  note: number;
  /**
   * Short human-readable pad label. English source string, rendered as-is by
   * the Drumpad (`useDrumpadState`) and the sequencer (`useSequencerRows`) —
   * it is NOT localized and has no Lingui message, matching the other plain
   * data labels in the instrument picker.
   *
   * Required because several pads within a set share one `instrument` path
   * (e.g. Hi/Low Bongo both use Bongos) — a label derived from `instrument`
   * alone would collide, so each pad must name its own articulation
   * explicitly.
   */
  label: string;
}

/**
 * Data-driven configuration for a percussion set (DEV-283).
 *
 * `providerKey` is intentionally a standalone literal type here, not a member
 * of `InstrumentProviderKey` — the catalog/provider-factory wiring lands in a
 * later task (A5/A6); this module must compile and test standalone.
 */
export interface PercussionSetConfig {
  id: string;
  /** Set name. English source string, rendered as-is — not localized. */
  label: string;
  icon: IconName;
  controlType: ControlType;
  providerKey: "versilian-percussion";
  /** GM percussion note → VCSL region. Keys are the pads this set exposes. */
  gmNoteToRegion: Record<number, PercussionRegion>;
}
