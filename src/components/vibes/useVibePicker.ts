import { useCallback, useEffect, useRef, useState } from 'react';
import type { VibeSpec } from '@/data/vibes';
import type { FeedbackRequest } from '@/store/feedback';
import { useAppStore } from '@/store/store';
import { isAnyPlayerActive } from '@/store/transportSlice';
import type { AppStore } from '@/store/types';
import { formatKeyLabel } from '@/utils/noteSpelling';
import { scheduleTimeout } from '@/components/ui/useTimedToast';
import { useLiveStore } from '@/components/ui/useLiveStore';

type VibePreviewModule = typeof import('@/store/vibePreview');

let previewModule: Promise<VibePreviewModule> | null = null;

/**
 * The preview commands reach the engine and the four library resolvers, so
 * they load on demand (R095): prefetched on the button's hover/focus, awaited
 * once per open. A loaded module is cached — fetched and evaluated at most
 * once; a failed fetch is dropped, so the next open fetches again.
 */
function loadVibePreview(): Promise<VibePreviewModule> {
  previewModule ??= import('@/store/vibePreview').catch((error: unknown) => {
    previewModule = null;
    throw error;
  });
  return previewModule;
}

export function prefetchVibePreview(): void {
  // A failed prefetch is not reported here: the open that needs the module
  // fetches it again and reports its own failure.
  loadVibePreview().catch(() => {});
}

/** Shown when the picker cannot open — the chunk failed to load, or the open threw. */
const OPEN_FAILED_FEEDBACK: FeedbackRequest = {
  key: 'vibe',
  message: "Couldn't open the vibes. Check your connection and try again.",
  tone: 'error',
};

/** 400 ms of spin, then the dice settles. */
const ROLLING_MS = 400;

export const PICK_PROMPT = 'Pick a vibe to hear it on this loop.';

export interface VibePreviewed {
  /** The vibe whose card or dice was pressed; a variant is always drawn from it. */
  base: VibeSpec;
  /** What is sounding: `base`, or the dice's variant of it. */
  spec: VibeSpec;
  /** What is sounding, under its name: progression · comp rhythm · bass pattern · drum grid. */
  detail: string;
  /** Present after a reroll; the footer marks the name with the dice, and Use's toast carries the headline. */
  reroll?: { headline: string };
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

/** What the session captured at open that the cards show. */
export interface OpenedFrom {
  /** The vibe the active loop was loaded from when the picker opened. */
  vibeId: string | null;
}

/**
 * The vibe the active loop was loaded from — the card the picker marks
 * "Current". Mid-session the store's `selectedVibeId` names the vibe being
 * previewed, so the id captured at open answers instead.
 */
export function currentVibeId(stored: string | null, openedFrom: OpenedFrom | null): string | null {
  return openedFrom ? openedFrom.vibeId : stored;
}

/**
 * One open of the picker: load the preview module, then begin the session
 * and hand it to `ready`. The returned disposer is the close — it runs `end`,
 * which cancels whatever began and is a no-op when nothing did (or Use
 * already ended it). A close before the module arrives begins nothing, so no
 * hold and no suspension is left behind; StrictMode's mount → cleanup → mount
 * therefore begins exactly once. A load that rejects, or a `begin` that
 * throws (it undoes itself first), reaches `fail` — unless the picker has
 * already closed, when there is nobody left to tell.
 */
export function startPickerSession<M, S>(
  load: () => Promise<M>,
  begin: (module: M) => S,
  ready: (session: S) => void,
  end: () => void,
  fail: (error: unknown) => void,
): () => void {
  let live = true;
  load()
    .then((module) => {
      if (!live) return;
      ready(begin(module));
    })
    .catch((error: unknown) => {
      if (live) fail(error);
    });
  return () => {
    live = false;
    end();
  };
}

export interface UseVibePicker {
  /** The module is loaded and the session has begun; the cards are live. */
  ready: boolean;
  /** The vibe the active loop was loaded from; its card is marked "Current". */
  currentVibeId: string | null;
  previewed: VibePreviewed | null;
  /** The transport aggregate, one boolean (R274). */
  playing: boolean;
  rolling: boolean;
  pick: (vibe: VibeSpec) => void;
  /** Previews a fresh variant of `vibe`, whichever row it is on. */
  reroll: (vibe: VibeSpec) => void;
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
  const [openedFrom, setOpenedFrom] = useState<OpenedFrom | null>(null);
  const [previewed, setPreviewed] = useState<VibePreviewed | null>(null);
  const [rolling, setRolling] = useState(false);
  const playing = useAppStore(isAnyPlayerActive);
  // Through useLiveStore so a renderToString test can seed it (R257).
  const storedVibeId = useLiveStore((s) => s.selectedVibeId);

  /** Ends the session if one is live: keep = Use, otherwise the snapshot goes back. */
  const end = useCallback((keep: boolean) => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
      if (keep) session.preview.commitVibePreview();
      else session.preview.cancelVibePreview(session.snapshot);
    }
    setOpenedFrom(null);
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
        setOpenedFrom({ vibeId: session.snapshot.selectedVibeId ?? null });
      },
      () => end(false), // a no-op after Use or Cancel already ended it
      () => {
        useAppStore.getState().showFeedback(OPEN_FAILED_FEEDBACK);
        onClose();
      },
    );
  }, [open, end, onClose]);

  useEffect(() => clearSpin, [clearSpin]);

  const pick = useCallback((vibe: VibeSpec) => {
    const session = sessionRef.current;
    if (!session) return;
    setPreviewed({ base: vibe, spec: vibe, detail: session.preview.previewVibe(vibe) });
  }, []);

  const reroll = useCallback((vibe: VibeSpec) => {
    const session = sessionRef.current;
    if (!session || !vibe.random) return;
    setRolling(true);
    try {
      const { spec, headline, detail } = session.preview.rerollPreview(vibe);
      setPreviewed({ base: vibe, spec, detail, reroll: { headline } });
    } finally {
      // The spin stops even if the reroll throws.
      scheduleTimeout(spinRef, () => setRolling(false), ROLLING_MS);
    }
  }, []);

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

  return {
    ready: openedFrom !== null,
    currentVibeId: currentVibeId(storedVibeId, openedFrom),
    previewed, playing, rolling, pick, reroll, togglePlay, use, cancel,
  };
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
