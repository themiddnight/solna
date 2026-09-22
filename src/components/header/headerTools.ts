import type { ComponentType } from 'react';
import type { Layer } from '@/types';
import type { ToolVariantProps } from '@/components/ui/MenuRowButton';
import { ExportButton } from '@/components/export/ExportButton';
import { LoopCopyButton } from '@/components/loop/LoopCopyButton';
import { LoopSelector } from '@/components/loop/LoopSelector';
import { FollowPlayheadToggle } from './FollowPlayheadToggle';
import { ProjectNameLabel } from './ProjectNameLabel';
import { ScaleMenu } from './ScaleMenu';
import { ThemeToggle } from './ThemeToggle';

type HeaderToolId =
  | 'loop-copy' | 'loop-selector' | 'project-name' | 'follow-playhead' | 'export' | 'scale' | 'theme';

/** Which side of the tab nav a tool sits on in the desktop row. */
type HeaderToolGroup = 'subject' | 'actions';

interface HeaderTool {
  readonly id: HeaderToolId;
  /** Reads the store itself; its only prop is the rendering variant (`bar` inline, `row` in a menu). */
  readonly Component: ComponentType<ToolVariantProps>;
  /** The layers the tool is available on — its only availability gate (R317). */
  readonly layers: readonly Layer[];
  readonly group: HeaderToolGroup;
}

const LOOP: readonly Layer[] = ['loop'];
const SONG: readonly Layer[] = ['song'];
const BOTH: readonly Layer[] = ['loop', 'song'];

/**
 * The Header's right-hand tools, in desktop order (R317). The desktop Header
 * renders them inline around the tab nav; a narrower frame chooses by `id`
 * which to show inline and which to put behind a menu — a rendering choice,
 * never a new field here. ProjectMenu, the layer switch and the tab nav are
 * structure, not tools: a mobile frame replaces them rather than moving them.
 */
export const HEADER_TOOLS: readonly HeaderTool[] = [
  { id: 'loop-copy', Component: LoopCopyButton, layers: LOOP, group: 'subject' },
  { id: 'loop-selector', Component: LoopSelector, layers: LOOP, group: 'subject' },
  { id: 'project-name', Component: ProjectNameLabel, layers: SONG, group: 'subject' },
  { id: 'follow-playhead', Component: FollowPlayheadToggle, layers: SONG, group: 'subject' },
  { id: 'export', Component: ExportButton, layers: SONG, group: 'subject' },
  { id: 'scale', Component: ScaleMenu, layers: LOOP, group: 'subject' },
  { id: 'theme', Component: ThemeToggle, layers: BOTH, group: 'actions' },
];

/** The tools of `group` available on `layer`, in list order. */
export function headerToolsFor(layer: Layer, group: HeaderToolGroup): readonly HeaderTool[] {
  return HEADER_TOOLS.filter((tool) => tool.group === group && tool.layers.includes(layer));
}
