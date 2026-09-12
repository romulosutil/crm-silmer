const POLL_INTERVAL_MS = 1_000;

/**
 * Fans one incremental database read out to every connected operator. Event
 * payloads are deliberately limited to aggregate references; screens reload
 * their authorized read models after receiving them.
 */
export class LiveEventDispatcher {
  /** @param {{readLiveEvents: Function}} operations */
  constructor(operations) {
    this.operations = operations;
    this.cursor = 0;
    this.listeners = new Set();
    this.timer = undefined;
    this.polling = false;
  }

  /** @param {(event: any) => void} listener */
  subscribe(listener) {
    this.listeners.add(listener);
    if (!this.timer) {
      void this.poll();
      this.timer = globalThis.setInterval(() => void this.poll(), POLL_INTERVAL_MS);
      this.timer.unref?.();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.timer) {
        globalThis.clearInterval(this.timer);
        this.timer = undefined;
      }
    };
  }

  async poll() {
    if (this.polling || this.listeners.size === 0) return;
    this.polling = true;
    try {
      const batch = await this.operations.readLiveEvents({ after: this.cursor });
      if (batch.reset) {
        this.cursor = batch.cursor;
        this.emit({ cursor: this.cursor, payload: { cursor: this.cursor }, type: 'stream.reset' });
        return;
      }
      for (const event of batch.events) this.emit(event);
      this.cursor = batch.cursor;
    } finally {
      this.polling = false;
    }
  }

  /** @param {any} event */
  emit(event) {
    for (const listener of this.listeners) listener(event);
  }
}
