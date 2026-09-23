import React from 'react';
import { Menu as MenuIcon } from 'lucide-react';
import type { HeaderTool } from '@/components/header/headerTools';
import { ProjectMenuEffects, ProjectMenuSections, useProjectMenu } from '@/components/project/ProjectMenu';
import { IconButton } from '@/components/ui/IconButton';
import { Modal } from '@/components/ui/Modal';
import { Wordmark } from '@/components/ui/Wordmark';
import { useMobileTopBar } from './useMobileTopBar';

interface MobileMenuSheetProps {
  tools: readonly HeaderTool[];
  open: boolean;
  onClose: () => void;
}

/**
 * The menu: the layer's button-shaped tools as rows, then the project actions
 * inline. Always rendered and closed only by dismissal (Escape, backdrop,
 * close button) — a dialog a row opens (export, confirm, Drive) stacks above
 * it in the top layer and must close first. The project effects sit after the
 * box so the pending overlay covers the sheet instead of being clipped by it.
 * Exported for the test.
 */
export function MobileMenuSheet({ tools, open, onClose }: MobileMenuSheetProps) {
  const project = useProjectMenu();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Menu"
      placement="bottom"
      boxClassName="space-y-3"
      afterBox={<ProjectMenuEffects menu={project} />}
    >
      <div className="flex flex-col gap-1">
        {tools.map(({ id, Component }) => (
          <Component key={id} variant="row" />
        ))}
      </div>
      <ul className="menu w-full p-0">
        <li className="menu-title">Project</li>
        <ProjectMenuSections sections={project.sections} onChoose={project.choose} rowClassName="min-h-11" />
      </ul>
    </Modal>
  );
}

/**
 * The phone's top bar: the wordmark, the layer's field tools (loop picker + key,
 * or the project name), and the menu button. Replaces the desktop Header's
 * tab nav, which the bottom tab bar covers.
 */
export const MobileTopBar = React.memo(function MobileTopBar() {
  const { bar, menu, menuOpen, openMenu, closeMenu } = useMobileTopBar();
  return (
    <header className="navbar min-h-0 shrink-0 bg-base-100 border-b border-base-300 px-2 py-1.5 gap-2 select-none sticky top-0 z-40 flex items-center text-sm">
      <Wordmark interactive={false} />
      {/* The field tools keep their desktop heights, so the bar stays short. */}
      <div className="flex flex-1 min-w-0 items-center justify-end gap-1.5">
        {bar.map(({ id, Component }) => (
          <Component key={id} />
        ))}
      </div>
      <IconButton
        id="btn-mobile-menu"
        label="Menu"
        icon={<MenuIcon className="w-5 h-5" />}
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        className="min-h-11 min-w-11"
        onClick={openMenu}
      />
      <MobileMenuSheet tools={menu} open={menuOpen} onClose={closeMenu} />
    </header>
  );
});
