import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { reaction } from 'signal-utils/subtle/reaction';

/**
 * The only bridge between state and Lit. Reads are synchronous; notifications
 * coalesce in a microtask, then Lit batches the DOM update. The view owns the
 * subscription, so disconnected components retain no live state observers.
 */
export class SignalController<T> implements ReactiveController {
  private readonly host: ReactiveControllerHost;
  private readonly read: () => T;
  private stop?: () => void;
  private connected = false;

  constructor(host: ReactiveControllerHost, read: () => T) {
    this.host = host;
    this.read = read;
    host.addController(this);
  }

  get value(): T { return this.read(); }

  hostConnected(): void {
    this.connected = true;
    this.subscribe();
    // State can change while detached, including after a cancelled notification.
    this.host.requestUpdate();
  }

  hostDisconnected(): void {
    this.connected = false;
    this.stop?.();
    this.stop = undefined;
  }

  /** Call when a non-signal dependency (such as an injected store) changes. */
  refresh(): void {
    if (this.connected) this.subscribe();
    this.host.requestUpdate();
  }

  private subscribe(): void {
    this.stop?.();
    this.stop = reaction(this.read, () => this.host.requestUpdate());
  }
}
