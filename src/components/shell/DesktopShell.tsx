import React from 'react';
import { Header } from '@/components/Header';
import { ShellBody } from './ShellBody';
import type { ShellProps } from './shellProps';

/**
 * The desktop frame (`useLayoutMode() === 'desktop'`): today's layout. Owns
 * only the visible frame — the host, coordinators and dialogs stay in
 * `Workspace` so a layout switch never remounts them (R316).
 */
export const DesktopShell = React.memo(function DesktopShell(props: ShellProps) {
  return (
    <>
      {/* Navigation Header */}
      <Header />
      <ShellBody {...props} />
    </>
  );
});
