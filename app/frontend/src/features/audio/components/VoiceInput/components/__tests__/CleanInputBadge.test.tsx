import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '@lingui/react';
import { i18n } from '@lingui/core';
import type { ReactElement } from 'react';
import { CleanInputBadge } from '../CleanInputBadge';
import type { CleanInputReport } from '@/engine/audio';

i18n.load('en', {});
i18n.activate('en');

const renderWithI18n = (ui: ReactElement) => render(<I18nProvider i18n={i18n}>{ui}</I18nProvider>);

const base: CleanInputReport = {
  requested: { echoCancellation: false, noiseSuppression: false },
  actual: { echoCancellation: false, noiseSuppression: false },
  unsupported: [],
  verdict: 'clean',
  exactHonoured: true,
};

describe('CleanInputBadge', () => {
  it('renders nothing when there is no report yet', () => {
    const { container } = renderWithI18n(<CleanInputBadge report={null} cleanMode={true} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('confirms a verified clean input', () => {
    renderWithI18n(<CleanInputBadge report={base} cleanMode={true} />);
    expect(screen.getByTestId('clean-input-badge')).toHaveAttribute('data-verdict', 'clean');
  });

  it('names the stage the browser refused to disable', () => {
    renderWithI18n(
      <CleanInputBadge
        report={{ ...base, verdict: 'partial', actual: { echoCancellation: false, noiseSuppression: true } }}
        cleanMode={true}
      />,
    );
    const badge = screen.getByTestId('clean-input-badge');
    expect(badge).toHaveAttribute('data-verdict', 'partial');
    expect(badge.textContent).toContain('noiseSuppression');
  });

  it('does not claim clean when the browser reported nothing', () => {
    renderWithI18n(<CleanInputBadge report={{ ...base, verdict: 'unknown', actual: {} }} cleanMode={true} />);
    expect(screen.getByTestId('clean-input-badge')).toHaveAttribute('data-verdict', 'unknown');
  });

  // Regression: with clean mode OFF, buildInputConstraints requests every processing stage ON,
  // so a compliant browser reporting actual === requested still yields verdict 'clean' — but
  // that means processing IS running, not absent. A "Clean input verified" badge shown here
  // would tell the user the opposite of the truth, right beside the toggle that turns
  // processing off. The badge must never render while clean mode is off, regardless of verdict.
  it('renders nothing when clean mode is off, even with a clean verdict', () => {
    const { container } = renderWithI18n(<CleanInputBadge report={base} cleanMode={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
