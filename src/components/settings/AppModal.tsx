import { cx } from '@/components/ui/cx';
import { Modal } from '@/components/ui/Modal';
import { ThemePicker } from './ThemePicker';
import { APP_MODAL_TABS, useAppModal } from './useAppModal';

const REPO_URL = 'https://github.com/themiddnight/solna';

function AboutPanel() {
  return (
    <div className="space-y-2 text-sm">
      <p className="text-lg font-bold">Solna</p>
      <p>A browser audio workstation</p>
      <p className="text-base-content/70">Made by Pathompong Thitithan</p>
      <a id="link-app-repo" href={REPO_URL} target="_blank" rel="noopener noreferrer" className="link link-primary">
        github.com/themiddnight/solna
      </a>
    </div>
  );
}

/**
 * The app modal the wordmark opens on both frames (R348): Settings (the theme
 * picker) and About. Mounted once in Workspace, beside MidiSettingsModal; it
 * calls useThemeChoice, so the OS listener and the theme-color sync run for
 * the whole session (R346, R347).
 */
export function AppModal() {
  const { open, tab, selectTab, close, theme } = useAppModal();
  return (
    <Modal open={open} onClose={close} title="Solna" size="lg" bodyClassName="space-y-4">
      <div role="tablist" aria-label="Solna" className="tabs tabs-border">
        {APP_MODAL_TABS.map(({ id, label }) => (
          <button
            key={id}
            id={`app-modal-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`app-modal-panel-${id}`}
            onClick={() => selectTab(id)}
            className={cx('tab', tab === id && 'tab-active')}
          >
            {label}
          </button>
        ))}
      </div>
      {/* Both panels stack in one grid cell so the dialog's height is the
          tallest panel's and never changes on a tab switch (R349); the
          inactive one is `invisible` + `inert` instead of `hidden`. */}
      <div className="grid">
        <div
          id="app-modal-panel-settings"
          role="tabpanel"
          aria-labelledby="app-modal-tab-settings"
          inert={tab !== 'settings'}
          className={cx('col-start-1 row-start-1 space-y-2', tab !== 'settings' && 'invisible')}
        >
          <h4 className="text-sm font-semibold">Theme</h4>
          <ThemePicker
            key={String(open)}
            preview={theme.preview}
            resolved={theme.resolved}
            isPreviewing={theme.isPreviewing}
            onSelect={theme.select}
            onApply={theme.apply}
          />
        </div>
        <div
          id="app-modal-panel-about"
          role="tabpanel"
          aria-labelledby="app-modal-tab-about"
          inert={tab !== 'about'}
          className={cx('col-start-1 row-start-1', tab !== 'about' && 'invisible')}
        >
          <AboutPanel />
        </div>
      </div>
    </Modal>
  );
}
