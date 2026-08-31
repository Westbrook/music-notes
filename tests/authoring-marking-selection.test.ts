// @vitest-environment happy-dom
import { queryAuthorControl, mountAuthorFixture } from './author-fixture.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorWorkspace } from '../src/authoring/main.js';
import type { LayoutGeometry, MusicSurface } from '../src/components/music-surface.js';
import { createProject } from '../src/authoring/project.js';
import { RecoveryStore } from '../src/authoring/storage.js';

const source = `<music-staff id="staff" notation="three-roads"><music-measure id="bar">
  <music-road id="main" direction="same" duration="half">
    <music-articulation id="accent" type="accent"></music-articulation>
    <music-ornament id="trill" type="trill"></music-ornament>
    <music-interval id="fifth" value="5" placement="above"></music-interval>
    <music-interval id="third" value="b3" placement="below"></music-interval>
  </music-road>
  <music-road id="higher" direction="higher" duration="half"></music-road>
</music-measure></music-staff>`;

let workspace: AuthorWorkspace | undefined;

beforeEach(() => {
  document.body.className = '';
  mountAuthorFixture();
  // Test the real application listeners and controllers, without substituting
  // fake musical geometry for the separate browser engraving checks.
  vi.spyOn(AuthorWorkspace.prototype as unknown as { requestRender(): void }, 'requestRender').mockImplementation(() => {});
  const values = new Map<string, string>();
  const recovery = new RecoveryStore({ key: 'marking-selection-test', writerId: 'test',
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } },
    locks: { request: async (_name, action) => action() },
  });
  workspace = new AuthorWorkspace({ project: createProject(source, 'Mark selection'), recovery });
});

afterEach(async () => {
  workspace?.dispose(); workspace = undefined;
  await Promise.resolve();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('Author selection of public attached-mark identities', () => {
  it('keeps a handled surface marking click from falling through to the measure selection', () => {
    const app = workspace!;
    const sourceBefore = app.session.project.sourceHtml;
    const host = document.getElementById('score-host')!;
    // A boundary-routing fixture, not a claim about native SVG hit testing:
    // both a blank click and a handled marking click occupy the same bar.
    const surface = document.createElement('div');
    surface.attachShadow({ mode: 'open' }).innerHTML = '<div class="screen"><svg class="notation-svg"></svg></div>';
    host.shadowRoot!.querySelector('.score-mount')!.append(surface);
    const matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse() { return this; } } as DOMMatrix;
    Object.defineProperty(surface.shadowRoot!.querySelector('svg'), 'getScreenCTM', { value: () => matrix });
    vi.stubGlobal('DOMPoint', class {
      readonly x: number;
      readonly y: number;
      constructor(x: number, y: number) { this.x = x; this.y = y; }
      matrixTransform() { return this; }
    });
    const layout: LayoutGeometry = { projection: 'screen', projectionId: 'selection-boundary', revision: 1, scoreId: app.session.score.id,
      systems: [{ index: 0, start: 0, end: 1, width: 400, height: 120, pageBreak: false,
        viewBox: { x: 0, y: 0, width: 400, height: 120 }, ink: { x: 0, y: 0, width: 400, height: 120 },
        staves: [], events: [], annotations: [], tuplets: [], anchors: [],
        measures: [{ sourceId: 'bar', staffId: 'staff', system: 0, measureIndex: 0,
          x: 0, y: 0, width: 400, height: 120, topLine: 30, bottomLine: 70, noteStartX: 20, noteEndX: 380 }] }],
    };
    const projection = { surface: surface as unknown as MusicSurface, renderRevision: layout.revision, layout,
      frames: [{ system: layout.systems[0], svg: surface.shadowRoot!.querySelector<SVGSVGElement>('svg')!, row: undefined }] };
    Object.defineProperties(surface, {
      getLayoutGeometry: { value: () => layout }, getRenderedProjection: { value: () => projection },
      renderRevision: { value: layout.revision }, getNativeControlBounds: { value: () => [] },
    });
    Object.assign(app, { surface: surface as unknown as MusicSurface });
    const click = () => new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, clientX: 80, clientY: 50 });
    surface.dispatchEvent(click());
    expect(app.session.selectionId).toBe('bar');

    queryAuthorControl<HTMLButtonElement>(document, '#event-navigator [data-source-id="higher"]')!.click();
    const detail = { sourceId: 'fifth', sourceElement: app.session.source.querySelector('#fifth') };
    surface.addEventListener('click', event => {
      surface.dispatchEvent(new CustomEvent('notation-select', { bubbles: true, composed: true, detail }));
      event.preventDefault();
    }, { once: true });
    const handled = click();
    surface.dispatchEvent(handled);

    expect(handled.defaultPrevented).toBe(true);
    expect(detail.sourceId).toBe('fifth');
    expect(app.session.selectionId).toBe('main');
    expect(queryAuthorControl(document, '#event-navigator [data-source-id="main"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.getElementById('event-markings-editor')?.dataset.draftTarget).toBe('main');
    expect(document.getElementById('selection-inspector')?.dataset.draftTarget).toBe('main');
    expect(app.session.project.sourceHtml).toBe(sourceBefore);
    expect(app.session.revision).toBe(0);
    expect(app.session.canUndo).toBe(false);
  });

  it.each(['accent', 'trill', 'fifth', 'third'])('selects the owner in every selected-event control after notation-select for %s', markingId => {
    const app = workspace!;
    const sourceBefore = app.session.project.sourceHtml;
    const higher = queryAuthorControl<HTMLButtonElement>(document, '#event-navigator [data-source-id="higher"]')!;
    higher.click();
    expect(queryAuthorControl(document, '#event-navigator [data-source-id="higher"]')?.getAttribute('aria-pressed')).toBe('true');
    const detail = { sourceId: markingId, sourceElement: app.session.source.querySelector(`#${markingId}`) };
    const event = new CustomEvent('notation-select', { bubbles: true, composed: true, detail });
    document.getElementById('score-host')!.dispatchEvent(event);

    // The public payload keeps the exact marking identity, while Author's
    // navigator and selected-event controllers resolve its musical owner.
    expect(detail.sourceId).toBe(markingId);
    expect(detail.sourceElement?.id).toBe(markingId);
    expect(app.session.selectionId).toBe('main');
    expect(queryAuthorControl(document, '#event-navigator [data-source-id="main"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(queryAuthorControl(document, '#event-navigator [data-source-id="higher"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(document.getElementById('selection-inspector')?.dataset.draftTarget).toBe('main');
    expect((document.getElementById('selected-kind') as HTMLSelectElement).value).toBe('road');
    expect((document.getElementById('selected-direction') as HTMLSelectElement).value).toBe('same');
    expect(document.getElementById('event-markings-editor')?.dataset.draftTarget).toBe('main');
    expect(document.querySelectorAll('#event-markings-rows [data-marking-row]')).toHaveLength(4);
    expect(app.session.project.sourceHtml).toBe(sourceBefore);
    expect(app.session.revision).toBe(0);
    expect(app.session.canUndo).toBe(false);
  });
});
