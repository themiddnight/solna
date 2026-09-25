import { ExternalLink } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { ThemePicker } from './ThemePicker';
import { useAppModal } from './useAppModal';

const REPO_URL = 'https://github.com/themiddnight/solna';
// Tagged so murva's analytics can count visits from here; noreferrer stays on.
const MURVA_URL = 'https://murva-beta.themiddnight.dev/?utm_source=solna&utm_medium=referral&utm_content=about';

function AboutSection() {
  return (
    <section id="app-modal-about" aria-label="About" className="space-y-1 text-sm">
      <p>A browser audio workstation</p>
      <p className="text-base-content/70">Made by Pathompong Thitithan</p>
      <a id="link-app-repo" href={REPO_URL} target="_blank" rel="noopener noreferrer" className="link link-primary">
        github.com/themiddnight/solna
      </a>
      <div className="pt-3 space-y-1">
        <p className="text-xs text-base-content/60">Also by Pathompong</p>
        <p className="flex items-center gap-2">
          <a
            id="link-murva"
            href={MURVA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="link link-primary inline-flex items-center gap-1 font-medium"
          >
            murva
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
          <span className="badge badge-ghost badge-sm">beta</span>
        </p>
        <p className="text-base-content/70">Make music together with friends, in real time.</p>
      </div>
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
