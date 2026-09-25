import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { placePopover } from './placePopover';
import { themeEntry, themesOfScheme, type ThemeEntry, type ThemeId, type ThemeScheme } from './themes';

export interface UseThemePicker {
  scheme: ThemeScheme;
  selectScheme: (scheme: ThemeScheme) => void;
  themes: readonly ThemeEntry[];
  /** The trigger button `placePopover` measures and aligns the panel to. */
  triggerRef: RefObject<HTMLButtonElement | null>;
  /** The popover panel, positioned imperatively so it never renders under `AppModal`'s top layer. */
  panelRef: RefObject<HTMLDivElement | null>;
}

/**
 * The panel's Dark | Light tab. Local state, so switching tabs previews
 * nothing. It opens on the painted theme's scheme; AppModal remounts the
 * picker on every open (`key`), so each open starts from the current preview.
 *
 * The panel is a `popover="auto"` element (R325/R328): a portal would still
 * render under `AppModal`'s native top layer, so positioning is imperative
 * DOM wiring here rather than React state — set on the popover's `toggle`
 * event (newState `open`) and kept in sync on `resize`/`scroll` while open,
 * using the pure `placePopover` geometry.
 */
export function useThemePicker(resolved: ThemeId): UseThemePicker {
  const [scheme, selectScheme] = useState<ThemeScheme>(() => themeEntry(resolved).scheme);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;

    const place = () => {
      const { top, left } = placePopover(
        trigger.getBoundingClientRect(),
        { width: panel.offsetWidth, height: panel.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      );
      panel.style.top = `${top}px`;
      panel.style.left = `${left}px`;
    };

    const stopTracking = () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };

    const onToggle = (e: Event) => {
      if (!(e instanceof ToggleEvent)) return;
      if (e.newState === 'open') {
        // Width first (it drives wrapping/height), then measure and place.
        panel.style.width = `${trigger.getBoundingClientRect().width}px`;
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
      } else {
        stopTracking();
      }
    };

    panel.addEventListener('toggle', onToggle);
    return () => {
      panel.removeEventListener('toggle', onToggle);
      stopTracking();
    };
  }, []);

  return { scheme, selectScheme, themes: themesOfScheme(scheme), triggerRef, panelRef };
}
