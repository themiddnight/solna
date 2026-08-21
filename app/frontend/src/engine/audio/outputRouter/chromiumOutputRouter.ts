import type {
  OutputOption,
  OutputRouter,
  OutputSinkListener,
  Unsubscribe,
} from "./types";

/**
 * `AudioContext.setSinkId()` is not in TypeScript's DOM lib, so the shape is
 * declared here. This is a precise structural type, not an `any` escape hatch.
 */
type SinkCapableContext = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

/** Empty string is the platform's own "system default" sentinel for setSinkId. */
const SYSTEM_DEFAULT_SINK = "";

/**
 * Chromium implementation backed by `AudioContext.setSinkId()`.
 *
 * The chosen sink lives here as engine-local runtime state rather than being read
 * from a store — `src/engine/` must not import from `src/features/` (TR-38). The
 * feature layer owns persistence and pushes the remembered value in on mount.
 *
 * @param detectSupport injected so tests can drive both branches without touching
 *        the global AudioContext prototype.
 */
export const createChromiumOutputRouter = (
  detectSupport: () => boolean,
): OutputRouter => {
  let desiredSinkId: string | null = null;
  let attachedContext: SinkCapableContext | null = null;
  const listeners = new Set<OutputSinkListener>();

  const notify = (appliedSinkId: string | null): void => {
    listeners.forEach((listener) => {
      listener(appliedSinkId);
    });
  };

  /** `""` is the platform sentinel; `null` is the public one. */
  const toPublicSinkId = (sinkId: string): string | null =>
    sinkId === SYSTEM_DEFAULT_SINK ? null : sinkId;

  /**
   * A closed context can never accept a sink again, and its rejections say nothing
   * about the device. Contexts are closed and rebuilt (Safari), so this has to be
   * distinguishable from "the device is gone".
   */
  const isUsable = (context: SinkCapableContext): boolean => context.state !== "closed";

  /**
   * Applies `sinkId` to `context` and reports back which sink actually ended up
   * applied (public `string | null` shape). On rejection (D3: remembered device is
   * gone) falls back to the system default silently, drops the dead choice, and
   * notifies subscribers so the feature layer can correct its persisted selection
   * instead of re-pushing the dead id and falling back again on every future load.
   */
  const applySink = async (
    context: SinkCapableContext,
    sinkId: string,
  ): Promise<string | null> => {
    const setSinkId = context.setSinkId;
    if (setSinkId === undefined) {
      return toPublicSinkId(sinkId);
    }

    try {
      await setSinkId.call(context, sinkId);
      return toPublicSinkId(sinkId);
    } catch {
      // A dead/detached context is not evidence that the device is gone, so the
      // user's intent must survive it — otherwise closing a context (without an
      // immediate rebuild) would silently discard the chosen device. Release the
      // reference too: this router is a process-wide singleton and would otherwise
      // pin every context it has ever seen.
      if (!isUsable(context) || attachedContext !== context) {
        if (attachedContext === context) {
          attachedContext = null;
        }
        return desiredSinkId;
      }

      // D3: the remembered device is gone (unplugged between sessions). Fall back to
      // the system default silently — audio surfacing on an unintended speaker is
      // worse than audio on the default one.
      if (sinkId !== SYSTEM_DEFAULT_SINK) {
        desiredSinkId = null;
        try {
          await setSinkId.call(context, SYSTEM_DEFAULT_SINK);
        } catch {
          // Nothing further we can do; leave the context on whatever it had.
        }
        notify(null);
      }
      return null;
    }
  };

  return {
    isSupported: () => detectSupport(),

    listOutputs: async (): Promise<OutputOption[]> => {
      if (!detectSupport()) return [];
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === "audiooutput")
        .map((d) => ({ deviceId: d.deviceId, label: d.label }));
    },

    setOutput: async (deviceId: string | null): Promise<string | null> => {
      if (!detectSupport()) return deviceId;
      desiredSinkId = deviceId;
      // Drop a context that has since been closed rather than calling into it: the
      // rejection would be meaningless and the reference is dead weight.
      if (attachedContext !== null && !isUsable(attachedContext)) {
        attachedContext = null;
      }
      if (attachedContext !== null) {
        return applySink(attachedContext, deviceId ?? SYSTEM_DEFAULT_SINK);
      }
      // No context attached yet: nothing has actually been applied, so there is
      // nothing to contradict the request. `applyToContext` replays `desiredSinkId`
      // (and can itself fall back, notifying subscribers) once a context appears.
      return deviceId;
    },

    applyToContext: async (context: AudioContext): Promise<void> => {
      if (!detectSupport()) return;
      const sinkCapable = context as SinkCapableContext;
      attachedContext = sinkCapable;
      if (desiredSinkId !== null) {
        await applySink(sinkCapable, desiredSinkId);
      }
    },

    subscribe: (listener: OutputSinkListener): Unsubscribe => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
