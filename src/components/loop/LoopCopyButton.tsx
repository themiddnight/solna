import { Copy } from 'lucide-react';
import { copyLoopSection } from '@/store/loopClipboard';

export function LoopCopyButton() {
  return (
    <button
      id="btn-copy-loop"
      type="button"
      onClick={() => copyLoopSection()}
      className="btn btn-sm btn-ghost gap-1.5 text-xs font-semibold"
      title="Copy this loop's sections"
    >
      <Copy className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">Copy</span>
    </button>
  );
}
