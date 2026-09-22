import React from 'react';
import { isSongLayer } from '@/types';
import { useAppStore } from '@/store/store';
import { Header } from '@/components/Header';
import { InstantVibesBar } from '@/components/InstantVibesBar';
import { TransportBar } from '@/components/TransportBar';
import { BottomInputDock } from '@/components/ui/BottomInputDock';
import { UpdateBanner } from '@/components/ui/UpdateBanner';
import { LayerPages } from './LayerPages';
import { MobileTabBar } from './MobileTabBar';
import type { ShellProps } from './shellProps';

/**
 * The mobile frame (`useLayoutMode() === 'mobile'`, below Tailwind's `md`):
 * the tab bar is its navigation, in place of the desktop's Loop/Song switch
 * and per-layer tab row, without touching Workspace or the desktop frame.
 * Same ownership rule: the visible frame only (R316).
 */
export const MobileShell = React.memo(function MobileShell({
  keyboardProps,
  drumProps,
  updateReady,
  onApplyUpdate,
  onDismissUpdate,
}: ShellProps) {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  return (
    <>
      {/* Navigation Header */}
      <Header />

      {/* 1-Click Instant Vibes Quick Starter Bar. Loop-layer only: a vibe
          rewrites the loop's chords, drums, presets and BPM, which is not an
          action the song layer offers — showing it over the arrangement
          invites a click that silently rewrites the loop being arranged. */}
      {!isSongLayer(activeTab) && <InstantVibesBar />}

      {/* Main Workspace Body with Persistent Mounts for Background Audio Continuity.
          Both layers stay mounted; the active layer gates which page is visible,
          and each page toggles its own sub-tabs (block/hidden). */}
      {/* `pb-9` reserves the strip the input dock's toggle floats over. The
          dock's header is absolutely positioned above the dock body so a
          collapsed deck costs no layout height, which also means it sits ON
          TOP of whatever the page has scrolled to its bottom edge — without
          this padding it covers the last row of chord chips or FX knobs and
          swallows their clicks. */}
      <main className="flex-1 min-h-0 relative overflow-y-auto pb-9">
        <LayerPages />
      </main>

      {/* Bottom Input Dock — Keyboard | Drums, reachable from any page */}
      <BottomInputDock keyboardProps={keyboardProps} drumProps={drumProps} />

      {/* A waiting service worker, announced above the transport bar. */}
      <UpdateBanner open={updateReady} onReload={onApplyUpdate} onDismiss={onDismissUpdate} />

      {/* Persistent Transport Bar at bottom */}
      <TransportBar bottomInset={false} />

      {/* Bottom navigation, last: the thumb's reach, and the frame's one
          consumer of the bottom safe-area inset. */}
      <MobileTabBar activeTab={activeTab} onSelect={setActiveTab} />
    </>
  );
});
