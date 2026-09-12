/**
 * Named events published per topic by `GET /api/v1/events`. A topic that is not
 * listed here would connect but never deliver anything, so keep this in sync
 * with the API event formatter.
 */
/** @type {Readonly<Record<string, readonly string[]>>} */
const TOPIC_EVENTS = Object.freeze({
  inbox: Object.freeze(['inbox.contact.changed', 'inbox.conversation.changed']),
});

export const LIVE_TOPICS = Object.freeze(Object.keys(TOPIC_EVENTS));

export class LiveEventStream {
  /** @param {{onChange:(event:Record<string,any>)=>void,onReset:()=>void,onState:(state:string)=>void}} handlers */
  constructor(handlers) {
    this.handlers = handlers;
    // stream_cursor is a single global sequence, so one cursor stays valid
    // across topics; events the current topic does not select are simply not
    // delivered.
    this.cursor = '';
    this.source = null;
    this.topic = 'inbox';
  }

  /** @param {string} [topic] @param {string} [cursor] */
  start(topic = this.topic, cursor = this.cursor) {
    const nextTopic = TOPIC_EVENTS[topic] ? topic : 'inbox';
    this.close();
    this.topic = nextTopic;
    this.cursor = cursor || this.cursor;
    const query = new globalThis.URLSearchParams({ topic: nextTopic });
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
    for (const name of TOPIC_EVENTS[nextTopic]) {
      this.source.addEventListener(name, (event) => this.consume(event, false));
    }
    this.source.addEventListener('stream.reset', (event) =>
      this.consume(event, true),
    );
    this.source.addEventListener('message', (event) => {
      const parsed = this.parse(event.data);
      if (parsed.type === 'stream.reset') this.consume(event, true);
      else if (TOPIC_EVENTS[nextTopic].includes(parsed.type)) {
        this.consume(event, false);
      }
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
  }
}
