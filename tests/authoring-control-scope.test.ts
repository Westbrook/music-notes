import { afterEach, describe, expect, it } from 'vitest';
import { asControlScope, ControlScope } from '../src/authoring/control-scope.js';

type RootKind = 'element' | 'shadow' | 'document';

function fixture(kind: RootKind = 'element') {
  const host = document.createElement('section');
  document.body.append(host);
  const root = kind === 'document' ? document : kind === 'shadow' ? host.attachShadow({ mode: 'open' }) : host;
  return { host, root, container: root === document ? document.body : root, scope: new ControlScope(root) };
}

function input(id: string, owner = document): HTMLInputElement {
  const field = owner.createElement('input');
  field.id = id;
  return field;
}

afterEach(() => document.body.replaceChildren());

describe('authoring control ownership', () => {
  it.each(['element', 'shadow', 'document'] as const)('supports a %s base root and preserves existing scopes', kind => {
    const f = fixture(kind);
    const field = input('duration');
    f.container.append(field);
    expect(f.scope.document).toBe(document);
    expect(f.scope.roots).toEqual([f.root]);
    expect(f.scope.contains(f.root)).toBe(true);
    expect(f.scope.contains(field)).toBe(true);
    expect(f.scope.contains(null)).toBe(false);
    expect(f.scope.getElementById('duration')).toBe(field);
    expect(f.scope.querySelector('input')).toBe(field);
    expect(f.scope.querySelectorAll('input')).toEqual([field]);
    expect(asControlScope(f.scope)).toBe(f.scope);
    expect(asControlScope(f.root).getElementById('duration')).toBe(field);
  });

  it('includes an element root itself while ignoring duplicate IDs elsewhere in the document', () => {
    const outside = input('duration');
    document.body.append(outside);
    const f = fixture();
    f.host.id = 'author-controls';
    const field = input('duration');
    f.container.append(field);

    expect(document.getElementById('duration')).toBe(outside);
    expect(f.scope.getElementById('duration')).toBe(field);
    expect(f.scope.querySelector('#duration')).toBe(field);
    expect(f.scope.querySelectorAll('input')).toEqual([field]);
    expect(f.scope.contains(outside)).toBe(false);
    expect(f.scope.getElementById('author-controls')).toBe(f.host);
    expect(f.scope.querySelector('section')).toBe(f.host);
    expect(f.scope.querySelectorAll('section')).toEqual([f.host]);
  });

  it('follows the current owned tree when a control root moves and a field is replaced', () => {
    const f = fixture();
    const original = input('event-pitch');
    f.container.append(original);
    expect(f.scope.getElementById('event-pitch')).toBe(original);

    const shadowHost = document.createElement('div');
    document.body.append(shadowHost);
    const shadow = shadowHost.attachShadow({ mode: 'open' });
    shadow.append(f.host);
    expect(f.scope.getElementById('event-pitch')).toBe(original);

    const replacement = input('event-pitch');
    original.replaceWith(replacement);
    shadow.prepend(original);
    expect(shadow.getElementById('event-pitch')).toBe(original);
    expect(f.scope.getElementById('event-pitch')).toBe(replacement);
    expect(f.scope.contains(original)).toBe(false);
    expect(f.scope.contains(replacement)).toBe(true);

    f.host.remove();
    expect(f.scope.getElementById('event-pitch')).toBe(replacement);
    document.body.append(f.host);
    expect(f.scope.getElementById('event-pitch')).toBe(replacement);
    replacement.remove();
    expect(f.scope.getElementById('event-pitch')).toBeNull();
    expect(f.scope.querySelectorAll('input')).toEqual([]);
  });

  it('enters only explicitly registered control shadows and never discovers matching score source IDs', () => {
    const f = fixture('shadow');
    const sourceHost = document.createElement('div');
    const controlsHost = document.createElement('div');
    f.container.append(sourceHost, controlsHost);
    const sourceRoot = sourceHost.attachShadow({ mode: 'open' });
    const controlsRoot = controlsHost.attachShadow({ mode: 'open' });
    const sourceField = input('selected-duration');
    const controlField = input('selected-duration');
    sourceRoot.append(sourceField);
    controlsRoot.append(controlField);

    expect(f.scope.getElementById('selected-duration')).toBeNull();
    expect(f.scope.querySelectorAll('input')).toEqual([]);
    const release = f.scope.register(controlsRoot);
    expect(f.scope.roots).toEqual([f.root, controlsRoot]);
    expect(f.scope.getElementById('selected-duration')).toBe(controlField);
    expect(f.scope.querySelector('input')).toBe(controlField);
    expect(f.scope.querySelectorAll('input')).toEqual([controlField]);
    expect(f.scope.contains(controlField)).toBe(true);
    expect(f.scope.contains(sourceField)).toBe(false);

    release();
    expect(f.scope.getElementById('selected-duration')).toBeNull();
    expect(f.scope.querySelectorAll('input')).toEqual([]);
    expect(f.scope.contains(controlField)).toBe(false);
    expect(sourceRoot.getElementById('selected-duration')).toBe(sourceField);
  });

  it('returns each matching element once when registered roots overlap', () => {
    const f = fixture();
    const panel = document.createElement('fieldset');
    const field = input('pitch');
    panel.append(field);
    f.container.append(panel);
    f.host.dataset.control = '';
    panel.dataset.control = '';
    field.dataset.control = '';
    const releasePanel = f.scope.register(panel);
    const releaseField = f.scope.register(field);
    expect(f.scope.querySelectorAll('[data-control]')).toEqual([f.host, panel, field]);
    releasePanel();
    releaseField();
    expect(f.scope.querySelectorAll('[data-control]')).toEqual([f.host, panel, field]);
  });

  it('releases each registration once without removing other leases or base-root ownership', () => {
    const f = fixture();
    const panel = document.createElement('aside');
    const field = input('page-size');
    panel.append(field);
    document.body.append(panel);
    const releaseBase = f.scope.register(f.host);
    const releaseFirst = f.scope.register(panel);
    const releaseSecond = f.scope.register(panel);
    expect(f.scope.roots).toEqual([f.root, panel]);

    releaseFirst();
    releaseFirst();
    expect(f.scope.getElementById('page-size')).toBe(field);
    releaseBase();
    releaseBase();
    expect(f.scope.contains(f.host)).toBe(true);
    releaseSecond();
    releaseSecond();
    expect(f.scope.roots).toEqual([f.root]);
    expect(f.scope.getElementById('page-size')).toBeNull();
    expect(f.scope.contains(field)).toBe(false);

    const releaseAgain = f.scope.register(panel);
    expect(f.scope.getElementById('page-size')).toBe(field);
    releaseAgain();
    expect(f.scope.roots).toEqual([f.root]);
  });

  it('rejects element and shadow registrations from another document without changing ownership', () => {
    const f = fixture();
    const other = document.implementation.createHTMLDocument('Another editor');
    const foreignHost = other.createElement('section');
    const foreignRoot = foreignHost.attachShadow({ mode: 'open' });
    expect(() => f.scope.register(foreignHost)).toThrow(/same document/);
    expect(() => f.scope.register(foreignRoot)).toThrow(/same document/);
    expect(f.scope.roots).toEqual([f.root]);
    expect(f.scope.contains(foreignHost)).toBe(false);
  });

  it('observes outside and unregistered deep focus without granting control ownership', () => {
    const f = fixture();
    const outside = input('outside-editor');
    document.body.append(outside);
    const controlsHost = document.createElement('div');
    f.container.append(controlsHost);
    const controlsRoot = controlsHost.attachShadow({ mode: 'open' });
    const field = input('pitch');
    const nestedHost = document.createElement('div');
    controlsRoot.append(field, nestedHost);
    const nestedRoot = nestedHost.attachShadow({ mode: 'open' });
    const nestedField = input('source-text');
    nestedRoot.append(nestedField);

    outside.focus();
    expect(f.scope.activeElement).toBe(outside);
    expect(f.scope.contains(outside)).toBe(false);
    field.focus();
    expect(controlsRoot.activeElement).toBe(field);
    expect(f.scope.activeElement).toBe(field);
    expect(f.scope.contains(field)).toBe(false);
    const releaseControls = f.scope.register(controlsRoot);
    expect(f.scope.activeElement).toBe(field);
    expect(f.scope.contains(field)).toBe(true);
    nestedField.focus();
    expect(nestedRoot.activeElement).toBe(nestedField);
    expect(f.scope.activeElement).toBe(nestedField);
    expect(f.scope.contains(nestedField)).toBe(false);
    const releaseNested = f.scope.register(nestedRoot);
    expect(f.scope.activeElement).toBe(nestedField);
    expect(f.scope.contains(nestedField)).toBe(true);
    releaseNested();
    expect(f.scope.activeElement).toBe(nestedField);
    expect(f.scope.contains(nestedField)).toBe(false);
    field.focus();
    expect(f.scope.activeElement).toBe(field);
    releaseControls();
    expect(f.scope.activeElement).toBe(field);
    expect(f.scope.contains(field)).toBe(false);
    outside.focus();
    expect(f.scope.activeElement).toBe(outside);
  });

  it('uses a registered closed shadow reference for focus until its final lease is released', () => {
    const f = fixture();
    const host = document.createElement('div');
    f.container.append(host);
    const closedRoot = host.attachShadow({ mode: 'closed' });
    const field = input('closed-pitch');
    closedRoot.append(field);
    field.focus();
    expect(host.shadowRoot).toBeNull();
    expect(document.activeElement).toBe(host);
    expect(closedRoot.activeElement).toBe(field);
    expect(f.scope.activeElement).toBe(host);

    const releaseFirst = f.scope.register(closedRoot);
    const releaseSecond = f.scope.register(closedRoot);
    expect(f.scope.activeElement).toBe(field);
    expect(f.scope.contains(field)).toBe(true);
    releaseFirst();
    releaseFirst();
    expect(f.scope.activeElement).toBe(field);
    releaseSecond();
    expect(f.scope.activeElement).toBe(host);
    expect(f.scope.contains(field)).toBe(false);
    expect(f.scope.getElementById('closed-pitch')).toBeNull();
  });

  it.each(['element', 'shadow', 'document'] as const)('treats unusual IDs as literal data under a %s root', kind => {
    const f = fixture(kind);
    const decoy = input('decoy');
    f.container.append(decoy);
    const ids = ['cue:1.note[draft]', 'cue "call"\\return', 'line\nbreak', 'tab\tbreak', 'nul\0cue', '"] , input, [id="'];
    for (const id of ids) {
      const outside = kind === 'element' ? input(id) : null;
      if (outside) f.host.before(outside);
      const field = input(id);
      f.container.append(field);
      if (outside) {
        expect(document.getElementById(id)).toBe(outside);
        expect(f.scope.contains(outside)).toBe(false);
      }
      expect(f.scope.getElementById(id)).toBe(field);
      expect(f.scope.getElementById(`${id}-missing`)).toBeNull();
      field.remove();
      expect(f.scope.getElementById(id)).toBeNull();
      outside?.remove();
    }
    expect(f.scope.getElementById('decoy')).toBe(decoy);
  });
});
