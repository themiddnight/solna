import { Moon, Sun } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { useTheme } from './useTheme';

/** The light/dark switch. Owns the theme hook, so the Header holds no theme state. */
export function ThemeToggle() {
  const { currentTheme, toggleTheme } = useTheme();
  return (
    <IconButton
      id="btn-toggle-theme"
      label={`Switch to ${currentTheme === 'solna-dark' ? 'Light' : 'Dark'} Theme`}
      icon={
        currentTheme === 'solna-dark' ? (
          <Sun className="w-4 h-4 text-primary" />
        ) : (
          <Moon className="w-4 h-4 text-primary" />
        )
      }
      size="sm"
      onClick={toggleTheme}
    />
  );
}
