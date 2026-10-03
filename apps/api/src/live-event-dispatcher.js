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

  /**
   * Probe a client cursor only when it is ahead of this process. A new API
   * process also starts at zero, so that difference alone is not a restore.
   * @param {number} after
   */
  async reconcileAhead(after) {
    if (after <= this.cursor) return null;
    const batch = await this.operations.readLiveEvents({ after });
    if (!batch.reset) {
      // The first browser may already be caught up after an API restart.
      // Start the shared poll from its validated cursor instead of replaying
      // a historical backlog and issuing an unnecessary reset.
      if (this.listeners.size === 0 && !this.polling) this.cursor = after;
      return null;
    }
    if (batch.cursor >= after) return null;
    this.cursor = batch.cursor;
    const event = {
      cursor: this.cursor,
      payload: { cursor: this.cursor },
      type: 'stream.reset',
    };
    this.emit(event);
    return event;
  }

  /** @param {(event: any) => void} listener @param {number} [after] */
  subscribe(listener, after = 0) {
    this.listeners.add(listener);
    // Another operator may have kept this shared dispatcher ahead while this
    // reader was disconnected. Force a fresh authorized read on reconnection.
    if (after < this.cursor) {
      listener({
        cursor: this.cursor,
        payload: { cursor: this.cursor },
        type: 'stream.reset',
      });
    }
    if (!this.timer) {
      void this.poll();
      this.timer = globalThis.setInterval(
        () => void this.poll(),
        POLL_INTERVAL_MS,
      );
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
      const batch = await this.operations.readLiveEvents({
        after: this.cursor,
      });
      if (batch.reset) {
        this.cursor = batch.cursor;
        this.emit({
          cursor: this.cursor,
          payload: { cursor: this.cursor },
          type: 'stream.reset',
        });
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
