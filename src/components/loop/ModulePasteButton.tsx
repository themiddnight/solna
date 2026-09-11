import { ClipboardPaste } from 'lucide-react';
import { pasteLoopSection } from '@/store/loopClipboard';
import { loopLabel } from '@/store/loop';
import { LOOP_COPY_GROUPS } from '@/store/loopCopy';
import type { LoopCopyGroupId } from '@/store/loopCopy';
import { IconButton } from '../ui/IconButton';
import { useLiveStore } from '../ui/useLiveStore';

export function ModulePasteButton({ groups }: { groups: readonly LoopCopyGroupId[] }) {
  // useLiveStore, not useAppStore: the button's state depends on a buffer and
  // active loop a test sets before renderToString (see .claude/rules/testing.md).
  const activeLoopId = useLiveStore((s) => s.activeLoopId);
  const source = useLiveStore((s) => {
    const sourceLoopId = s.loopClipboard?.sourceLoopId;
    return sourceLoopId
      ? s.loops.find((loop) => loop.id === sourceLoopId)
      : undefined;
  });
  const disabled = !source || source.id === activeLoopId;

  const label = LOOP_COPY_GROUPS.filter((group) => groups.includes(group.id))
    .map((group) => group.label)
    .join(' + ');
  const tooltip = disabled ? 'Copy a loop first' : `Paste ${label} from ${loopLabel(source)}`;

  return (
    <IconButton
      id={`btn-paste-${groups.join('-')}`}
      label={tooltip}
      icon={<ClipboardPaste className="w-3.5 h-3.5" />}
      size="xs"
      disabled={disabled}
      onClick={() => pasteLoopSection(groups)}
    />
  );
}
