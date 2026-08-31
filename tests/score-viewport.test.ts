// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScoreViewport } from '../src/authoring/ui/score-viewport.js';

afterEach(() => document.body.replaceChildren());

describe('encapsulated Author score viewport', () => {
  it('mounts synchronously and retains separate controller mounts and caller-owned slot content', async () => {
    const viewport = document.createElement('music-score-viewport');
    document.body.append(viewport); viewport.mount();
    expect(viewport).toBeInstanceOf(ScoreViewport);
    const scoreMount = viewport.scoreMount, overlayMount = viewport.overlayMount, previewMount = viewport.previewMount;
    const score = document.createElement('music-system'); score.id = 'outside-control';
    const outside = document.createElement('button'); outside.id = 'outside-control'; document.body.prepend(outside);
    scoreMount.append(score);
    const action = document.createElement('button'); action.slot = 'actions'; action.textContent = 'Do something';
    const help = document.createElement('p'); help.slot = 'help'; help.textContent = 'Keyboard help';
    viewport.append(action, help);
    const selection = document.createElement('div'), preview = document.createElement('div');
    overlayMount.append(selection); previewMount.append(preview);
    action.focus(); viewport.requestUpdate(); await viewport.updateComplete;
    expect(viewport.scoreMount).toBe(scoreMount); expect(viewport.surface).toBe(score);
    expect(viewport.overlayMount).toBe(overlayMount); expect(viewport.previewMount).toBe(previewMount);
    expect(score.parentElement).toBe(scoreMount);
    expect(document.getElementById('outside-control')).toBe(outside);
    expect(action.parentElement).toBe(viewport); expect(help.parentElement).toBe(viewport);
    expect(viewport.shadowRoot!.querySelector('slot[name="actions"]')).not.toBeNull();
    expect(viewport.shadowRoot!.querySelector('slot[name="help"]')).not.toBeNull();
    expect(document.activeElement).toBe(action);
    overlayMount.replaceChildren();
    expect(preview.parentElement).toBe(previewMount);
    expect(overlayMount.getAttribute('aria-hidden')).toBe('true');
    expect(previewMount.getAttribute('aria-hidden')).toBe('true');
    expect(action.closest('[aria-hidden="true"]')).toBeNull();
    const bounds = new DOMRect(5, 10, 120, 30);
    vi.spyOn(action, 'getClientRects').mockReturnValue([bounds] as unknown as DOMRectList);
    vi.spyOn(action, 'getBoundingClientRect').mockReturnValue(bounds);
    expect(viewport.getNativeControlBounds()).toEqual([bounds]);
    viewport.remove(); document.body.append(viewport); await viewport.updateComplete;
    expect(viewport.scoreMount).toBe(scoreMount); expect(preview.parentElement).toBe(previewMount);
  });

  it('announces private score scrolling across an outer shadow boundary and stops when disconnected', async () => {
    const outer = document.createElement('div');
    const viewport = document.createElement('music-score-viewport');
    outer.attachShadow({ mode: 'open' }).append(viewport); document.body.append(outer); viewport.mount();
    const listener = vi.fn(); outer.addEventListener('notation-viewport-change', listener);
    viewport.scoreMount.dispatchEvent(new Event('scroll'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({ bubbles: true, composed: true,
      detail: { scroller: viewport.scoreMount, layout: undefined } });
    viewport.remove(); viewport.scoreMount.dispatchEvent(new Event('scroll'));
    expect(listener).toHaveBeenCalledTimes(1);
    document.body.append(viewport); await viewport.updateComplete;
    const reconnected = vi.fn(); viewport.addEventListener('notation-viewport-change', reconnected);
    viewport.scoreMount.dispatchEvent(new Event('scroll'));
    expect(reconnected).toHaveBeenCalledTimes(1);
  });
});
