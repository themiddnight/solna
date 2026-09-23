import React from 'react';
import { TransportBar, type TransportVariant } from '@/components/TransportBar';
import { BottomInputDock } from '@/components/ui/BottomInputDock';
import { FeedbackHost } from '@/components/ui/FeedbackHost';
import { UpdateBanner } from '@/components/ui/UpdateBanner';
import { ProjectNotice } from '@/components/project/ProjectNotice';
import { LayerPages } from './LayerPages';
import type { ShellProps } from './shellProps';

/**
 * The frame both shells share, between each one's own top bar and (on mobile)
 * its bottom navigation. `bottomInset` passes through to `TransportBar`: the
 * mobile frame hands the bottom safe-area inset to its tab bar (R321).
 * `transportVariant` is the frame's choice of transport bar (R316, R332): the
 * mobile frame asks for the one-row bar with its settings sheet.
 * `feedbackSlot` puts the frame's one feedback host (R330) above the input
 * dock; the mobile frame passes `false` and hangs its own under the top bar.
 */
export function ShellBody({
  keyboardProps,
  drumProps,
  updateReady,
  onApplyUpdate,
  onDismissUpdate,
  bottomInset,
  transportVariant,
  feedbackSlot,
}: ShellProps & { bottomInset?: boolean; transportVariant?: TransportVariant; feedbackSlot: boolean }) {
  return (
    <>
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

      {/* Toasts and snackbars: a zero-height slot, so the host floats over
          the bottom of <main> just above the dock's toggle strip. */}
      {feedbackSlot && <FeedbackHost edge="bottom" />}

      {/* Bottom Input Dock — Keyboard | Drums, reachable from any page */}
      <BottomInputDock keyboardProps={keyboardProps} drumProps={drumProps} />

      {/* Persistent banners, above the transport bar: a waiting service worker,
          and any project storage problem (unavailable/failed/quota, or a
          `.solna` opened with unrecognised references) — in flow, never
          floating, unlike the toasts and snackbars in the feedback slot. */}
      <UpdateBanner open={updateReady} onReload={onApplyUpdate} onDismiss={onDismissUpdate} />
      <ProjectNotice />

      {/* Persistent Transport Bar at bottom */}
      <TransportBar bottomInset={bottomInset} variant={transportVariant} />
    </>
  );
}
