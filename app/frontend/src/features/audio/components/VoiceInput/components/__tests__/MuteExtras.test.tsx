/* eslint-disable */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { MuteExtras } from '../MuteExtras';
import type { VoiceState } from '../../index';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/features/ui', () => ({
  Popover: {
    Content: ({ children, className }: { children: ReactNode; className?: string }) =>
      <div data-testid="popover-content" className={className}>{children}</div>,
  },
}));

vi.mock('../GainControl', () => ({
  GainControl: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid="gain-control" data-disabled={String(!!disabled)} />
  ),
}));

vi.mock('@iconify/react', () => ({
  Icon: () => null,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultVoiceState: Pick<VoiceState, 'cleanMode' | 'gain' | 'isConnected' | 'autoGain'> = {
  cleanMode: false,
  gain: 1,
  isConnected: false,
  autoGain: true,
};

const buildProps = (
  voiceStateOverrides: Partial<typeof defaultVoiceState> = {},
  propOverrides: Partial<React.ComponentProps<typeof MuteExtras>> = {},
) => ({
  voiceState: { ...defaultVoiceState, ...voiceStateOverrides },
  cleanInputReport: null,
  handleCleanModeToggle: vi.fn(),
  handleGainChangeWithState: vi.fn(),
  ...propOverrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MuteExtras', () => {
  describe('Clean Mode button', () => {
    it('has btn-outline class when cleanMode=false', () => {
      const props = buildProps({ cleanMode: false });
      render(<MuteExtras {...props} />);

      const btn = screen.getByTitle(/enable clean mode/i);
      expect(btn.className).toContain('btn-outline');
    });

    it('has btn-warning class when cleanMode=true', () => {
      const props = buildProps({ cleanMode: true });
      render(<MuteExtras {...props} />);

      const btn = screen.getByTitle(/disable clean mode/i);
      expect(btn.className).toContain('btn-warning');
    });

    it('calls handleCleanModeToggle when clicked', () => {
      const handleCleanModeToggle = vi.fn();
      const props = buildProps({ cleanMode: false }, { handleCleanModeToggle });
      render(<MuteExtras {...props} />);

      fireEvent.click(screen.getByTitle(/enable clean mode/i));

      expect(handleCleanModeToggle).toHaveBeenCalledTimes(1);
    });
  });

  describe('GainControl', () => {
    it('is disabled when isConnected=false', () => {
      const props = buildProps({ isConnected: false, autoGain: false });
      render(<MuteExtras {...props} />);

      expect(screen.getByTestId('gain-control').dataset.disabled).toBe('true');
    });

    it('is disabled when autoGain=true', () => {
      const props = buildProps({ isConnected: true, autoGain: true });
      render(<MuteExtras {...props} />);

      expect(screen.getByTestId('gain-control').dataset.disabled).toBe('true');
    });

    it('is enabled when isConnected=true and autoGain=false', () => {
      const props = buildProps({ isConnected: true, autoGain: false });
      render(<MuteExtras {...props} />);

      expect(screen.getByTestId('gain-control').dataset.disabled).toBe('false');
    });
  });

  describe('open state', () => {
    it('renders content inside Popover.Content', () => {
      render(<MuteExtras {...buildProps()} />);

      expect(screen.getByTestId('popover-content')).toBeInTheDocument();
    });
  });
});
