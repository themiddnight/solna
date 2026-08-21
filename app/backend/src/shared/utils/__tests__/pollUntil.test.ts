import { pollUntil } from '../pollUntil';

describe('pollUntil', () => {
  it('resolves true immediately when the condition is already met (no waiting)', async () => {
    const start = Date.now();
    const didResolve = await pollUntil(() => true, { timeoutMs: 1000, intervalMs: 20 });
    expect(didResolve).toBe(true);
    expect(Date.now() - start).toBeLessThan(20);
  });

  it('resolves true once an in-flight task flips the condition before the timeout', async () => {
    let isReady = false;
    // Simulate another event-loop task (e.g. a disconnect handler registering grace state).
    setTimeout(() => { isReady = true; }, 40);

    const didResolve = await pollUntil(() => isReady, { timeoutMs: 1000, intervalMs: 10 });
    expect(didResolve).toBe(true);
  });

  it('resolves false when the condition never becomes true within the timeout', async () => {
    const start = Date.now();
    const didResolve = await pollUntil(() => false, { timeoutMs: 60, intervalMs: 10 });
    expect(didResolve).toBe(false);
    expect(Date.now() - start).toBeGreaterThanOrEqual(60);
  });
});
