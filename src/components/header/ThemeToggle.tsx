import { Moon, Sun } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { MenuRowButton, type ToolVariantProps } from '@/components/ui/MenuRowButton';
import { useTheme } from './useTheme';

/** The light/dark switch. Owns the theme hook, so the Header holds no theme state. */
export function ThemeToggle({ variant = 'bar' }: ToolVariantProps) {
  const { currentTheme, toggleTheme } = useTheme();
  const label = `Switch to ${currentTheme === 'solna-dark' ? 'Light' : 'Dark'} Theme`;
  const icon = currentTheme === 'solna-dark' ? (
    <Sun className="w-4 h-4 text-primary" />
  ) : (
    <Moon className="w-4 h-4 text-primary" />
  );
  if (variant === 'row') return <MenuRowButton id="btn-toggle-theme" icon={icon} label={label} onClick={toggleTheme} />;
  return <IconButton id="btn-toggle-theme" label={label} icon={icon} size="sm" onClick={toggleTheme} />;
}
