import React from 'react';
import { TransportBar, type TransportVariant } from '@/components/TransportBar';
import { BottomInputDock } from '@/components/ui/BottomInputDock';
import type { KeyboardVariant } from '@/components/ui/Keyboard';
import { FeedbackHost } from '@/components/ui/FeedbackHost';
import { UpdateBanner } from '@/components/ui/UpdateBanner';
import { ProjectNotice } from '@/components/project/ProjectNotice';
import { LayerPages } from './LayerPages';
import { ViewScrollArea } from './ViewScrollArea';
import type { ShellProps } from './shellProps';

/**
 * The frame both shells share, between each one's own top bar and (on mobile)
 * its bottom navigation. `bottomInset` passes through to `TransportBar`: the
 * mobile frame hands the bottom safe-area inset to its tab bar (R321).
 * `transportVariant` is the frame's choice of transport bar (R316, R332): the
 * mobile frame asks for the one-row bar with its settings sheet.
 * `keyboardVariant` is the same kind of choice for the input dock (R340): the
 * mobile frame asks for keys that fit the width and never scroll.
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
  keyboardVariant,
  feedbackSlot,
}: ShellProps & {
  bottomInset?: boolean;
  transportVariant?: TransportVariant;
  keyboardVariant?: KeyboardVariant;
  feedbackSlot: boolean;
}) {
  return (
    <>
      {/* Main Workspace Body with Persistent Mounts for Background Audio Continuity.
          Both layers stay mounted; the active layer gates which page is visible,
          and each page toggles its own sub-tabs (block/hidden). */}
      {/* The one scroll container; it keeps each view's position (R342). */}
      <ViewScrollArea>
        <LayerPages />
      </ViewScrollArea>

      {/* Toasts and snackbars: a zero-height slot, so the host floats over
          the bottom of <main> just above the dock's toggle strip. */}
      {feedbackSlot && <FeedbackHost edge="bottom" />}

      {/* Bottom Input Dock — Keyboard | Drums, reachable from any page */}
      <BottomInputDock keyboardProps={keyboardProps} drumProps={drumProps} keyboardVariant={keyboardVariant} />

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
