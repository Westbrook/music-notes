import { afterEach, describe, expect, it } from 'vitest';
import { html, LitElement } from 'lit';
import { Signal } from 'signal-polyfill';
import { SignalController } from '../src/ui/signal-controller.js';

class SignalFixture extends LitElement {
  source = new Signal.State(0);
  readonly observer = new SignalController(this, () => this.source.get());
  renders = 0;
  protected override render() { this.renders++; return html`<output>${this.observer.value}</output>`; }
}
customElements.define('signal-controller-fixture', SignalFixture);

async function settle(element: SignalFixture): Promise<void> {
  await Promise.resolve();
  await element.updateComplete;
}
afterEach(() => document.body.replaceChildren());

describe('SignalController lifecycle', () => {
  it('coalesces writes and continues reacting over successive update cycles', async () => {
    const element = new SignalFixture(); document.body.append(element); await settle(element);
    const initial = element.renders;
    element.source.set(1); element.source.set(2); await settle(element);
    expect(element.shadowRoot!.textContent).toBe('2');
    expect(element.renders).toBe(initial + 1);
    element.source.set(3); await settle(element);
    expect(element.shadowRoot!.textContent).toBe('3');
    expect(element.renders).toBe(initial + 2);
  });

  it('cancels a queued notification on disconnect and observes current state on reconnect', async () => {
    const element = new SignalFixture(); document.body.append(element); await settle(element);
    const initial = element.renders;
    element.source.set(1); element.remove(); await settle(element);
    element.source.set(2); await settle(element);
    expect(element.renders).toBe(initial);
    document.body.append(element); await settle(element);
    expect(element.shadowRoot!.textContent).toBe('2');
    element.source.set(3); await settle(element);
    expect(element.shadowRoot!.textContent).toBe('3');
  });

  it('releases a replaced store and subscribes to the new one', async () => {
    const element = new SignalFixture(); document.body.append(element); await settle(element);
    const original = element.source;
    element.source = new Signal.State(8); element.observer.refresh(); await settle(element);
    expect(element.shadowRoot!.textContent).toBe('8');
    const renders = element.renders;
    original.set(9); await settle(element);
    expect(element.renders).toBe(renders);
    element.source.set(10); await settle(element);
    expect(element.shadowRoot!.textContent).toBe('10');
  });
});
