/**
 * Waiting for a Dexie `liveQuery` to reach a signal.
 *
 * A fixed `setTimeout` is the obvious way to do this and the wrong one: it
 * passes on an idle machine and fails on a loaded one, which produces tests
 * that fail for reasons unrelated to the code under test. Polling a condition
 * returns as soon as it holds and only fails if it never does.
 */
export async function waitUntil(
  predicate: () => boolean,
  { timeout = 2_000, interval = 10 }: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeout;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`Condition did not hold within ${timeout}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/** Wait for a signal-backed collection to be non-empty. */
export async function waitForItems(read: () => { length: number }, timeout = 2_000): Promise<void> {
  await waitUntil(() => read().length > 0, { timeout });
}
