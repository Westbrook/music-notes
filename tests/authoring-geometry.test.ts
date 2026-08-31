// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngravingOptions, EngravingResult, EventGeometry, HitRegion, SystemGeometry } from '../src/engraving/render.js';
import type { Score } from '../src/model/types.js';

const engine = vi.hoisted(() => ({
  ready: vi.fn<() => Promise<void>>(),
  render: vi.fn<(container: HTMLElement, score: Score, options: EngravingOptions) => EngravingResult>(),
}));
vi.mock('../src/engraving/render.js', () => ({ engravingReady: engine.ready, renderScore: engine.render }));
import '../src/engraving/render.js';
import { MusicSurface } from '../src/components/index.js';

/** The adapter supplies geometry; these tests exercise the real coordinator's lifetime. */
function draw(container: HTMLElement, score: Score, options: EngravingOptions): EngravingResult {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(options.width));
  container.replaceChildren(svg);
  const locations = score.staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices
    .flatMap(voice => voice.events.map((event, eventIndex) => ({ staff, measure, voice, event, eventIndex })))));
  const hitRegions: HitRegion[] = locations.map(({ event }, index) => ({
    sourceId: event.id, system: 0, x: 30 + index * 20, y: 20, width: 10, height: 12, onset: event.onset,
  }));
  const events: EventGeometry[] = locations.map(({ staff, measure, voice, event, eventIndex }, index) => ({
    ...hitRegions[index], staffId: staff.id, measureId: measure.id, voiceId: voice.id, eventIndex,
    anchorX: hitRegions[index].x, anchorY: 30, ink: { ...hitRegions[index] }, sharedSourceIds: [event.id],
    noteheads: event.pitches.map((_, pitchIndex) => ({
      pitchIndex, x: 30 + index * 20, y: 20 + pitchIndex * 5, width: 10, height: 8,
      centerX: 35 + index * 20, centerY: 24 + pitchIndex * 5,
    })),
  }));
  const system: SystemGeometry = {
    index: 0, start: 0, end: score.staves[0]?.measures.length ?? 0,
    width: options.width, height: 80,
    viewBox: { x: -4, y: 0, width: options.width, height: 80 },
    ink: { x: 4, y: 8, width: options.width - 16, height: 64 },
    pageBreak: false, staves: [], measures: [], events, annotations: [], tuplets: [], anchors: [],
  };
  return { systems: [], hitRegions, diagnostics: [], systemGeometry: [system] };
}

function mount(attributes = ''): MusicSurface {
  const template = document.createElement('template');
  template.innerHTML = `<music-system id="score" ${attributes}><music-staff id="staff"><music-measure id="bar"><music-voice id="voice"><music-note id="note" pitch="C4" duration="whole"></music-note></music-voice></music-measure></music-staff></music-system>`;
  const root = template.content.firstElementChild as MusicSurface;
  document.body.append(root);
  return root;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}

function viewport(initialWidth: number) {
  let width = initialWidth;
  const observers: ControlledResizeObserver[] = [];
  class ControlledResizeObserver implements ResizeObserver {
    readonly targets = new Set<Element>();
    readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; observers.push(this); }
    observe(target: Element): void { this.targets.add(target); }
    unobserve(target: Element): void { this.targets.delete(target); }
    disconnect(): void { this.targets.clear(); }
  }
  vi.stubGlobal('ResizeObserver', ControlledResizeObserver);
  const getStyle = globalThis.getComputedStyle.bind(globalThis);
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = getStyle(element, pseudo);
    if (!element.classList.contains('surface')) return style;
    return new Proxy(style, {
      get(target, property) { return property === 'width' ? `${width}px` : Reflect.get(target, property, target); },
    });
  });
  return {
    resize(nextWidth: number) {
      width = nextWidth;
      for (const observer of observers) {
        const entries = [...observer.targets].map(target => ({
          target, contentRect: new DOMRect(0, 0, width, 100),
          borderBoxSize: [{ inlineSize: width, blockSize: 100 }],
          contentBoxSize: [{ inlineSize: width, blockSize: 100 }],
          devicePixelContentBoxSize: [{ inlineSize: width, blockSize: 100 }],
        }));
        if (entries.length) observer.callback(entries, observer);
      }
    },
  };
}

let size: ReturnType<typeof viewport>;
beforeEach(async () => {
  document.body.replaceChildren();
  engine.ready.mockReset().mockResolvedValue();
  engine.render.mockReset().mockImplementation(draw);
  // Resolve Vitest's simultaneous static/dynamic mock path just as the existing
  // coordinator tests do; the DOM reader and scheduler remain real.
  const actual = await vi.importActual<typeof import('../src/engraving/render.js')>('../src/engraving/render.js');
  vi.spyOn(actual, 'engravingReady').mockImplementation(engine.ready);
  vi.spyOn(actual, 'renderScore').mockImplementation(engine.render);
  size = viewport(800);
});
afterEach(async () => {
  document.body.replaceChildren();
  await new Promise(resolve => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
});

describe('public authoring geometry lifetime', () => {
  it('publishes the adapter geometry and projection identity with the render event', async () => {
    const root = mount();
    const listener = vi.fn();
    root.addEventListener('notation-render', listener);
    expect(root.getLayoutGeometry()).toBeUndefined();
    await root.renderComplete;
    const geometry = root.getLayoutGeometry()!;
    expect(geometry.projection).toBe('screen');
    expect(geometry.scoreId).toBe('score');
    expect(geometry.revision).toBe(root.renderRevision);
    expect(geometry.systems).toBe(engine.render.mock.results[0].value.systemGeometry);
    expect(geometry.systems[0]).toMatchObject({ width: 800, height: 80, viewBox: { x: -4, y: 0 } });
    expect(listener.mock.calls[0][0].detail.layoutGeometry).toBe(geometry);
    expect(listener.mock.calls[0][0].detail.renderRevision).toBe(geometry.revision);
    expect(root.getHitRegions()).toBe(engine.render.mock.results[0].value.hitRegions);
    expect(root.getSource(root.getHitRegions()[0].sourceId)).toBe(root.querySelector('music-note'));
  });

  it('preserves per-pitch notehead geometry in the public snapshot without copying or reordering', async () => {
    const root = mount();
    const chord = document.createElement('music-chord');
    chord.id = 'note'; chord.setAttribute('pitches', 'G4 C4 D4'); chord.setAttribute('duration', 'whole');
    root.querySelector('music-note')!.replaceWith(chord);
    await root.renderComplete;
    const heads = root.getLayoutGeometry()!.systems[0].events[0].noteheads!;
    expect(heads).toBe(engine.render.mock.results[0].value.systemGeometry[0].events[0].noteheads);
    expect(heads.map(head => head.pitchIndex)).toEqual([0, 1, 2]);
    expect(heads.map(head => [head.centerX, head.centerY])).toEqual([[35, 24], [35, 29], [35, 34]]);
    const previous = root.getLayoutGeometry()!;
    chord.setAttribute('pitches', 'A4 C4 D4');
    expect(root.getLayoutGeometry()).toBeUndefined();
    await root.renderComplete;
    expect(root.getLayoutGeometry()!.projectionId).not.toBe(previous.projectionId);
    expect(root.getLayoutGeometry()!.systems[0].events[0].noteheads).not.toBe(heads);
  });

  it('accepts an older adapter event geometry without per-pitch heads', async () => {
    engine.render.mockImplementation((container, score, options) => {
      const result = draw(container, score, options);
      return { ...result, systemGeometry: result.systemGeometry!.map(system => ({
        ...system, events: system.events.map(event => {
          const { noteheads: _noteheads, ...legacyEvent } = event;
          return legacyEvent;
        }),
      })) };
    });
    const root = mount();
    await root.renderComplete;
    expect(root.getLayoutGeometry()!.systems[0].events[0].noteheads).toBeUndefined();
    expect(root.getHitRegions()).toHaveLength(1);
    expect(root.diagnostics).toEqual([]);
  });

  it('invalidates synchronously when source changes, before observer delivery', async () => {
    const root = mount();
    await root.renderComplete;
    const previous = root.getLayoutGeometry()!;
    const fonts = deferred();
    engine.ready.mockReturnValueOnce(fonts.promise);
    root.querySelector('music-note')!.setAttribute('pitch', 'D4');
    expect(root.getLayoutGeometry()).toBeUndefined();
    expect(root.renderRevision).toBeGreaterThan(previous.revision);
    const complete = root.renderComplete;
    await vi.waitFor(() => expect(engine.ready).toHaveBeenCalledTimes(2));
    expect(root.getLayoutGeometry()).toBeUndefined();
    fonts.resolve();
    await complete;
    expect(root.getLayoutGeometry()!.projectionId).not.toBe(previous.projectionId);
    expect(root.getLayoutGeometry()!.revision).toBe(root.renderRevision);
  });

  it('lets renderRevision itself flush a pending source mutation', async () => {
    const root = mount();
    await root.renderComplete;
    const revision = root.renderRevision;
    root.querySelector('music-note')!.setAttribute('pitch', 'E4');
    expect(root.renderRevision).toBeGreaterThan(revision);
    expect(root.getLayoutGeometry()).toBeUndefined();
    await root.renderComplete;
  });

  it('keeps the same fixed print snapshot and revision while resize engraving waits', async () => {
    const root = mount('print-preview print-width="420"');
    await root.renderComplete;
    const previous = root.getLayoutGeometry()!;
    const hits = root.getHitRegions();
    const printSVG = root.shadowRoot!.querySelector('.print svg');
    const fonts = deferred();
    engine.ready.mockReturnValueOnce(fonts.promise);
    engine.render.mockClear();
    size.resize(360);
    const complete = root.renderComplete;
    await vi.waitFor(() => expect(engine.ready).toHaveBeenCalledTimes(2));
    expect(root.getLayoutGeometry()).toBe(previous);
    expect(root.renderRevision).toBe(previous.revision);
    fonts.resolve();
    await complete;
    expect(engine.render).toHaveBeenCalledTimes(1);
    expect(root.getLayoutGeometry()).toBe(previous);
    expect(root.getLayoutGeometry()!.systems[0].width).toBe(420);
    expect(root.getHitRegions()).toBe(hits);
    expect(root.shadowRoot!.querySelector('.print svg')).toBe(printSVG);
  });

  it('replaces screen geometry on a responsive resize without changing the musical DOM', async () => {
    const root = mount();
    await root.renderComplete;
    const previous = root.getLayoutGeometry()!;
    const source = root.innerHTML;
    size.resize(460);
    expect(root.getLayoutGeometry()).toBeUndefined();
    expect(root.renderRevision).toBeGreaterThan(previous.revision);
    await root.renderComplete;
    expect(root.getLayoutGeometry()!.projectionId).not.toBe(previous.projectionId);
    expect(root.getLayoutGeometry()!.systems[0].width).toBe(460);
    expect(root.innerHTML).toBe(source);
  });

  it('switches identity and dimensions when changing the displayed projection', async () => {
    const root = mount('print-width="420"');
    await root.renderComplete;
    const screen = root.getLayoutGeometry()!;
    root.printPreview = true;
    expect(root.getLayoutGeometry()).toBeUndefined();
    await root.renderComplete;
    const print = root.getLayoutGeometry()!;
    expect(print.projection).toBe('print');
    expect(print.systems[0].width).toBe(420);
    expect(print.projectionId).not.toBe(screen.projectionId);
    root.printPreview = false;
    await root.renderComplete;
    expect(root.getLayoutGeometry()!.projection).toBe('screen');
    expect(root.getLayoutGeometry()!.projectionId).not.toBe(screen.projectionId);
    expect(root.getLayoutGeometry()!.revision).toBe(root.renderRevision);
  });

  it('makes identities unique across surfaces even when the authored score IDs match', async () => {
    const first = mount();
    const second = mount();
    await Promise.all([first.renderComplete, second.renderComplete]);
    expect(first.getLayoutGeometry()!.scoreId).toBe(second.getLayoutGeometry()!.scoreId);
    expect(first.getLayoutGeometry()!.projectionId).not.toBe(second.getLayoutGeometry()!.projectionId);
  });

  it('clears hidden geometry and rebuilds it upon returning to the same width', async () => {
    const root = mount('print-preview');
    await root.renderComplete;
    const previous = root.getLayoutGeometry()!;
    size.resize(0);
    expect(root.getLayoutGeometry()).toBeUndefined();
    expect(root.renderRevision).toBeGreaterThan(previous.revision);
    engine.render.mockClear();
    size.resize(800);
    await root.renderComplete;
    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(root.getLayoutGeometry()!.projectionId).not.toBe(previous.projectionId);
  });

  it('invalidates a cached print snapshot for explicit refresh and reconnection', async () => {
    const root = mount('print-preview');
    await root.renderComplete;
    const previous = root.getLayoutGeometry()!;
    const complete = root.refresh();
    expect(root.getLayoutGeometry()).toBeUndefined();
    await complete;
    const refreshed = root.getLayoutGeometry()!;
    expect(refreshed.projectionId).not.toBe(previous.projectionId);
    root.remove();
    expect(root.getLayoutGeometry()).toBeUndefined();
    expect(root.renderRevision).toBeGreaterThan(refreshed.revision);
    document.body.append(root);
    await root.renderComplete;
    expect(root.getLayoutGeometry()!.projectionId).not.toBe(refreshed.projectionId);
  });

  it('does not expose stale geometry after validation or rendering errors', async () => {
    const root = mount();
    await root.renderComplete;
    root.querySelector('music-note')!.setAttribute('pitch', 'invalid');
    await root.renderComplete;
    expect(root.diagnostics.some(diagnostic => diagnostic.severity === 'error')).toBe(true);
    expect(root.getLayoutGeometry()).toBeUndefined();
    expect(root.getHitRegions()).toEqual([]);
    root.querySelector('music-note')!.setAttribute('pitch', 'D4');
    engine.render.mockImplementationOnce(() => { throw new Error('Missing font'); });
    await root.renderComplete;
    expect(root.getLayoutGeometry()).toBeUndefined();
    expect(root.diagnostics.some(diagnostic => diagnostic.code === 'engraving-error')).toBe(true);
    await root.refresh();
    expect(root.getLayoutGeometry()).toBeDefined();
  });

  it('does not publish geometry if an adapter returns error diagnostics', async () => {
    engine.render.mockImplementation((container, score, options) => ({
      ...draw(container, score, options),
      diagnostics: [{ severity: 'error', code: 'adapter-error', sourceId: score.id, message: 'Cannot engrave.' }],
    }));
    const root = mount();
    await root.renderComplete;
    expect(root.getLayoutGeometry()).toBeUndefined();
  });

  it.each(['throw', 'diagnostic'])('invalidates a retained print revision after a resize %s', async mode => {
    const root = mount('print-preview');
    await root.renderComplete;
    const previous = root.getLayoutGeometry()!;
    engine.render.mockImplementationOnce((container, score, options) => {
      if (mode === 'throw') throw new Error('Cannot render resized screen.');
      return { ...draw(container, score, options), diagnostics: [
        { severity: 'error', code: 'adapter-error', sourceId: score.id, message: 'Cannot render resized screen.' },
      ] };
    });
    size.resize(460);
    await root.renderComplete;
    expect(root.getLayoutGeometry()).toBeUndefined();
    expect(root.renderRevision).toBeGreaterThan(previous.revision);
  });

  it('retains compatibility with adapters exposing only existing event hit regions', async () => {
    engine.render.mockImplementation((container, score, options) => {
      const { systems, hitRegions, diagnostics } = draw(container, score, options);
      return { systems, hitRegions, diagnostics };
    });
    const root = mount();
    await root.renderComplete;
    expect(root.getLayoutGeometry()).toBeUndefined();
    expect(root.getHitRegions()).toHaveLength(1);
    expect(root.diagnostics).toEqual([]);
  });

  it('does not allow an old asynchronous render to replace newer geometry', async () => {
    const root = mount();
    await root.renderComplete;
    const firstFonts = deferred();
    const secondFonts = deferred();
    engine.ready.mockReturnValueOnce(firstFonts.promise).mockReturnValueOnce(secondFonts.promise);
    root.id = 'older-score';
    const complete = root.renderComplete;
    await vi.waitFor(() => expect(engine.ready).toHaveBeenCalledTimes(2));
    root.id = 'newer-score';
    void root.renderComplete;
    await vi.waitFor(() => expect(engine.ready).toHaveBeenCalledTimes(3));
    secondFonts.resolve();
    await complete;
    const newest = root.getLayoutGeometry()!;
    expect(newest.scoreId).toBe('newer-score');
    firstFonts.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(root.getLayoutGeometry()).toBe(newest);
    expect(root.renderRevision).toBe(newest.revision);
  });
});
