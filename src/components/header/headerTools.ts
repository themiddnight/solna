import type { ComponentType } from 'react';
import type { Layer } from '@/types';
import type { ToolVariantProps } from '@/components/ui/MenuRowButton';
import { ExportButton } from '@/components/export/ExportButton';
import { LoopCopyButton } from '@/components/loop/LoopCopyButton';
import { LoopSelector } from '@/components/loop/LoopSelector';
import { VibesButton } from '@/components/vibes/VibesButton';
import { FollowPlayheadToggle } from './FollowPlayheadToggle';
import { ProjectNameLabel } from './ProjectNameLabel';
import { ScaleMenu } from './ScaleMenu';

export type HeaderToolId =
  | 'vibes' | 'loop-copy' | 'loop-selector' | 'project-name' | 'follow-playhead' | 'export' | 'scale';

export interface HeaderTool {
  readonly id: HeaderToolId;
  /** Reads the store itself; its only prop is the rendering variant (`bar` inline, `row` in a menu). */
  readonly Component: ComponentType<ToolVariantProps>;
  /** The layers the tool is available on — its only availability gate (R317). */
  readonly layers: readonly Layer[];
}

const LOOP: readonly Layer[] = ['loop'];
const SONG: readonly Layer[] = ['song'];

/**
 * The Header's right-hand tools, in desktop order (R317). The desktop Header
 * renders them inline after the tab nav; a narrower frame chooses by `id`
 * which to show inline and which to put behind a menu — a rendering choice,
 * never a new field here. ProjectMenu and the tab nav are structure, not
 * tools: a mobile frame replaces them rather than moving them.
 */
export const HEADER_TOOLS: readonly HeaderTool[] = [
  { id: 'vibes', Component: VibesButton, layers: LOOP },
  { id: 'loop-copy', Component: LoopCopyButton, layers: LOOP },
  { id: 'loop-selector', Component: LoopSelector, layers: LOOP },
  { id: 'project-name', Component: ProjectNameLabel, layers: SONG },
  { id: 'follow-playhead', Component: FollowPlayheadToggle, layers: SONG },
  { id: 'export', Component: ExportButton, layers: SONG },
  { id: 'scale', Component: ScaleMenu, layers: LOOP },
];

/** Every tool available on `layer`, in list order. */
export function headerToolsOn(layer: Layer): readonly HeaderTool[] {
  return HEADER_TOOLS.filter((tool) => tool.layers.includes(layer));
}
