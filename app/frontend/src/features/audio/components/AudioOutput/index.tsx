import { memo, useCallback, useEffect, useState } from "react";
import { t } from "@lingui/core/macro";
import { Icon } from "@/shared/ui";
import { Popover } from "@/features/ui";
import { getOutputRouter } from "@/engine/audio/outputRouter";
import { useAudioDevices } from "@/features/audio/hooks/useAudioDevices";
import { useAudioDeviceStore } from "@/features/audio/stores/audioDeviceStore";
import { outputDeviceIconName } from "@/features/audio/utils/outputDeviceIcon";
import type { OutputOption } from "@/engine/audio/outputRouter";

interface AudioOutputProps {
  /** Side the panel opens toward (away from the sidebar edge). Default "left". */
  side?: "top" | "right" | "bottom" | "left";
}

const AudioOutputComponent = ({ side = "left" }: AudioOutputProps) => {
  const router = getOutputRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [outputOptions, setOutputOptions] = useState<OutputOption[]>([]);

  const outputDeviceId = useAudioDeviceStore((s) => s.outputDeviceId);
  const setOutputDeviceId = useAudioDeviceStore((s) => s.setOutputDeviceId);
  const {
    isPermissionGranted,
    requestAccess,
    refreshDevices,
    devices: mediaDevices,
  } = useAudioDevices();

  const isSupported = router.isSupported();

  // The router is engine-local runtime state and starts empty on every page load,
  // so the persisted choice has to be pushed back in. Safe to run before the
  // AudioContext exists: applyToContext replays it when the context appears.
  // Reactive (not mount-only) so this is the single writer to the router — it also
  // pushes selections made via handleSelect — and stays correct if the store ever
  // moves to an async storage backend where the persisted value arrives after the
  // first render.
  //
  // `null` is pushed too, not skipped: it is a real choice ("system default"), and
  // skipping it would leave the router on the previously chosen device after the user
  // deliberately went back to default.
  //
  // Keyed off `mediaDevices` as well, so a re-plug re-applies. Chromium silently
  // reverts the sink to the system default when the active device disappears; without
  // this the store would still point at it and nothing would ever re-apply, leaving
  // the popover showing a device that is not actually receiving audio.
  useEffect(() => {
    if (!isSupported) return;
    void router.setOutput(outputDeviceId);
  }, [isSupported, outputDeviceId, router, mediaDevices]);

  // The correction path for D3. It has to be a subscription rather than the resolved
  // value of `setOutput` above: on a fresh load the AudioContext usually does not
  // exist yet (autoplay policy defers it to the first user gesture), so that push
  // applies nothing and resolves with the id it was handed. The device only turns out
  // to be dead later, inside `applyToContext`. Correcting from the resolved value
  // therefore never fired and a dead persisted id survived every reload.
  //
  // Still a single writer: the router reports, this is the one place that turns a
  // router-initiated fallback into a store write.
  useEffect(() => {
    if (!isSupported) return;
    return router.subscribe((appliedSinkId) => {
      setOutputDeviceId(appliedSinkId);
    });
  }, [isSupported, router, setOutputDeviceId]);

  // Loads whenever the platform supports routing and mic permission is granted —
  // NOT gated on the popover being open. Spec §3.4 requires the trigger's icon to
  // reflect the current selection at all times, which needs the list before the
  // user ever opens the popover. `listOutputs()` just wraps `enumerateDevices()`,
  // which `useAudioDevices` already calls on mount, so this isn't a new expensive
  // call. Keyed off `mediaDevices` (not just mount) so unplugging the active device
  // while the popover is open also refreshes this router-backed list — `useAudioDevices`
  // already re-enumerates on the browser's `devicechange` event.
  //
  // Cancelled on cleanup so a slow enumeration from a previous device set cannot
  // resolve last and overwrite a newer one.
  useEffect(() => {
    if (!isSupported || !isPermissionGranted) return;
    let isCancelled = false;
    void router
      .listOutputs()
      .then((options) => {
        if (!isCancelled) setOutputOptions(options);
      })
      .catch((error: unknown) => {
        console.error("Error listing audio output devices:", error);
      });
    return () => {
      isCancelled = true;
    };
  }, [isSupported, isPermissionGranted, router, mediaDevices]);

  const handleSelect = useCallback(
    (deviceId: string | null) => {
      setOutputDeviceId(deviceId);
      setIsOpen(false);
    },
    [setOutputDeviceId],
  );

  const handleRequestAccess = useCallback(() => {
    void requestAccess().then(() => refreshDevices());
  }, [requestAccess, refreshDevices]);

  // D1: capability decides visibility, not viewport. iOS Safari and Firefox fall out
  // here on their own, and the cell reappears by itself if they ever ship setSinkId.
  if (!isSupported) return null;

  const selected = outputOptions.find((d) => d.deviceId === outputDeviceId);

  // `MediaDeviceInfo.label` is empty until device permission is granted, and a device
  // can stay unlabelled even after (cf. useAudioDevices) — never render a blank row.
  const labelOf = (label: string): string => (label === "" ? t`Unnamed device` : label);

  // `display: contents` so the button joins the call site's row directly. This
  // component is a bare control like MidiSettingsPopover — the surrounding cell
  // (border, padding, strip sizing) belongs to whoever mounts it, because the
  // same button sits in a sidebar row on desktop and in the strip on mobile.
  return (
    <div className="contents" data-testid="audio-output">
      <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="btn btn-xs btn-square btn-ghost"
            aria-label={t`Audio output device`}
            title={selected === undefined ? t`Audio output device` : labelOf(selected.label)}
            data-testid="audio-output-trigger"
          >
            <Icon name={outputDeviceIconName(selected?.label)} />
          </button>
        </Popover.Trigger>

        <Popover.Content side={side} align="end" className="w-64 p-3">
          <h4 className="mb-2 text-sm font-semibold">{t`Audio Output`}</h4>

          {!isPermissionGranted ? (
            <>
              <p className="mb-2 text-xs text-base-content/60">
                {t`Device names need audio permission.`}
              </p>
              <button
                type="button"
                onClick={handleRequestAccess}
                className="btn btn-xs btn-warning btn-outline"
                data-testid="audio-output-request-access"
              >
                {t`Enable Audio Access`}
              </button>
            </>
          ) : (
            <ul className="flex flex-col gap-1" data-testid="audio-output-list">
              {/*
                The model's own "system default" value is `null`, and D3 falls back to
                it on its own — but without an explicit entry the user could never
                deliberately go back to it. Chromium's enumerated `"default"` device is
                a different value than `null` and would not clear the stored id.
              */}
              <li>
                <button
                  type="button"
                  onClick={() => handleSelect(null)}
                  className={`btn btn-sm w-full justify-start gap-2 ${
                    outputDeviceId === null ? "btn-primary" : "btn-ghost"
                  }`}
                  data-testid="audio-output-system-default"
                >
                  <Icon name={outputDeviceIconName(undefined)} className="shrink-0" />
                  <span className="truncate text-left text-xs">{t`System default`}</span>
                </button>
              </li>
              {outputOptions.map((device) => (
                <li key={device.deviceId}>
                  <button
                    type="button"
                    onClick={() => handleSelect(device.deviceId)}
                    className={`btn btn-sm w-full justify-start gap-2 ${
                      device.deviceId === outputDeviceId ? "btn-primary" : "btn-ghost"
                    }`}
                  >
                    <Icon name={outputDeviceIconName(device.label)} className="shrink-0" />
                    <span
                      className="truncate text-left text-xs"
                      title={labelOf(device.label)}
                    >
                      {labelOf(device.label)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Popover.Content>
      </Popover.Root>
    </div>
  );
};

export const AudioOutput = memo(AudioOutputComponent);
AudioOutput.displayName = "AudioOutput";
export type { AudioOutputProps };
