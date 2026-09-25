import { Modal } from '@/components/ui/Modal';
import { ThemePicker } from './ThemePicker';
import { useAppModal } from './useAppModal';

const REPO_URL = 'https://github.com/themiddnight/solna';

function AboutSection() {
  return (
    <section id="app-modal-about" aria-label="About" className="space-y-1 text-sm">
      <p>A browser audio workstation</p>
      <p className="text-base-content/70">Made by Pathompong Thitithan</p>
      <a id="link-app-repo" href={REPO_URL} target="_blank" rel="noopener noreferrer" className="link link-primary">
        github.com/themiddnight/solna
      </a>
    </section>
  );
}

/**
 * The app modal the wordmark opens on both frames (R348): the theme picker,
 * a divider, then the About lines. Mounted once in Workspace, beside
 * MidiSettingsModal; it calls useThemeChoice, so the OS listener and the
 * theme-color sync run for the whole session (R346, R347).
 */
export function AppModal() {
  const { open, close, theme } = useAppModal();
  return (
    <Modal open={open} onClose={close} title="Solna" size="lg">
      <section id="app-modal-theme" aria-labelledby="app-modal-theme-title" className="space-y-2">
        <h4 id="app-modal-theme-title" className="text-sm font-semibold">
          Theme
        </h4>
        <ThemePicker
          key={String(open)}
          preview={theme.preview}
          resolved={theme.resolved}
          isPreviewing={theme.isPreviewing}
          onSelect={theme.select}
          onApply={theme.apply}
        />
      </section>
      <div className="divider" />
      <AboutSection />
    </Modal>
  );
}
