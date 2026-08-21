/**
 * Await a synchronous condition that another event-loop task is expected to make true shortly.
 *
 * Checks `predicate` immediately, then re-checks every `intervalMs` until it returns true or
 * `timeoutMs` elapses. The `await` between checks yields to the event loop, so an in-flight
 * task (e.g. a socket 'disconnect' handler that registers grace-period state) can run and
 * satisfy the condition. Resolves `true` if the condition became true, `false` on timeout.
 *
 * Intended for short, bounded coordination gaps — not for long-running waits.
 */
export async function pollUntil(
  predicate: () => boolean,
  options: { timeoutMs: number; intervalMs: number },
): Promise<boolean> {
  if (predicate()) return true;
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, options.intervalMs));
    if (predicate()) return true;
  }
  return false;
}
