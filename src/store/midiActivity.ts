type Listener = () => void;
type Timer = ReturnType<typeof setTimeout>;
type Schedule = (callback: () => void, delayMs: number) => Timer;
type Cancel = (timer: Timer) => void;

/** A tiny external store for the transient MIDI activity indicator. */
export function createMidiActivityStore(
  schedule: Schedule = (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: Cancel = (timer) => clearTimeout(timer),
) {
  let active = false;
  let timer: Timer | undefined;
  const listeners = new Set<Listener>();

  const notify = () => listeners.forEach((listener) => listener());

  return {
    getSnapshot: () => active,
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    trigger() {
      if (timer !== undefined) cancel(timer);
      if (!active) {
        active = true;
        notify();
      }
      timer = schedule(() => {
        timer = undefined;
        if (active) {
          active = false;
          notify();
        }
      }, 250);
    },
  };
}

export const midiActivityStore = createMidiActivityStore();
