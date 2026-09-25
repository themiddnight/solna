import { useState } from 'react';
import { themeEntry, themesOfScheme, type ThemeEntry, type ThemeId, type ThemeScheme } from './themes';

export interface UseThemePicker {
  scheme: ThemeScheme;
  selectScheme: (scheme: ThemeScheme) => void;
  themes: readonly ThemeEntry[];
}

/**
 * The panel's Dark | Light tab. Local state, so switching tabs previews
 * nothing. It opens on the painted theme's scheme; AppModal remounts the
 * picker on every open (`key`), so each open starts from the current preview.
 */
export function useThemePicker(resolved: ThemeId): UseThemePicker {
  const [scheme, selectScheme] = useState<ThemeScheme>(() => themeEntry(resolved).scheme);
  return { scheme, selectScheme, themes: themesOfScheme(scheme) };
}
