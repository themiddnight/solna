import { useCallback, useMemo, useState } from 'react';
import { layerForTab, type Layer } from '@/types';
import { useAppStore } from '@/store/store';
import { headerToolsOn, type HeaderTool, type HeaderToolId } from '@/components/header/headerTools';

/**
 * The tools the phone's top bar shows inline: the field-shaped ones (a select,
 * an input) — what is being edited. Every other available tool goes in the
 * menu sheet as a row. A rendering choice of ids, never a descriptor field.
 */
const MOBILE_BAR_TOOL_IDS: ReadonlySet<HeaderToolId> = new Set<HeaderToolId>(['loop-selector', 'scale', 'project-name']);

export interface MobileHeaderTools {
  bar: readonly HeaderTool[];
  menu: readonly HeaderTool[];
}

export function mobileHeaderTools(layer: Layer): MobileHeaderTools {
  const tools = headerToolsOn(layer);
  return {
    bar: tools.filter((tool) => MOBILE_BAR_TOOL_IDS.has(tool.id)),
    menu: tools.filter((tool) => !MOBILE_BAR_TOOL_IDS.has(tool.id)),
  };
}

export interface UseMobileTopBar extends MobileHeaderTools {
  menuOpen: boolean;
  openMenu: () => void;
  closeMenu: () => void;
}

/** The top bar's state: the layer's tools and whether the sheet is open (local, never a slice — R016). */
export function useMobileTopBar(): UseMobileTopBar {
  const activeTab = useAppStore((s) => s.activeTab);
  const [menuOpen, setMenuOpen] = useState(false);
  const openMenu = useCallback(() => setMenuOpen(true), []);
  // Stable: BottomSheet re-binds its native `close` listener whenever onClose changes.
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const tools = useMemo(() => mobileHeaderTools(layerForTab(activeTab)), [activeTab]);
  return { ...tools, menuOpen, openMenu, closeMenu };
}
