export class KanbanEventStream {
  /** @param {{onChange:(event:Record<string,any>)=>void,onReset:()=>void,onState:(state:string)=>void}} handlers */
  constructor(handlers) {
    this.handlers = handlers;
    this.cursor = '';
    this.source = null;
    this.timer = 0;
  }
  /** @param {string} [cursor] */
  start(cursor = this.cursor) {
    this.close();
    this.cursor = cursor || this.cursor;
    const query = new globalThis.URLSearchParams({ topic: 'kanban' });
    if (this.cursor) query.set('after', this.cursor);
    const Source = globalThis.EventSource;
    if (!Source) {
      this.handlers.onState('indisponível');
      return;
    }
    this.handlers.onState('conectando');
    this.source = new Source(`/api/v1/events?${query}`, {
      withCredentials: true,
    });
    this.source.addEventListener('open', () =>
      this.handlers.onState('conectado'),
    );
    this.source.addEventListener('kanban.card.changed', (event) =>
      this.consume(event, false),
    );
    this.source.addEventListener('stream.reset', (event) =>
      this.consume(event, true),
    );
    this.source.addEventListener('message', (event) => {
      const parsed = this.parse(event.data);
      if (parsed.type === 'kanban.card.changed') this.consume(event, false);
      if (parsed.type === 'stream.reset') this.consume(event, true);
    });
    this.source.addEventListener('error', () =>
      this.handlers.onState('reconectando'),
    );
  }
  /** @param {MessageEvent} event @param {boolean} reset */
  consume(event, reset) {
    if (event.lastEventId) this.cursor = event.lastEventId;
    const payload = this.parse(event.data);
    if (payload.cursor) this.cursor = String(payload.cursor);
    reset ? this.handlers.onReset() : this.handlers.onChange(payload);
  }
  /** @param {string} value */
  parse(value) {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  close() {
    if (this.source) this.source.close();
    this.source = null;
    if (this.timer) globalThis.clearTimeout(this.timer);
  }
}
