import { useAppStore } from './store';
import { resolveVibeVoices, vibeContentPatch, withMirror, type ResolvedVibe } from './vibes';

/**
 * A vibe's content in ONE write, with the loops[] mirror — previewVibe
 * without the stop, the cut and the play. For tests that assert on what a
 * vibe writes; the transport side is vibePreview.test.ts's (R337).
 */
export function writeVibe(vibe: ResolvedVibe): void {
  useAppStore.setState((s) => withMirror(s, vibeContentPatch(s, vibe, resolveVibeVoices(vibe))));
}
