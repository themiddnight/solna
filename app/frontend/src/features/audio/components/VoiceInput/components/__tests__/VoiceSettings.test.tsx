/* eslint-disable */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { VoiceSettings } from '../VoiceSettings';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/features/ui', () => ({
  Popover: {
    Root: ({ open, children }: { open?: boolean; children: ReactNode }) =>
      open !== false ? <>{children}</> : null,
    Trigger: ({ asChild, children }: { asChild?: boolean; children: ReactNode }) =>
      <>{children}</>,
    Content: ({ children, className }: { children: ReactNode; className?: string }) =>
      <div data-testid="popover-content" className={className}>{children}</div>,
    Anchor: ({ children }: { children: ReactNode }) => <>{children}</>,
  },
  Switch: ({
    checked,
    onCheckedChange,
    disabled,
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    disabled?: boolean;
  }) => (
    <input
      type="checkbox"
      checked={checked ?? false}
      disabled={disabled}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
    />
  ),
}));

vi.mock('@/features/audio/components/AudioInputSelector', () => ({
  AudioInputSelector: () => <div data-testid="audio-input-selector" />,
}));

vi.mock('@iconify/react', () => ({
  Icon: () => null,
}));

vi.mock('@/shared/ui', () => ({
  Icon: () => null,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = () => {};

const buildProps = (
  propOverrides: Partial<React.ComponentProps<typeof VoiceSettings>> = {},
) => ({
  isConnected: false,
  voiceInputDeviceId: null,
  setVoiceInputDeviceId: vi.fn(),
  handleConnect: vi.fn(),
  handleDisconnect: noop,
  ...propOverrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VoiceSettings', () => {
  describe('Input device selector', () => {
    it('renders the AudioInputSelector', () => {
      render(<VoiceSettings {...buildProps()} />);

      expect(screen.getByTestId('audio-input-selector')).toBeInTheDocument();
    });
  });

  describe('Connect/Disconnect toggle', () => {
    it('renders checkbox as checked when isConnected=true', () => {
      const props = buildProps({ isConnected: true });
      render(<VoiceSettings {...props} />);

      const checkbox = screen.getByRole('checkbox');
      expect(checkbox).toBeChecked();
    });

    it('renders checkbox as unchecked when isConnected=false', () => {
      const props = buildProps({ isConnected: false });
      render(<VoiceSettings {...props} />);

      const checkbox = screen.getByRole('checkbox');
      expect(checkbox).not.toBeChecked();
    });

    it('calls handleConnect when checkbox is checked', () => {
      const handleConnect = vi.fn();
      const props = buildProps({ isConnected: false, handleConnect });
      render(<VoiceSettings {...props} />);

      fireEvent.click(screen.getByRole('checkbox'));

      expect(handleConnect).toHaveBeenCalledTimes(1);
    });

    it('calls handleDisconnect when checkbox is unchecked', () => {
      const handleDisconnect = vi.fn();
      const props = buildProps({ isConnected: true, handleDisconnect });
      render(<VoiceSettings {...props} />);

      fireEvent.click(screen.getByRole('checkbox'));

      expect(handleDisconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('open state', () => {
    it('renders content when Popover.Root is open (default)', () => {
      // VoiceSettings renders Popover.Content directly; visibility is gated by
      // the parent Popover.Root. The mock renders content when open is not false.
      render(<VoiceSettings {...buildProps()} />);

      expect(screen.getByTestId('popover-content')).toBeInTheDocument();
    });
  });

  describe('Voice Mesh diagnostics', () => {
    it('is not rendered when isConnected=false even with onRetryConnections', () => {
      render(
        <VoiceSettings
          {...buildProps({ isConnected: false })}
          onRetryConnections={vi.fn()}
          connectedPeers={1}
          totalPeers={2}
        />,
      );
      expect(screen.queryByTestId('voice-settings-mesh-section')).toBeNull();
    });

    it('is not rendered when onRetryConnections is not provided even if connected', () => {
      render(
        <VoiceSettings
          {...buildProps({ isConnected: true })}
          connectedPeers={2}
          totalPeers={2}
        />,
      );
      expect(screen.queryByTestId('voice-settings-mesh-section')).toBeNull();
    });

    it('is rendered when isConnected=true AND onRetryConnections is provided', () => {
      render(
        <VoiceSettings
          {...buildProps({ isConnected: true })}
          onRetryConnections={vi.fn()}
          connectedPeers={2}
          totalPeers={3}
        />,
      );
      expect(screen.getByTestId('voice-settings-mesh-peer-count').textContent).toBe(
        '2/3 peers connected',
      );
    });

    it('shows a warning when connectedPeers < totalPeers', () => {
      render(
        <VoiceSettings
          {...buildProps({ isConnected: true })}
          onRetryConnections={vi.fn()}
          connectedPeers={1}
          totalPeers={3}
        />,
      );
      expect(screen.getByTestId('voice-settings-mesh-warning').textContent).toMatch(
        /only 1 of 3 connections active/i,
      );
    });

    it('does NOT show a warning when connectedPeers === totalPeers', () => {
      render(
        <VoiceSettings
          {...buildProps({ isConnected: true })}
          onRetryConnections={vi.fn()}
          connectedPeers={3}
          totalPeers={3}
        />,
      );
      expect(screen.queryByTestId('voice-settings-mesh-warning')).toBeNull();
    });

    it('calls onRetryConnections when Retry is clicked', () => {
      const onRetryConnections = vi.fn();
      render(
        <VoiceSettings
          {...buildProps({ isConnected: true })}
          onRetryConnections={onRetryConnections}
          connectedPeers={1}
          totalPeers={2}
        />,
      );

      screen.getByTestId('voice-settings-mesh-retry-btn').click();

      expect(onRetryConnections).toHaveBeenCalledTimes(1);
    });
  });
});
