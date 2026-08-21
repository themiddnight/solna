/** One selectable audio output device. */
export interface OutputOption {
  deviceId: string;
  label: string;
}

/**
 * Notified with the sink that ended up applied whenever the router applies one the
 * caller did not ask for (the D3 fallback). `null` = system default.
 */
export type OutputSinkListener = (appliedSinkId: string | null) => void;

/** Removes a previously registered {@link OutputSinkListener}. */
export type Unsubscribe = () => void;

/**
 * Seam for routing app audio to a chosen output device.
 *
 * Kept deliberately minimal: only what a real implementation calls today.
 * Do NOT add methods in anticipation of a future Capacitor/native backend —
 * that backend does not exist yet, so any guess at its shape would be fiction.
 */
export interface OutputRouter {
  /** Whether this platform can route output at all. Drives whether the UI renders. */
  isSupported(): boolean;
  /** Selectable output devices. Empty when unsupported. */
  listOutputs(): Promise<OutputOption[]>;
  /**
   * Choose an output device. `null` = system default.
   *
   * Resolves to the sink actually applied, which is not always the one requested:
   * if a context is already attached and the device is gone (unplugged since last
   * session) the router falls back to the system default and resolves `null` instead
   * of rejecting (D3 — audio must keep playing on the default rather than go silent
   * or throw).
   *
   * When no context is attached yet nothing has been applied, so the resolved value
   * is just the request echoed back — it cannot report a fallback that has not been
   * attempted. That is the common case on page load (the AudioContext is created
   * lazily on the first user gesture), so persisting callers must correct their state
   * from {@link OutputRouter.subscribe}, not from this return value.
   */
  setOutput(deviceId: string | null): Promise<string | null>;
  /**
   * Apply the currently chosen output to a context. Called by audioContextManager
   * every time an AudioContext is created — contexts get rebuilt (Safari), and
   * without this the user's choice would silently vanish on rebuild.
   */
  applyToContext(context: AudioContext): Promise<void>;
  /**
   * Observe sinks the router applied on its own initiative — today only the D3
   * fallback to the system default when the chosen device turns out to be gone.
   * Fires whenever that happens, whichever call triggered the apply, so a persisting
   * caller has one place to correct itself instead of having to guess when a deferred
   * apply might have diverged from what it asked for.
   *
   * The router still owns no persistence and writes to none (TR-38: engine must not
   * import features) — it only reports, the feature layer decides what to store.
   */
  subscribe(listener: OutputSinkListener): Unsubscribe;
}
