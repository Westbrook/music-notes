// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import authorHtml from '../author.html?raw';
import { ActionConfirmation } from '../src/authoring/action-confirmation.js';
import { confirmationReturnTarget } from '../src/authoring/confirmation-focus.js';
import { NativeSurfaces } from '../src/authoring/native-surfaces.js';

const cleanups: (() => void)[] = [];
const surfaceIds = ['location-panel', 'entry-settings', 'source-panel', 'score-setup', 'continuation-review', 'pointer-recovery', 'workspace-review'];

function control<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing actual Author control: ${id}`);
  return element as T;
}

function fixture() {
  const markup = authorHtml.replace(/<link\b[^>]*>/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const shell = new DOMParser().parseFromString(markup, 'text/html');
  document.body.innerHTML = shell.body.innerHTML;
  document.body.dataset.view = 'write';
  document.body.dataset.entryMode = 'false';
  for (const id of surfaceIds) Object.defineProperties(control(id), {
    showPopover: { configurable: true, value: undefined }, hidePopover: { configurable: true, value: undefined },
  });
  const surfaces = new NativeSurfaces({ ids: surfaceIds });
  cleanups.push(() => surfaces.dispose());
  // This focus-policy fixture intentionally omits these surfaces from its
  // local manager. Represent their ordinary in-flow fallback directly; the
  // actual Author Document owner has separate workspace integration coverage.
  for (const id of ['document-menu', 'note-editor']) {
    const panel = control(id);
    panel.removeAttribute('popover');
    panel.dataset.popoverFallback = 'true';
    panel.hidden = true;
  }
  return surfaces;
}

/** Only dialog lifecycle is simulated, not native modal focus or rendering. */
function confirmation(native: boolean) {
  const dialog = control<HTMLDialogElement>('author-confirmation');
  Object.defineProperties(dialog, {
    showModal: { configurable: true, value: native ? () => { dialog.open = true; } : undefined },
    close: { configurable: true, value: native ? () => {
      dialog.open = false;
      dialog.dispatchEvent(new Event('close'));
    } : undefined },
  });
  const manager = new ActionConfirmation();
  cleanups.push(() => manager.dispose());
  return manager;
}

afterEach(() => {
  cleanups.splice(0).reverse().forEach(dispose => dispose());
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.documentElement.scrollTop = 0;
});

describe('confirmation return targets in the actual Author shell', () => {
  it.each([
    ['remove-part', 'document-menu-trigger'],
    ['score-setup-trigger', 'document-menu-trigger'],
    ['new-project', 'document-menu-trigger'],
    ['open-project', 'document-menu-trigger'],
    ['project-file', 'document-menu-trigger'],
    ['add-measure', 'location-trigger'],
    ['event-pitch', 'entry-settings-trigger'],
    ['source-apply', 'source-trigger'],
    ['note-sharp', 'edit-selected-event'],
    ['review-drafts', 'workspace-review-trigger'],
    ['confirm-continue-piece', 'location-trigger'],
    ['confirm-pointer-recovery', 'location-trigger'],
  ])('CONFIRM-RETURN-VISIBLE maps %s to surviving %s', (from, to) => {
    fixture();
    control<HTMLButtonElement>('edit-selected-event').disabled = false;
    control('workspace-review-trigger').hidden = false;
    expect(confirmationReturnTarget(control(from))).toBe(control(to));
  });

  it('retains an exact live persistent invoker without focusing or changing the page', () => {
    fixture();
    control('workspace-tools').hidden = false;
    control('measure-inspector').hidden = false;
    const target = control('remove-measure');
    target.focus();
    const focus = vi.spyOn(target, 'focus');
    document.documentElement.scrollTop = 600;
    control('score-scroll').scrollTop = 1250;
    const html = document.body.innerHTML;
    expect(confirmationReturnTarget(target)).toBe(target);
    expect(confirmationReturnTarget(control('document-menu-trigger'))).toBe(control('document-menu-trigger'));
    expect(focus).not.toHaveBeenCalled();
    expect(document.body.innerHTML).toBe(html);
    expect(document.documentElement.scrollTop).toBe(600);
    expect(control('score-scroll').scrollTop).toBe(1250);
  });

  it('resolves a nested label to its persistent focusable button', () => {
    fixture();
    expect(confirmationReturnTarget(control('selection-context'))).toBe(control('location-trigger'));
  });

  it.each(['hidden', 'inert', 'aria-hidden', 'disabled', 'aria-disabled', 'display', 'visibility', 'content-visibility', 'opacity'])('rejects a primary Location trigger made unavailable by %s', reason => {
    fixture();
    const target = control<HTMLButtonElement>('location-trigger');
    if (reason === 'hidden' || reason === 'inert' || reason === 'disabled') target.setAttribute(reason, '');
    else if (reason === 'aria-hidden' || reason === 'aria-disabled') target.setAttribute(reason, 'true');
    else target.style.setProperty(reason, reason === 'display' ? 'none' : reason === 'opacity' ? '0' : 'hidden');
    expect(confirmationReturnTarget(control('add-measure'))).toBe(control('active-part-label'));
  });

  it('falls back to Document when both local Location controls are unavailable', () => {
    fixture();
    control('location-trigger').hidden = true;
    control('active-part-label').hidden = true;
    expect(confirmationReturnTarget(control('add-measure'))).toBe(control('document-menu-trigger'));
  });

  it('does not select a visible invoker nested in another transient that will also close', () => {
    const surfaces = fixture();
    surfaces.open('score-setup');
    control('score-setup').append(control('location-trigger'));
    control('active-part-label').hidden = true;
    expect(confirmationReturnTarget(control('add-measure'))).toBe(control('document-menu-trigger'));
  });

  it('rejects an unknown native or fallback transient without depending on current open state', () => {
    fixture();
    const surface = document.createElement('section');
    surface.setAttribute('popover', 'auto');
    surface.innerHTML = '<button>Nested action</button>';
    document.body.append(surface);
    expect(confirmationReturnTarget(surface.firstElementChild)).toBe(control('document-menu-trigger'));
    surface.removeAttribute('popover');
    surface.dataset.popoverFallback = 'true';
    expect(confirmationReturnTarget(surface.firstElementChild)).toBe(control('document-menu-trigger'));
  });

  it('rejects persistent controls with hidden or inert ancestors and disabled fieldsets', () => {
    fixture();
    const fieldset = document.createElement('fieldset');
    const button = document.createElement('button');
    fieldset.append(button);
    document.body.append(fieldset);
    for (const name of ['hidden', 'inert', 'disabled']) {
      fieldset.setAttribute(name, '');
      expect(confirmationReturnTarget(button)).toBe(control('document-menu-trigger'));
      fieldset.removeAttribute(name);
    }
  });

  it('retains the HTML disabled-fieldset exception for controls in its first legend', () => {
    fixture();
    const fieldset = document.createElement('fieldset');
    fieldset.disabled = true;
    fieldset.innerHTML = '<legend><button>Enable actions</button></legend><legend><button>Other legend</button></legend>';
    document.body.append(fieldset);
    expect(confirmationReturnTarget(fieldset.querySelector('button'))).toBe(fieldset.querySelector('button'));
    expect(confirmationReturnTarget(fieldset.lastElementChild!.querySelector('button'))).toBe(control('document-menu-trigger'));
  });

  it('checks computed CSS visibility on ancestors, not only inline attributes', () => {
    fixture();
    const style = document.createElement('style');
    style.textContent = '.unavailable-entry { display: none; }';
    document.body.append(style);
    control('write-tools').classList.add('unavailable-entry');
    expect(confirmationReturnTarget(control('event-pitch'))).toBe(control('document-menu-trigger'));
  });

  it('rejects closed dialogs and closed details content but retains a visible summary', () => {
    fixture();
    const details = document.createElement('details');
    details.innerHTML = '<summary>More actions</summary><button>Action</button>';
    document.body.append(details);
    expect(confirmationReturnTarget(details.querySelector('button'))).toBe(control('document-menu-trigger'));
    expect(confirmationReturnTarget(details.querySelector('summary'))).toBe(details.querySelector('summary'));
    expect(confirmationReturnTarget(control('author-confirmation-cancel'))).toBe(control('document-menu-trigger'));
  });

  it('rejects hidden inputs, detached invokers, and reused IDs without retargeting them', () => {
    fixture();
    const previous = document.createElement('button');
    previous.id = 'persistent-action';
    document.body.append(previous);
    const replacement = previous.cloneNode(true);
    previous.replaceWith(replacement);
    expect(confirmationReturnTarget(previous)).toBe(control('document-menu-trigger'));
    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    document.body.append(hidden);
    expect(confirmationReturnTarget(hidden)).toBe(control('document-menu-trigger'));
  });

  it('falls back for absent, body, or non-focusable targets and rejects an unusable fallback', () => {
    fixture();
    for (const target of [null, document.body, control('score-host')]) {
      expect(confirmationReturnTarget(target)).toBe(control('document-menu-trigger'));
    }
    control('document-menu-trigger').hidden = true;
    expect(confirmationReturnTarget(null)).toBeUndefined();
  });

  it('respects the supplied document and does not retain another document\'s active control', () => {
    fixture();
    const other = document.implementation.createHTMLDocument('Other Author');
    other.body.innerHTML = '<button id="document-menu-trigger">Document</button>';
    expect(confirmationReturnTarget(control('document-menu-trigger'), other)).toBe(other.getElementById('document-menu-trigger'));
  });
});

describe('confirmation focus after closing in-flow surfaces', () => {
  it.each([false, true])('CONFIRM-RETURN-VISIBLE Remove part Cancel returns to header Document (native dialog=%s)', async native => {
    const surfaces = fixture();
    const decision = confirmation(native);
    control('source-input').textContent = '<music-score id="accepted-score"></music-score>';
    control<HTMLInputElement>('event-pitch').value = 'F#5';
    const initialMarkup = control('source-input').textContent;
    surfaces.open('score-setup', '#remove-part');
    expect(document.activeElement).toBe(control('remove-part'));
    const target = confirmationReturnTarget(document.activeElement);
    surfaces.closeAll();
    control('document-menu').hidden = true;
    expect(control('score-setup').hidden).toBe(true);
    const focus = vi.spyOn(control('document-menu-trigger'), 'focus');
    const mutateMusic = vi.fn();
    const result = decision.ask({ title: 'Remove piano?', message: 'The staff notation is retained.', confirmLabel: 'Remove part', destructive: true, returnFocus: target, isCurrent: () => true })
      .then(accepted => { if (accepted) mutateMusic(); return accepted; });
    control('author-confirmation-cancel').click();
    await expect(result).resolves.toBe(false);
    expect(document.activeElement).toBe(control('document-menu-trigger'));
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(mutateMusic).not.toHaveBeenCalled();
    expect(control('source-input').textContent).toBe(initialMarkup);
    expect(control<HTMLInputElement>('event-pitch').value).toBe('F#5');
  });

  it.each(['project-file', 'open-project'])('hidden file/Open initiator %s returns to Document after Cancel', async id => {
    const surfaces = fixture();
    const decision = confirmation(false);
    const target = confirmationReturnTarget(control(id));
    surfaces.closeAll();
    control('document-menu').hidden = true;
    const focus = vi.spyOn(control('document-menu-trigger'), 'focus');
    const result = decision.ask({ title: 'Open composition?', message: 'Replace this workspace.', confirmLabel: 'Open composition', destructive: true, returnFocus: target, isCurrent: () => true });
    control('author-confirmation-cancel').click();
    await expect(result).resolves.toBe(false);
    expect(document.activeElement).toBe(control('document-menu-trigger'));
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  });

  it('returns to a still-visible persistent Remove measure without moving score scroll', async () => {
    const surfaces = fixture();
    const decision = confirmation(false);
    control('workspace-tools').hidden = false;
    control('measure-inspector').hidden = false;
    const invoker = control('remove-measure');
    invoker.focus();
    const target = confirmationReturnTarget(document.activeElement);
    surfaces.closeAll();
    const focus = vi.spyOn(invoker, 'focus');
    control('score-scroll').scrollTop = 2450;
    const result = decision.ask({ title: 'Remove measure 48?', message: 'All staves are affected.', confirmLabel: 'Remove measure', destructive: true, returnFocus: target, isCurrent: () => true });
    control('author-confirmation-cancel').click();
    await expect(result).resolves.toBe(false);
    expect(document.activeElement).toBe(invoker);
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(control('score-scroll').scrollTop).toBe(2450);
  });
});
