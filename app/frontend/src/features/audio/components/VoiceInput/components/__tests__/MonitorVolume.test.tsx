/* eslint-disable */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { MonitorVolume } from '../MonitorVolume';
import { dbToSliderPos } from '@/shared/audio/gainUnits';
import { MONITOR_LEVEL_MIN_DB, MONITOR_LEVEL_MAX_DB } from '../../stores/voiceStateStore';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/features/ui', () => ({
  Popover: {
    Content: ({ children, className }: { children: ReactNode; className?: string }) =>
      <div data-testid="popover-content" className={className}>{children}</div>,
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildProps = (
  propOverrides: Partial<React.ComponentProps<typeof MonitorVolume>> = {},
) => ({
  monitorLevel: -6, // dB (DEV-307 review fix — was 0..1 linear)
  handleMonitorLevelChange: vi.fn(),
  disabled: false,
  ...propOverrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MonitorVolume', () => {
  it('reflects the current monitorLevel as a formatted dB value and mapped slider position', () => {
    render(<MonitorVolume {...buildProps({ monitorLevel: -6 })} />);

    const slider = screen.getByTestId('voice-monitor-level') as HTMLInputElement;
    // Fader maps dB → [0, 1] slider position; -6 dB maps to 0.675
    const expectedPos = dbToSliderPos(-6, MONITOR_LEVEL_MIN_DB, MONITOR_LEVEL_MAX_DB);
    expect(parseFloat(slider.value)).toBeCloseTo(expectedPos, 3);
    expect(screen.getByText('-6.0dB')).toBeInTheDocument();
  });

  it('renders 0dB unity as "0dB"', () => {
    render(<MonitorVolume {...buildProps({ monitorLevel: 0 })} />);

    expect(screen.getByText('0dB')).toBeInTheDocument();
  });

  it('calls handleMonitorLevelChange with the mapped dB value on slider position change', () => {
    const handleMonitorLevelChange = vi.fn();
    render(
      <MonitorVolume
        {...buildProps({ monitorLevel: -6, handleMonitorLevelChange })}
      />,
    );

    // Position 0.75 in non-linear taper maps to 0 dB (unity)
    const unityPos = dbToSliderPos(0, MONITOR_LEVEL_MIN_DB, MONITOR_LEVEL_MAX_DB);
    fireEvent.change(screen.getByTestId('voice-monitor-level'), { target: { value: String(unityPos) } });

    expect(handleMonitorLevelChange).toHaveBeenCalledTimes(1);
    expect(handleMonitorLevelChange).toHaveBeenCalledWith(expect.closeTo(0, 0));
  });

  it('disables the slider when disabled=true (monitoring is off)', () => {
    render(<MonitorVolume {...buildProps({ disabled: true })} />);

    expect(screen.getByTestId('voice-monitor-level')).toBeDisabled();
  });

  it('enables the slider when disabled=false (monitoring is on)', () => {
    render(<MonitorVolume {...buildProps({ disabled: false })} />);

    expect(screen.getByTestId('voice-monitor-level')).toBeEnabled();
  });

  it('renders content inside Popover.Content', () => {
    render(<MonitorVolume {...buildProps()} />);

    expect(screen.getByTestId('popover-content')).toBeInTheDocument();
  });
});
