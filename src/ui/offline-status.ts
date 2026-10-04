import { html, LitElement } from 'lit';

/** Installation state owns only its own text, independently of musical state. */
class OfflineStatus extends LitElement {
  private message = import.meta.env.PROD ? 'Preparing this device for offline use…' : 'Offline setup is available in the production app.';

  override connectedCallback(): void {
    super.connectedCallback();
    if (import.meta.env.PROD) void this.prepare();
  }

  private async prepare(): Promise<void> {
    try {
      if (!('serviceWorker' in navigator)) throw new Error('Unavailable');
      const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL, updateViaCache: 'none',
      });
      const worker = registration.installing;
      if (!registration.active && worker) {
        await new Promise<void>((resolve, reject) => {
          const check = (): void => {
            if (worker.state === 'activated') { worker.removeEventListener('statechange', check); resolve(); }
            if (worker.state === 'redundant') { worker.removeEventListener('statechange', check); reject(new Error('Setup failed')); }
          };
          worker.addEventListener('statechange', check); check();
        });
      }
      if (!registration.active) throw new Error('No active worker');
      // Storage may have been evicted independently of the registration.
      // Verify (and, online, repair) this release before claiming readiness.
      await new Promise<void>((resolve, reject) => {
        const channel = new MessageChannel();
        const finish = (ready: boolean): void => {
          clearTimeout(timeout); channel.port1.close();
          if (ready) resolve(); else reject(new Error('Offline files unavailable'));
        };
        const timeout = setTimeout(() => finish(false), 30_000);
        channel.port1.onmessage = event => finish(event.data === true);
        registration.active!.postMessage('prepare-offline', [channel.port2]);
      });
      this.message = 'Ready for offline use. Close all Music Notes windows and reopen to apply downloaded updates.';
    } catch {
      this.message = 'Offline setup is unavailable. Keep a connection and reopen the app to try again.';
    }
    this.requestUpdate();
  }

  protected override render() { return html`<span role="status">${this.message}</span>`; }
}

if (!customElements.get('music-offline-status')) customElements.define('music-offline-status', OfflineStatus);
