import { useEffect } from 'react';
import { Icon } from "@/shared/ui";
import { t } from "@lingui/core/macro";
import { useAudioDevices } from '@/features/audio/hooks/useAudioDevices';
import { Select } from '@/features/ui';
import { cn } from '@/shared/utils/cn';

interface AudioInputSelectorProps {
  value: string | null;
  onChange: (deviceId: string) => void;
  className?: string;
  showLabel?: boolean;
}

export const AudioInputSelector: React.FC<AudioInputSelectorProps> = ({
  value,
  onChange,
  className = '',
  showLabel = true,
}) => {
  const { inputDevices, isPermissionGranted, requestAccess, refreshDevices } = useAudioDevices();

  // Auto-select first device if no device is selected, or if selected device is removed
  useEffect(() => {
    if (!isPermissionGranted || inputDevices.length === 0) {
      return;
    }

    const hasCurrentDevice = value != null && inputDevices.some(d => d.deviceId === value);

    if (!hasCurrentDevice) {
      const firstDevice = inputDevices[0];
      if (firstDevice) {
        onChange(firstDevice.deviceId);
      } else {
        return;
      }
    }
  }, [inputDevices, value, onChange, isPermissionGranted]);

  if (!isPermissionGranted) {
    return (
      <div className={`form-control ${className}`}>
        {showLabel && (
          <label className="label text-sm mr-1">{t`Audio Input`}</label>
        )}
        <button
          onClick={() => requestAccess().then(() => refreshDevices())}
          className="btn btn-xs btn-warning btn-outline"
        >
          {t`Enable Mic Access`}
        </button>
      </div>
    );
  }

  return (
    <div className={`form-control ${className}`}>
      {showLabel && (
          <label className="label text-sm mr-1">{t`Audio Input`}</label>
      )}
      <CustomDeviceSelect
        devices={inputDevices}
        value={value ?? ''}
        onChange={onChange}
      />
    </div>
  );
};

// ─── Custom device dropdown (Radix Select) ───

interface CustomDeviceSelectProps {
  devices: Array<{ deviceId: string; label: string }>;
  value: string;
  onChange: (deviceId: string) => void;
}

const CustomDeviceSelect = ({ devices, value, onChange }: CustomDeviceSelectProps) => (
  <Select.Root
    value={value}
    onValueChange={onChange}
    disabled={devices.length === 0}
  >
    <Select.Trigger
      aria-label={t`Select audio input device`}
      className={cn(
        "inline-flex items-center justify-between gap-1",
        "select select-bordered select-xs w-full min-w-32 max-w-64",
        "cursor-pointer select-none",
        "disabled:opacity-50 disabled:cursor-not-allowed",
      )}
    >
      <span className="truncate flex-1 text-left text-xs">
        <Select.Value placeholder={t`Select Input Device`} />
      </span>
    </Select.Trigger>

    <Select.Content>
      {devices.map((device) => (
        <Select.Item
          key={device.deviceId}
          value={device.deviceId}
          className="data-[state=checked]:text-primary"
        >
          <Select.ItemText>
            <span
              className="font-medium leading-tight truncate flex-1"
              title={device.label}
            >
              {device.label}
            </span>
          </Select.ItemText>
          <Select.ItemIndicator className="ml-auto">
            <Icon name="check" className="text-primary shrink-0 text-xs" />
          </Select.ItemIndicator>
        </Select.Item>
      ))}
    </Select.Content>
  </Select.Root>
);
