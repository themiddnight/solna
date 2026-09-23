import { useCallback, useEffect, useRef, useState } from 'react';
import type { VibeSpec } from '@/data/vibes';
import type { FeedbackRequest } from '@/store/feedback';
import { useAppStore } from '@/store/store';
import { isAnyPlayerActive } from '@/store/transportSlice';
import type { AppStore } from '@/store/types';
import { formatKeyLabel } from '@/utils/noteSpelling';
import { scheduleTimeout } from '@/components/ui/useTimedToast';

type VibePreviewModule = typeof import('@/store/vibePreview');

let previewModule: Promise<VibePreviewModule> | null = null;

/**
 * The preview commands reach the engine and the four library resolvers, so
 * they load on demand (R095): prefetched on the button's hover/focus, awaited
 * once per open. The promise is cached — fetched and evaluated at most once.
 */
function loadVibePreview(): Promise<VibePreviewModule> {
  previewModule ??= import('@/store/vibePreview');
  return previewModule;
}

export function prefetchVibePreview(): void {
  void loadVibePreview();
}

/** 400 ms of spin, then the dice settles. */
const ROLLING_MS = 400;

export const PICK_PROMPT = 'Pick a vibe to hear it on this loop.';

export interface VibePreviewed {
  /** The card that was picked; the dice rerolls from it. */
  base: VibeSpec;
  /** What is sounding: `base`, or the dice's variant of it. */
  spec: VibeSpec;
  /** Present after a reroll: what the dice changed. Shown in the footer, never a toast (R329). */
  reroll?: { headline: string; detail: string };
}

export function vibeSummaryLine(previewed: VibePreviewed | null): string {
  if (!previewed) return PICK_PROMPT;
  const { name, scaleRoot, scaleType, bpm } = previewed.spec;
  return `${name} · ${formatKeyLabel(scaleRoot, scaleType)} · ${bpm} BPM`;
}

/** Use's confirmation, under the one `vibe` key (R330); held by an open sheet on mobile (R329). */
export function vibeLoadedFeedback({ spec, reroll }: VibePreviewed): FeedbackRequest {
  return {
    key: 'vibe',
    message: `Loaded ${spec.name} (${spec.bpm} BPM · Key ${formatKeyLabel(spec.scaleRoot, spec.scaleType)})`,
    ...(reroll && { detail: reroll.headline }),
    tone: 'success',
  };
}

interface PreviewSession {
  preview: VibePreviewModule;
  snapshot: Partial<AppStore>;
}

/**
 * One open of the picker: load the preview module, then begin the session
 * and hand it to `ready`. The returned disposer is the close — it runs `end`,
 * which cancels whatever began and is a no-op when nothing did (or Use
 * already ended it). A close before the module arrives begins nothing, so no
 * hold and no suspension is left behind; StrictMode's mount → cleanup → mount
 * therefore begins exactly once.
 */
export function startPickerSession<M, S>(
  load: () => Promise<M>,
  begin: (module: M) => S,
  ready: (session: S) => void,
  end: () => void,
): () => void {
  let live = true;
  void load().then((module) => {
    if (!live) return;
    ready(begin(module));
  });
  return () => {
    live = false;
    end();
  };
}

export interface UseVibePicker {
  /** The module is loaded and the session has begun; the cards are live. */
  ready: boolean;
  previewed: VibePreviewed | null;
  /** The transport aggregate, one boolean (R274). */
  playing: boolean;
  rolling: boolean;
  pick: (vibe: VibeSpec) => void;
  reroll: () => void;
  togglePlay: () => void;
  use: () => void;
  cancel: () => void;
}

/**
 * One picker session per open. Opening begins it (snapshot, hold, input
 * suspended, transport stopped); Use commits, and EVERY other way out —
 * Cancel, Esc, ✕, the backdrop, an unmount while open — restores the snapshot.
 */
export function useVibePicker(open: boolean, onClose: () => void): UseVibePicker {
  const sessionRef = useRef<PreviewSession | null>(null);
  const spinRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);
  const [previewed, setPreviewed] = useState<VibePreviewed | null>(null);
  const [rolling, setRolling] = useState(false);
  const playing = useAppStore((s) => isAnyPlayerActive(s));

  /** Ends the session if one is live: keep = Use, otherwise the snapshot goes back. */
  const end = useCallback((keep: boolean) => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
      if (keep) session.preview.commitVibePreview();
      else session.preview.cancelVibePreview(session.snapshot);
    }
    setReady(false);
    setPreviewed(null);
  }, []);

  const clearSpin = useCallback(() => {
    if (spinRef.current) clearTimeout(spinRef.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    return startPickerSession(
      loadVibePreview,
      (preview): PreviewSession => ({ preview, snapshot: preview.beginVibePreview() }),
      (session) => {
        sessionRef.current = session;
        setReady(true);
      },
      () => end(false), // a no-op after Use or Cancel already ended it
    );
  }, [open, end]);

  useEffect(() => clearSpin, [clearSpin]);

  const pick = useCallback((vibe: VibeSpec) => {
    const session = sessionRef.current;
    if (!session) return;
    session.preview.previewVibe(vibe);
    setPreviewed({ base: vibe, spec: vibe });
  }, []);

  const reroll = useCallback(() => {
    const session = sessionRef.current;
    if (!session || !previewed?.base.random) return;
    setRolling(true);
    try {
      const { spec, headline, detail } = session.preview.rerollPreview(previewed.base);
      setPreviewed({ base: previewed.base, spec, reroll: { headline, detail } });
    } finally {
      // The spin stops even if the reroll throws.
      scheduleTimeout(spinRef, () => setRolling(false), ROLLING_MS);
    }
  }, [previewed]);

  const togglePlay = useCallback(() => {
    const session = sessionRef.current;
    if (!session || !previewed) return;
    if (playing) session.preview.stopPreview();
    else session.preview.playPreview();
  }, [playing, previewed]);

  const use = useCallback(() => {
    if (!sessionRef.current || !previewed) return;
    end(true);
    useAppStore.getState().showFeedback(vibeLoadedFeedback(previewed));
    onClose();
  }, [end, onClose, previewed]);

  const cancel = useCallback(() => {
    end(false);
    onClose();
  }, [end, onClose]);

  return { ready, previewed, playing, rolling, pick, reroll, togglePlay, use, cancel };
}

export interface UseVibesButton {
  open: boolean;
  show: () => void;
  hide: () => void;
}

/** The picker's open state lives with the button that owns the picker (spec §3). */
export function useVibesButton(): UseVibesButton {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  return { open, show, hide };
}
