// A tiny async mutex/queue that guarantees strictly serial execution of the
// supplied tasks. We use it in the bridge orchestrator to make sure:
//   - only one reconfigure / inventory sync / selection change runs at a time,
//   - no two rebuilds touch the runtime registry concurrently,
//   - no parallel MQTT subscribe / unsubscribe races can occur.
// Kept intentionally dependency-free.

export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    // Ensure a failing task does not poison the chain: the tail resolves either
    // way so subsequent `run` calls still execute.
    this.tail = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}
