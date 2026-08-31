// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngravingOptions, EngravingResult, HitRegion } from '../src/engraving/render.js';
import type { Diagnostic, Score } from '../src/model/types.js';

const engine = vi.hoisted(() => ({
  ready: vi.fn<() => Promise<void>>(),
  render: vi.fn<(container: HTMLElement, score: Score, options: EngravingOptions) => EngravingResult>(),
}));

vi.mock('../src/engraving/render.js', () => ({ engravingReady: engine.ready, renderScore: engine.render }));

// Resolve the mocked backend before multiple surfaces import it concurrently.
import '../src/engraving/render.js';
import { MusicNote, MusicStaff, MusicSurface, readScore } from '../src/components/index.js';
import type { LayoutGeometry } from '../src/components/music-surface.js';

const noSelectionModifiers = { shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, clickCount: 0, pointerType: '' };

function draw(container: HTMLElement, score: Score, options: EngravingOptions): EngravingResult {
  const events = score.staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events)));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('data-score-id', score.id);
  svg.setAttribute('data-first-pitch', events[0]?.pitches[0]?.step ?? 'rest');
  svg.setAttribute('data-width', String(options.width));
  const hitRegions: HitRegion[] = events.map((event, index) => {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('data-source-id', event.id);
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', '8');
    rect.setAttribute('height', '8');
    group.append(rect);
    svg.append(group);
    return { sourceId: event.id, system: 0, x: index * 12, y: 10, width: options.width, height: 8, onset: event.onset };
  });
  container.replaceChildren(svg);
  return { systems: [], hitRegions, diagnostics: [] };
}

function mount<T extends MusicSurface = MusicSurface>(html = '<music-measure><music-note id="note" pitch="C4" duration="whole"></music-note></music-measure>'): T {
  const template = document.createElement('template');
  template.innerHTML = html;
  const root = template.content.firstElementChild as T;
  document.body.append(root);
  return root;
}

function note(root: MusicSurface): MusicNote { return root.querySelector('music-note')!; }
function firstPitch(root: MusicSurface): string | null { return root.shadowRoot!.querySelector('.screen svg')?.getAttribute('data-first-pitch') ?? null; }
function currentPitch(root: MusicSurface): string | undefined { return root.score?.staves[0].measures[0].voices[0].events[0].pitches[0]?.step; }
function nextTask(): Promise<void> { return new Promise(resolve => setTimeout(resolve, 0)); }
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** happy-dom has no layout or ResizeObserver delivery; keep the real scheduler. */
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
    setWidth(nextWidth: number) { width = nextWidth; },
    targets() { return observers.flatMap(observer => [...observer.targets]); },
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

let actualFontPreparation: (() => Promise<void>) | undefined;

beforeEach(async () => {
  document.body.replaceChildren();
  engine.ready.mockReset().mockResolvedValue();
  engine.render.mockReset().mockImplementation(draw);
  // Vitest can return the actual module to a concurrent dynamic import while
  // another import is resolving its mock. Stub only the same two backend
  // exports on that path as well; all component and DOM scheduling stays real.
  const actual = await vi.importActual<typeof import('../src/engraving/render.js')>('../src/engraving/render.js');
  actualFontPreparation ??= actual.engravingReady;
  vi.spyOn(actual, 'engravingReady').mockImplementation(engine.ready);
  vi.spyOn(actual, 'renderScore').mockImplementation(engine.render);
});

afterEach(async () => {
  document.body.replaceChildren();
  await nextTask();
  vi.unstubAllGlobals();
});

describe('reflected authoring properties', () => {
  it('reflects string, number, boolean, and camelCase properties to source attributes', () => {
    const element = document.createElement('music-note');
    element.pitch = 'F#4';
    element.duration = 'eighth';
    element.dots = 2;
    element.dotted = true;
    element.accidentalDisplay = 'courtesy';
    element.beam = 'start';
    element.stem = 'down';
    element.tie = 'start';
    element.triplet = 'start';
    expect(element.getAttribute('pitch')).toBe('F#4');
    expect(element.getAttribute('duration')).toBe('eighth');
    expect(element.getAttribute('dots')).toBe('2');
    expect(element.hasAttribute('dotted')).toBe(true);
    expect(element.getAttribute('accidental-display')).toBe('courtesy');
    expect(element.getAttribute('stem')).toBe('down');
    expect(element.getAttribute('tie')).toBe('start');
    expect(element.getAttribute('triplet')).toBe('start');
    element.dotted = false;
    expect(element.hasAttribute('dotted')).toBe(false);
    Reflect.set(element, 'duration', null);
    expect(element.hasAttribute('duration')).toBe(false);
    expect(element.duration).toBe('quarter');
    element.setAttribute('dots', '3');
    expect(element.dots).toBe(3);
  });

  it('reflects meter, tuplet, chord, slash, annotation, and layout setters', () => {
    const meter = document.createElement('music-meter');
    meter.top = '2+2+3'; meter.bottom = 8; meter.groups = '2+2+3';
    expect(meter.getAttribute('top')).toBe('2+2+3');
    expect(meter.bottom).toBe(8);
    const tuplet = document.createElement('music-tuplet');
    tuplet.actual = 5; tuplet.normal = 4; tuplet.ratio = true; tuplet.bracket = 'yes';
    expect(tuplet.getAttribute('actual')).toBe('5');
    expect(tuplet.hasAttribute('ratio')).toBe(true);
    const chord = document.createElement('music-chord');
    chord.pitches = 'C4 E4 G4'; chord.accidentalDisplay = 'always';
    expect(chord.getAttribute('pitches')).toBe('C4 E4 G4');
    const slash = document.createElement('music-slash');
    slash.rhythmic = true; slash.duration = 'eighth';
    expect(slash.hasAttribute('rhythmic')).toBe(true);
    const direction = document.createElement('music-direction');
    direction.text = 'Open solo'; direction.at = '1/4'; direction.placement = 'below';
    expect(direction.getAttribute('text')).toBe('Open solo');
    expect(direction.getAttribute('at')).toBe('1/4');
    const tempo = document.createElement('music-tempo');
    tempo.text = 'Rubato'; tempo.placement = 'below';
    expect(tempo.getAttribute('text')).toBe('Rubato');
    expect(tempo.getAttribute('placement')).toBe('below');
    const dynamics = document.createElement('music-dynamics');
    dynamics.text = 'sfz';
    expect(dynamics.getAttribute('text')).toBe('sfz');
    const root = document.createElement('music-system');
    root.maxMeasures = 3; root.printWidth = 800; root.justifyLast = true; root.printPreview = true; root.bracket = 'brace';
    expect(root.getAttribute('max-measures')).toBe('3');
    expect(root.getAttribute('print-width')).toBe('800');
    expect(root.hasAttribute('justify-last')).toBe(true);
    expect(root.hasAttribute('print-preview')).toBe(true);
    expect(root.getAttribute('bracket')).toBe('brace');
  });

  it('replays pre-upgrade own properties through the real connection lifecycle', () => {
    const pending = document.createElement('music-note');
    // happy-dom replaces unknown nodes at define() and drops their user fields.
    // Model the browser's preserved own-property state, then use the actual DOM
    // connection callback to exercise the component's replay logic.
    for (const [name, value] of Object.entries({ pitch: 'Bb4', duration: 'half', dots: 1, dotted: true })) {
      Object.defineProperty(pending, name, { value, writable: true, configurable: true, enumerable: true });
    }
    expect(Object.hasOwn(pending, 'pitch')).toBe(true);
    document.body.append(pending);
    expect(pending.getAttribute('pitch')).toBe('Bb4');
    expect(pending.getAttribute('duration')).toBe('half');
    expect(pending.getAttribute('dots')).toBe('1');
    expect(pending.hasAttribute('dotted')).toBe(true);
    expect(Object.hasOwn(pending, 'pitch')).toBe(false);
    pending.pitch = 'D5';
    expect(pending.getAttribute('pitch')).toBe('D5');
  });

  it('reflects attached marking properties and replays values set before upgrade', () => {
    const articulation = document.createElement('music-articulation');
    expect(articulation.placement).toBe('auto');
    articulation.type = 'staccato'; articulation.placement = 'below';
    expect(articulation.getAttribute('type')).toBe('staccato');
    expect(articulation.getAttribute('placement')).toBe('below');
    const ornament = document.createElement('music-ornament');
    expect(ornament.placement).toBe('above');
    ornament.type = 'trill'; ornament.placement = 'below';
    expect(ornament.getAttribute('type')).toBe('trill');
    expect(ornament.getAttribute('placement')).toBe('below');
    const interval = document.createElement('music-interval');
    expect(interval.hasAttribute('placement')).toBe(false);
    for (const [name, value] of Object.entries({ value: 'b3', placement: 'below' })) {
      Object.defineProperty(interval, name, { value, writable: true, configurable: true, enumerable: true });
    }
    document.body.append(interval);
    expect(interval.getAttribute('value')).toBe('b3');
    expect(interval.getAttribute('placement')).toBe('below');
    expect(Object.hasOwn(interval, 'value')).toBe(false);
    interval.value = '13'; interval.placement = 'above';
    expect(interval.getAttribute('value')).toBe('13');
    expect(interval.getAttribute('placement')).toBe('above');
  });

  it('replays inherited surface and measure properties on first connection', async () => {
    const root = document.createElement('music-measure');
    root.innerHTML = '<music-note pitch="C4" duration="quarter"></music-note>';
    for (const [name, value] of Object.entries({ label: 'Opening', meter: '3/4', pickup: true, number: '0', printWidth: 420 })) {
      Object.defineProperty(root, name, { value, writable: true, configurable: true, enumerable: true });
    }
    document.body.append(root);
    await root.renderComplete;
    expect(root.getAttribute('label')).toBe('Opening');
    expect(root.getAttribute('meter')).toBe('3/4');
    expect(root.hasAttribute('pickup')).toBe(true);
    expect(root.getAttribute('print-width')).toBe('420');
    expect(root.score!.staves[0].measures[0]).toMatchObject({ pickup: true, number: '0', meter: { numerator: 3, denominator: 4 } });
    expect(root.diagnostics).toEqual([]);
  });

  it('keeps legacy scalar defaults and does not invent a structural tuplet ratio', () => {
    const meter = document.createElement('music-meter');
    expect(meter.top).toBe(4); expect(meter.bottom).toBe(4);
    meter.top = 7; expect(meter.top).toBe(7);
    meter.top = '2+2+3'; expect(meter.top).toBe('2+2+3');
    expect(document.createElement('music-dynamics').level).toBe('mf');
    const tuplet = document.createElement('music-tuplet');
    expect(tuplet.actual).toBe(0); expect(tuplet.normal).toBe(0);
  });

  it('dispatches a bubbling notation-change from reflected data attributes', () => {
    const parent = document.createElement('div');
    const element = document.createElement('music-note');
    parent.append(element);
    const listener = vi.fn();
    parent.addEventListener('notation-change', listener);
    element.pitch = 'D4';
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({ bubbles: true, composed: true });
  });
});

describe('surface ownership and real DOM observation', () => {
  it('renders one screen and one print view without changing light DOM', async () => {
    const root = mount();
    const source = root.innerHTML;
    await root.renderComplete;
    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(firstPitch(root)).toBe('C');
    expect(root.innerHTML).toBe(source);
    expect(root.shadowRoot!.querySelector('.transcript pre')!.textContent).toContain('C4');
    expect(root.shadowRoot!.querySelector<HTMLElement>('.loading')!.hidden).toBe(true);
  });

  it('coalesces a synchronous group of property and child mutations', async () => {
    const root = mount();
    await root.renderComplete;
    engine.render.mockClear();
    const listener = vi.fn();
    root.addEventListener('notation-render', listener);
    note(root).pitch = 'D4';
    note(root).pitch = 'E4';
    note(root).pitch = 'F4';
    const instruction = document.createElement('music-direction');
    instruction.text = 'Swing';
    root.prepend(instruction);
    await root.renderComplete;
    await nextTask();
    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(firstPitch(root)).toBe('F');
  });

  it('does not rerender when a reflected property is assigned its existing value', async () => {
    const root = mount();
    await root.renderComplete;
    engine.render.mockClear();
    const listener = vi.fn();
    root.addEventListener('notation-render', listener);
    note(root).pitch = 'C4';
    note(root).duration = 'whole';
    await nextTask();
    await root.renderComplete;
    expect(engine.render).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('automatically diagnoses and repairs an unknown attribute through MutationObserver', async () => {
    const root = mount();
    await root.renderComplete;
    note(root).setAttribute('duraton', 'whole');
    await vi.waitFor(() => expect(root.diagnostics.some(diagnostic => diagnostic.code === 'unknown-attribute')).toBe(true));
    expect(firstPitch(root)).toBeNull();
    note(root).removeAttribute('duraton');
    await vi.waitFor(() => expect(firstPitch(root)).toBe('C'));
    expect(root.diagnostics).toEqual([]);
  });

  it('observes annotation characterData changes without a property event or refresh call', async () => {
    const root = mount('<music-measure><music-direction>Warmly</music-direction><music-note pitch="C4" duration="whole"></music-note></music-measure>');
    await root.renderComplete;
    const text = root.querySelector('music-direction')!.firstChild!;
    text.nodeValue = 'Very freely';
    await vi.waitFor(() => expect(root.score!.staves[0].measures[0].annotations[0].text).toBe('Very freely'));
    expect(root.shadowRoot!.querySelector('.transcript pre')!.textContent).toContain('Very freely');
  });

  it.each(['pitched', 'rhythm', 'three-roads'])('describes the empty draft separately from written silence on a %s staff', async notation => {
    const root = mount(`<music-staff notation="${notation}"><music-measure incomplete><music-voice id="empty"></music-voice><music-voice id="silent"><music-rest measure></music-rest></music-voice></music-measure></music-staff>`);
    await root.renderComplete;
    expect(root.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
    const transcript = root.shadowRoot!.querySelector('.transcript pre')!.textContent!;
    expect(transcript).toContain('Voice 1: empty draft; rhythm not yet written.');
    expect(transcript).toContain('Voice 2: full-measure rest');
    expect(transcript).not.toContain('Voice 1: .');
  });

  it('describes an invalid empty complete voice without calling it an accepted draft', async () => {
    const root = mount('<music-staff><music-measure></music-measure></music-staff>');
    await root.renderComplete;
    expect(root.diagnostics.some(item => item.code === 'empty-voice' && item.severity === 'error')).toBe(true);
    expect(root.shadowRoot!.querySelector('.transcript pre')!.textContent).toContain('Voice 1: empty voice; rhythm not yet written.');
  });

  it('describes rhythm events without a fabricated pitch, clef, or key', async () => {
    const root = mount('<music-staff notation="rhythm" label="Claps"><music-measure><music-rhythm></music-rhythm><music-rest></music-rest><music-slash rhythmic></music-slash><music-slash></music-slash></music-measure></music-staff>');
    await root.renderComplete;
    expect(root.diagnostics).toEqual([]);
    const transcript = root.shadowRoot!.querySelector('.transcript pre')!.textContent!;
    expect(transcript).toContain('Claps; single-line rhythm staff; pitch unspecified');
    expect(transcript).toContain('rhythm note; pitch unspecified');
    expect(transcript).toContain('rhythmic slash');
    expect(transcript).toContain('improvised beat slash');
    expect(transcript).not.toMatch(/treble|key C|B4/);
    const event = root.querySelector('music-rhythm')!;
    event.duration = 'eighth';
    event.dots = 1;
    expect(event.getAttribute('duration')).toBe('eighth');
    expect(event.getAttribute('dots')).toBe('1');
    await root.renderComplete;
    expect(root.diagnostics.some(issue => issue.code === 'measure-underfull')).toBe(true);
  });

  it('reflects staff mode changes and rejects hiding pitched notes on a rhythm line', async () => {
    const root = mount<MusicStaff>('<music-staff><music-measure><music-note id="stable-pitch" pitch="Cqs4" duration="whole"></music-note></music-measure></music-staff>');
    await root.renderComplete;
    expect(root.notation).toBe('pitched');
    expect(root.shadowRoot!.querySelector('.transcript pre')!.textContent).toContain('C quarter-sharp 4');
    const source = root.getSource('stable-pitch');
    root.notation = 'rhythm';
    expect(root.getAttribute('notation')).toBe('rhythm');
    await root.renderComplete;
    expect(root.diagnostics.some(issue => issue.code === 'pitched-event-on-rhythm-staff')).toBe(true);
    expect(root.shadowRoot!.querySelector('.screen svg')).toBeNull();
    expect(source?.getAttribute('pitch')).toBe('Cqs4');
    root.notation = 'pitched';
    await root.renderComplete;
    expect(root.diagnostics).toEqual([]);
    expect(root.getSource('stable-pitch')).toBe(source);
  });

  it('describes relative road directions and observes edits without assigning a pitch', async () => {
    const root = mount<MusicStaff>('<music-staff notation="three-roads" label="Explore"><music-measure><music-road id="road" direction="higher" duration="half" tie="start"></music-road><music-road direction="same" duration="half" tie="end"></music-road></music-measure><music-measure><music-rest duration="half"></music-rest><music-road direction="lower" duration="half"></music-road></music-measure></music-staff>');
    await root.renderComplete;
    expect(root.diagnostics).toEqual([]);
    expect(root.notation).toBe('three-roads');
    const transcript = () => root.shadowRoot!.querySelector('.transcript pre')!.textContent!;
    expect(transcript()).toContain('3 roads music; top higher, middle same, bottom lower');
    expect(transcript()).toContain('Choose a starting reference pitch for each voice');
    expect(transcript()).toContain('rests preserve the reference');
    expect(transcript()).toContain('higher, top road, half');
    expect(transcript()).toContain('same, middle road; sustain without a new attack, half');
    expect(transcript()).toContain('lower, bottom road, half');
    expect(transcript()).not.toMatch(/treble|key C|B4|F5|E4|improvised beat slash/);
    const road = root.querySelector('music-road')!;
    const source = root.getSource('road');
    road.direction = 'lower';
    expect(road.getAttribute('direction')).toBe('lower');
    await root.renderComplete;
    expect(root.diagnostics).toEqual([]);
    expect(root.score!.staves[0].measures[0].voices[0].events[0]).toMatchObject({ pitchDirection: 'lower', pitches: [] });
    expect(root.getSource('road')).toBe(source);
    road.removeAttribute('direction');
    await root.renderComplete;
    expect(root.diagnostics.some(issue => issue.code === 'invalid-road-direction')).toBe(true);
    expect(root.shadowRoot!.querySelector('.screen svg')).toBeNull();
    road.direction = 'higher';
    await root.renderComplete;
    expect(root.diagnostics).toEqual([]);
    expect(root.toHTML()).toContain('direction="higher"');
  });

  it('keeps attached markings source-addressable and describes their performer meaning', async () => {
    const root = mount<MusicStaff>(`<music-staff notation="three-roads"><music-measure>
      <music-road id="marked-road" direction="same" duration="whole">
        <music-articulation id="attack" type="accent"></music-articulation>
        <music-ornament id="ornament" type="trill"></music-ornament>
        <music-interval id="harmony-above" value="5" placement="above"></music-interval>
        <music-interval id="harmony-below" value="b3" placement="below"></music-interval>
      </music-road>
    </music-measure></music-staff>`);
    await root.renderComplete;
    expect(root.diagnostics).toEqual([]);
    const voice = () => root.score!.staves[0].measures[0].voices[0];
    expect(voice().events).toHaveLength(1);
    expect(voice().events[0]).toMatchObject({ pitches: [], onset: { numerator: 0, denominator: 1 }, time: { numerator: 1, denominator: 1 } });
    const transcript = () => root.shadowRoot!.querySelector('.transcript pre')!.textContent!;
    expect(transcript()).toContain('last main pitch');
    expect(transcript()).toContain('Harmony tones and ornament auxiliaries do not change that reference');
    expect(transcript()).toContain('accent');
    expect(transcript()).toContain('trill');
    expect(transcript()).not.toMatch(/trill (above|below)/);
    expect(transcript()).toContain('harmony 5: perfect fifth above the main pitch');
    expect(transcript()).toContain('harmony b3: minor third below the main pitch');
    expect(transcript()).not.toMatch(/treble|key C|B4|F5|E4/);
    for (const id of ['attack', 'ornament', 'harmony-above', 'harmony-below']) {
      expect(root.getSource(id)).toBe(root.querySelector(`#${id}`));
    }
    // Child identities do not become separate rhythmic hit targets.
    expect(root.getHitRegions().map(region => region.sourceId)).toEqual(['marked-road']);
    const interval = root.querySelector('music-interval')!;
    engine.render.mockClear();
    interval.value = '♯11'; interval.placement = 'below';
    root.querySelector('music-articulation')!.type = 'tenuto';
    await root.renderComplete;
    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(voice().events[0].markings).toContainEqual({ id: 'harmony-above', kind: 'interval', interval: { number: 11, alter: 1 }, placement: 'below' });
    expect(root.getSource('harmony-above')).toBe(interval);
    expect(root.toHTML()).toContain('value="#11" placement="below"');
    expect(transcript()).toContain('harmony #11: augmented eleventh below the main pitch');
    expect(transcript()).toContain('tenuto');
    expect(voice().events[0].time).toEqual({ numerator: 1, denominator: 1 });
  });

  it('invalidates both projections for malformed interval children and restores them after repair', async () => {
    const root = mount<MusicStaff>('<music-staff notation="three-roads"><music-measure><music-road id="road" direction="same" duration="whole"><music-interval id="distance" value="13" placement="above"></music-interval></music-road></music-measure></music-staff>');
    await root.renderComplete;
    const interval = root.querySelector('music-interval')!;
    const oldPrint = root.shadowRoot!.querySelector('.print svg');
    interval.value = '14';
    await root.renderComplete;
    expect(root.diagnostics.some(issue => issue.code === 'invalid-harmony-interval' && issue.sourceId === 'distance')).toBe(true);
    expect(root.shadowRoot!.querySelector('svg')).toBeNull();
    expect(root.getHitRegions()).toEqual([]);
    interval.value = 'b3';
    interval.removeAttribute('placement');
    await root.renderComplete;
    expect(root.diagnostics.some(issue => issue.code === 'invalid-interval-placement' && issue.sourceId === 'distance')).toBe(true);
    expect(root.shadowRoot!.querySelector('svg')).toBeNull();
    interval.placement = 'below';
    await root.renderComplete;
    expect(root.diagnostics).toEqual([]);
    expect(root.shadowRoot!.querySelector('.print svg')).not.toBe(oldPrint);
    expect(root.getSource('distance')).toBe(interval);
    interval.remove();
    await root.renderComplete;
    expect(root.score!.staves[0].measures[0].voices[0].events[0].markings).toBeUndefined();
    expect(root.getSource('distance')).toBeUndefined();
    expect(root.getHitRegions()).toHaveLength(1);
  });

  it('makes renderComplete await an immediately preceding unobserved-attribute mutation', async () => {
    const root = mount();
    await root.renderComplete;
    note(root).setAttribute('pitchh', 'D4');
    await root.renderComplete;
    expect(root.diagnostics.some(diagnostic => diagnostic.code === 'unknown-attribute')).toBe(true);
    note(root).removeAttribute('pitchh');
    await root.renderComplete;
    expect(root.diagnostics).toEqual([]);
    expect(firstPitch(root)).toBe('C');
  });

  it('makes renderComplete await an immediately preceding text or child-list mutation', async () => {
    const root = mount('<music-measure><music-direction>Quietly</music-direction><music-note pitch="C4" duration="whole"></music-note></music-measure>');
    await root.renderComplete;
    root.querySelector('music-direction')!.firstChild!.nodeValue = 'Brightly';
    await root.renderComplete;
    expect(root.score!.staves[0].measures[0].annotations[0].text).toBe('Brightly');
    const replacement = document.createElement('music-note');
    replacement.pitch = 'G4'; replacement.duration = 'whole';
    note(root).replaceWith(replacement);
    await root.renderComplete;
    expect(firstPitch(root)).toBe('G');
  });

  it('keeps nested staffs and measures from rendering duplicate surfaces', async () => {
    const root = mount('<music-system><music-staff><music-measure><music-note pitch="C4" duration="whole"></music-note></music-measure></music-staff></music-system>');
    await root.renderComplete;
    await nextTask();
    expect(engine.render).toHaveBeenCalledTimes(2);
    const staff = root.querySelector('music-staff')!;
    const bar = root.querySelector('music-measure')!;
    expect(staff.shadowRoot!.querySelector<HTMLElement>('.surface')!.hidden).toBe(true);
    expect(bar.shadowRoot!.querySelector<HTMLElement>('.surface')!.hidden).toBe(true);
    expect(staff.shadowRoot!.querySelector('svg')).toBeNull();
    expect(bar.shadowRoot!.querySelector('svg')).toBeNull();
    engine.render.mockClear();
    note(root).pitch = 'E4';
    await root.renderComplete;
    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(firstPitch(root)).toBe('E');
  });

  it('transfers rendering ownership when a staff moves into and out of a system', async () => {
    const staff = mount('<music-staff id="moved"><music-measure><music-note pitch="C4" duration="whole"></music-note></music-measure></music-staff>');
    const system = mount('<music-system><music-staff><music-measure><music-rest measure></music-rest></music-measure></music-staff></music-system>');
    await Promise.all([staff.renderComplete, system.renderComplete]);
    engine.render.mockClear();
    system.append(staff);
    await system.renderComplete;
    await nextTask();
    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(system.score!.staves).toHaveLength(2);
    expect(staff.shadowRoot!.querySelector<HTMLElement>('.surface')!.hidden).toBe(true);
    engine.render.mockClear();
    document.body.append(staff);
    await Promise.all([staff.renderComplete, system.renderComplete]);
    await nextTask();
    expect(engine.render, JSON.stringify({
      staffDiagnostics: staff.diagnostics, systemDiagnostics: system.diagnostics,
      staffHidden: staff.shadowRoot!.querySelector<HTMLElement>('.surface')!.hidden,
      staffConnected: staff.isConnected, staffParent: staff.parentElement?.localName,
      renderedRoots: engine.render.mock.calls.map(([container]) => (container.getRootNode() as ShadowRoot).host.localName),
    })).toHaveBeenCalledTimes(4);
    expect(staff.shadowRoot!.querySelector<HTMLElement>('.surface')!.hidden).toBe(false);
    expect(staff.score!.staves).toHaveLength(1);
    expect(system.score!.staves).toHaveLength(1);
    expect(firstPitch(staff)).toBe('C');
  });

  it('disconnects observers and safely reinstalls them on reconnect', async () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    const resizeDisconnect = vi.spyOn(ResizeObserver.prototype, 'disconnect');
    const root = mount();
    await root.renderComplete;
    engine.render.mockClear();
    root.remove();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(resizeDisconnect).toHaveBeenCalledTimes(1);
    note(root).pitch = 'F4';
    await nextTask();
    expect(engine.render).not.toHaveBeenCalled();
    document.body.append(root);
    await root.renderComplete;
    expect(observe).toHaveBeenCalledTimes(2);
    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(firstPitch(root)).toBe('F');
  });
});

describe('viewport width and stable print geometry', () => {
  it('observes and floors inner content width instead of the transformed host border box', async () => {
    const size = viewport(770.703);
    const root = mount('<music-measure style="padding: 20px; border: 5px solid; transform: scale(2)" print-width="680.9"><music-note id="note" pitch="C4" duration="whole"></music-note></music-measure>');
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1641.406, 200));
    await root.renderComplete;
    expect(size.targets()).toEqual([root.shadowRoot!.querySelector('.surface')]);
    expect(engine.render.mock.calls.map(([, , options]) => options.width)).toEqual([770, 680]);
    expect(root.printWidth).toBe(680.9);
  });

  it('ignores repeat observations and fractional changes within the same pixel', async () => {
    const size = viewport(770.703);
    const root = mount();
    await root.renderComplete;
    engine.render.mockClear();
    size.resize(770.9);
    size.resize(770.05);
    await root.renderComplete;
    await nextTask();
    expect(engine.render).not.toHaveBeenCalled();
    size.resize(771.05);
    await root.renderComplete;
    expect(engine.render).toHaveBeenCalledTimes(1);
    expect(engine.render.mock.calls[0][2].width).toBe(771);
  });

  it('coalesces resize delivery while preserving the existing print SVG', async () => {
    const size = viewport(800);
    const root = mount();
    await root.renderComplete;
    const print = root.shadowRoot!.querySelector('.print svg');
    const source = root.innerHTML;
    const listener = vi.fn();
    root.addEventListener('notation-render', listener);
    engine.render.mockClear();
    size.resize(720.8);
    size.resize(680.4);
    size.resize(640.1);
    await root.renderComplete;
    await nextTask();
    expect(engine.render).toHaveBeenCalledTimes(1);
    expect(engine.render.mock.calls[0][2].width).toBe(640);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(root.shadowRoot!.querySelector('.print svg')).toBe(print);
    expect(root.innerHTML).toBe(source);
    expect(root.getSource('note')).toBe(note(root));
  });

  it('retains print-preview nodes, hit coordinates, and selection across resizes', async () => {
    const size = viewport(800);
    const root = mount('<music-measure print-preview print-width="420"><music-note id="note" pitch="C4" duration="whole"></music-note></music-measure>');
    await root.renderComplete;
    const print = root.shadowRoot!.querySelector('.print svg');
    const hits = root.getHitRegions();
    const selection = vi.fn();
    root.addEventListener('notation-select', selection);
    engine.render.mockClear();
    size.resize(340);
    await root.renderComplete;
    expect(engine.render).toHaveBeenCalledTimes(1);
    expect(root.shadowRoot!.querySelector('.print svg')).toBe(print);
    expect(root.getHitRegions()).toBe(hits);
    expect(root.getHitRegions()[0].width).toBe(420);
    print!.querySelector('rect')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(selection.mock.calls[0][0].detail).toEqual({ sourceId: 'note', sourceElement: note(root), ...noSelectionModifiers });
    expect(root.shadowRoot!.querySelector('.print')!.classList.contains('measuring')).toBe(false);
  });

  it('keeps valid print-preview hit coordinates available while a resize render waits', async () => {
    const size = viewport(800);
    const root = mount('<music-measure print-preview><music-note id="note" pitch="C4" duration="whole"></music-note></music-measure>');
    await root.renderComplete;
    const hits = root.getHitRegions();
    const font = deferred();
    engine.ready.mockReturnValueOnce(font.promise);
    size.resize(400);
    const complete = root.renderComplete;
    await vi.waitFor(() => expect(engine.ready).toHaveBeenCalledTimes(2));
    expect(root.getHitRegions()).toBe(hits);
    expect(root.getSource('note')).toBe(note(root));
    font.resolve();
    await complete;
    expect(root.getHitRegions()).toBe(hits);
  });

  it('retains cached print diagnostics once per render instead of dropping or duplicating them', async () => {
    const size = viewport(800);
    engine.render.mockImplementation((container, score, options) => ({
      ...draw(container, score, options),
      diagnostics: [{ severity: 'warning', code: 'notice', sourceId: score.id, message: `${container.className} notice` }],
    }));
    const root = mount();
    await root.renderComplete;
    const printNotice = root.diagnostics.find(diagnostic => diagnostic.code === 'print-notice');
    size.resize(700);
    await root.renderComplete;
    size.resize(600);
    await root.renderComplete;
    expect(root.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['notice', 'print-notice']);
    expect(root.diagnostics[1]).toEqual(printNotice);
  });

  it.each([
    ['print-width', '500'], ['max-measures', '2'], ['justify-last', ''],
    ['measure-numbers', 'all'], ['print-preview', ''],
  ])('invalidates print geometry when %s changes', async (attribute, value) => {
    viewport(800);
    const root = mount();
    await root.renderComplete;
    const oldPrint = root.shadowRoot!.querySelector('.print svg');
    engine.render.mockClear();
    root.setAttribute(attribute, value);
    await root.renderComplete;
    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(root.shadowRoot!.querySelector('.print svg')).not.toBe(oldPrint);
    if (attribute === 'print-width') expect(engine.render.mock.calls[1][2].width).toBe(500);
  });

  it('invalidates print geometry for pitch and annotation text changes', async () => {
    const size = viewport(800);
    const root = mount('<music-measure><music-direction>Warmly</music-direction><music-note id="note" pitch="C4" duration="whole"></music-note></music-measure>');
    await root.renderComplete;
    const oldPrint = root.shadowRoot!.querySelector('.print svg');
    engine.render.mockClear();
    note(root).pitch = 'D4';
    root.querySelector('music-direction')!.firstChild!.nodeValue = 'Freely';
    size.resize(700);
    await root.renderComplete;
    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(root.shadowRoot!.querySelector('.print svg')).not.toBe(oldPrint);
    expect(root.shadowRoot!.querySelector('.print svg')!.getAttribute('data-first-pitch')).toBe('D');
    expect(root.score!.staves[0].measures[0].annotations[0].text).toBe('Freely');
  });

  it('makes explicit refresh immediately measure the new width and rebuild both views', async () => {
    const size = viewport(800);
    const root = mount();
    await root.renderComplete;
    const oldPrint = root.shadowRoot!.querySelector('.print svg');
    engine.render.mockClear();
    size.setWidth(599.9); // No ResizeObserver delivery before this explicit refresh.
    await root.refresh();
    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(engine.render.mock.calls[0][2].width).toBe(599);
    expect(root.shadowRoot!.querySelector('.print svg')).not.toBe(oldPrint);
  });

  it('rebuilds cached print output after disconnect and reconnect', async () => {
    const size = viewport(800);
    const root = mount();
    await root.renderComplete;
    const oldPrint = root.shadowRoot!.querySelector('.print svg');
    root.remove();
    expect(size.targets()).toEqual([]);
    note(root).pitch = 'F4';
    size.setWidth(700);
    engine.render.mockClear();
    document.body.append(root);
    await root.renderComplete;
    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(root.shadowRoot!.querySelector('.print svg')).not.toBe(oldPrint);
    expect(firstPitch(root)).toBe('F');
    expect(root.getSource('note')).toBe(note(root));
  });

  it('does not reuse geometry measured while a root was hidden', async () => {
    const size = viewport(800);
    const root = mount();
    await root.renderComplete;
    engine.render.mockClear();
    size.resize(0);
    await nextTask();
    expect(engine.render).not.toHaveBeenCalled();
    note(root).pitch = 'E4';
    await root.renderComplete;
    const hiddenPrint = root.shadowRoot!.querySelector('.print svg');
    engine.render.mockClear();
    size.resize(800);
    await root.renderComplete;
    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(root.shadowRoot!.querySelector('.print svg')).not.toBe(hiddenPrint);
    expect(firstPitch(root)).toBe('E');
  });

  it('discards cached print output after a resize engraving error and can retry by resizing', async () => {
    const size = viewport(800);
    const root = mount();
    await root.renderComplete;
    engine.render.mockImplementationOnce(() => { throw new Error('Transient screen layout failure'); });
    size.resize(700);
    await root.renderComplete;
    expect(root.shadowRoot!.querySelector('svg')).toBeNull();
    expect(root.getHitRegions()).toEqual([]);
    engine.render.mockClear();
    size.resize(710);
    await root.renderComplete;
    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(root.diagnostics).toEqual([]);
    expect(firstPitch(root)).toBe('C');
  });

  it('does not cache an engraving result that reports an error diagnostic', async () => {
    const size = viewport(800);
    const root = mount();
    await root.renderComplete;
    engine.render.mockImplementationOnce((container, score, options) => ({
      ...draw(container, score, options),
      diagnostics: [{ severity: 'error', code: 'engine-error', sourceId: score.id, message: 'A reported engraving error' }],
    }));
    size.resize(700);
    await root.renderComplete;
    expect(root.diagnostics.some(diagnostic => diagnostic.code === 'engine-error')).toBe(true);
    engine.render.mockClear();
    size.resize(710);
    await root.renderComplete;
    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(root.diagnostics).toEqual([]);
  });

  it('never restores stale cached print geometry after a newer source edit', async () => {
    const size = viewport(800);
    const root = mount();
    await root.renderComplete;
    const font = deferred();
    engine.ready.mockReturnValueOnce(font.promise);
    size.resize(700);
    await vi.waitFor(() => expect(engine.ready).toHaveBeenCalledTimes(2));
    note(root).pitch = 'G4';
    await root.renderComplete;
    const print = root.shadowRoot!.querySelector('.print svg');
    expect(print!.getAttribute('data-first-pitch')).toBe('G');
    font.resolve();
    await nextTask();
    engine.render.mockClear();
    size.resize(600);
    await root.renderComplete;
    expect(engine.render).toHaveBeenCalledTimes(1);
    expect(root.shadowRoot!.querySelector('.print svg')).toBe(print);
    expect(firstPitch(root)).toBe('G');
  });
});

describe('asynchronous engraving lifecycle', () => {
  it('does not commit an obsolete font-waiting render or resolve completion early', async () => {
    const oldFont = deferred(); const newFont = deferred();
    engine.ready.mockReset().mockReturnValueOnce(oldFont.promise).mockReturnValue(newFont.promise);
    const root = mount();
    await vi.waitFor(() => expect(engine.ready).toHaveBeenCalledTimes(1));
    note(root).pitch = 'D4';
    const complete = root.renderComplete;
    let finished = false;
    void complete.then(() => { finished = true; });
    await vi.waitFor(() => expect(engine.ready).toHaveBeenCalledTimes(2));
    oldFont.resolve();
    await nextTask();
    expect(engine.render).not.toHaveBeenCalled();
    expect(finished).toBe(false);
    newFont.resolve();
    await complete;
    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(firstPitch(root)).toBe('D');
  });

  it.each(['resolve', 'reject'] as const)('ignores an older async render that later %ss', async outcome => {
    const oldFont = deferred(); const newFont = deferred();
    engine.ready.mockReset().mockReturnValueOnce(oldFont.promise).mockReturnValue(newFont.promise);
    const root = mount();
    await vi.waitFor(() => expect(engine.ready).toHaveBeenCalledTimes(1));
    note(root).pitch = 'E4';
    const complete = root.renderComplete;
    await vi.waitFor(() => expect(engine.ready).toHaveBeenCalledTimes(2));
    newFont.resolve();
    await complete;
    if (outcome === 'resolve') oldFont.resolve();
    else oldFont.reject(new Error('Old font request failed'));
    await nextTask();
    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(firstPitch(root)).toBe('E');
    expect(root.diagnostics).toEqual([]);
  });

  it('finishes a disconnected pending render and renders anew after reconnect', async () => {
    const font = deferred();
    engine.ready.mockReturnValueOnce(font.promise);
    const root = mount();
    const pending = root.renderComplete;
    await vi.waitFor(() => expect(engine.ready).toHaveBeenCalledTimes(1));
    root.remove();
    await pending;
    note(root).pitch = 'G4';
    document.body.append(root);
    await root.renderComplete;
    expect(firstPitch(root)).toBe('G');
    font.resolve();
    await nextTask();
    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(firstPitch(root)).toBe('G');
  });

  it('reports a failed font preparation and permits a later refresh to retry', async () => {
    engine.ready.mockRejectedValueOnce(new Error('Bundled notation font unavailable'));
    const root = mount();
    await root.renderComplete;
    expect(root.diagnostics).toEqual([expect.objectContaining({ code: 'engraving-error', message: 'Bundled notation font unavailable' })]);
    expect(engine.render).not.toHaveBeenCalled();
    expect(root.shadowRoot!.querySelector<HTMLDetailsElement>('.diagnostics')!.open).toBe(true);
    await root.refresh();
    expect(engine.ready).toHaveBeenCalledTimes(2);
    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(firstPitch(root)).toBe('C');
    expect(root.diagnostics).toEqual([]);
  });

  it('retries the actual font adapter after load and availability failures', async () => {
    const original = Object.getOwnPropertyDescriptor(document, 'fonts');
    const load = vi.fn().mockResolvedValue([]).mockRejectedValueOnce(new Error('Font load failed'));
    const check = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load, check } });
    try {
      await expect(actualFontPreparation!()).rejects.toThrow('Font load failed');
      const callsPerAttempt = load.mock.calls.length;
      expect(callsPerAttempt).toBeGreaterThan(0);
      await expect(actualFontPreparation!()).rejects.toThrow('could not be loaded');
      expect(load).toHaveBeenCalledTimes(callsPerAttempt * 2);
      await actualFontPreparation!();
      expect(load).toHaveBeenCalledTimes(callsPerAttempt * 3);
      await actualFontPreparation!();
      expect(load).toHaveBeenCalledTimes(callsPerAttempt * 3);
    } finally {
      if (original) Object.defineProperty(document, 'fonts', original);
      else Reflect.deleteProperty(document, 'fonts');
    }
  });

  it('clears partial output after an engine exception and can recover', async () => {
    engine.render.mockImplementationOnce((container, score, options) => {
      draw(container, score, options);
      throw new Error('Layout failed');
    });
    const root = mount();
    await root.renderComplete;
    expect(root.shadowRoot!.querySelector('svg')).toBeNull();
    expect(root.getHitRegions()).toEqual([]);
    expect(root.diagnostics.some(diagnostic => diagnostic.code === 'engraving-error')).toBe(true);
    await root.refresh();
    expect(firstPitch(root)).toBe('C');
    expect(root.diagnostics).toEqual([]);
  });

  it('keeps renderComplete pending when a render listener makes another edit', async () => {
    const root = mount();
    await root.renderComplete;
    const font = deferred();
    engine.ready.mockReset().mockResolvedValueOnce().mockReturnValue(font.promise);
    let reentered = false;
    root.addEventListener('notation-render', () => {
      if (reentered) return;
      reentered = true;
      note(root).pitch = 'E4';
    });
    note(root).pitch = 'D4';
    const completion = root.renderComplete;
    let finished = false;
    void completion.then(() => { finished = true; });
    await vi.waitFor(() => expect(engine.ready).toHaveBeenCalledTimes(2));
    await nextTask();
    expect(finished).toBe(false);
    expect(firstPitch(root)).toBe('D');
    font.resolve();
    await completion;
    expect(firstPitch(root)).toBe('E');
  });

  it.each(['notation-render', 'notation-diagnostics'])('keeps completion pending for a characterData edit inside %s', async eventName => {
    const root = mount('<music-measure><music-direction>Quietly</music-direction><music-note pitch="C4" duration="whole"></music-note></music-measure>');
    await root.renderComplete;
    const font = deferred();
    engine.ready.mockReset().mockResolvedValueOnce().mockReturnValue(font.promise);
    let reentered = false;
    root.addEventListener(eventName, () => {
      if (reentered) return;
      reentered = true;
      root.querySelector('music-direction')!.firstChild!.nodeValue = 'With energy';
    });
    note(root).pitch = 'D4';
    const completion = root.renderComplete;
    let finished = false;
    void completion.then(() => { finished = true; });
    await vi.waitFor(() => expect(engine.ready).toHaveBeenCalledTimes(2));
    await nextTask();
    expect(finished).toBe(false);
    font.resolve();
    await completion;
    expect(root.score!.staves[0].measures[0].annotations[0].text).toBe('With energy');
  });
});

describe('export, diagnostics, and selection integration', () => {
  it('exports fresh cloned JSON and safely escaped equivalent HTML', async () => {
    const root = mount('<music-measure><music-direction text="Quietly"></music-direction><music-note id="n" pitch="C4" duration="whole"></music-note></music-measure>');
    await root.renderComplete;
    root.label = 'A & B "<study>"';
    root.querySelector('music-direction')!.text = '<script>alert("x")</script> & solo';
    note(root).pitch = 'D4';
    const exported = root.toJSON();
    expect(exported.staves[0].measures[0].voices[0].events[0].pitches[0].step).toBe('D');
    Reflect.set(exported.staves[0].measures[0].voices[0].events[0].pitches[0], 'step', 'B');
    expect(root.toJSON().staves[0].measures[0].voices[0].events[0].pitches[0].step).toBe('D');
    const html = root.toHTML();
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    const template = document.createElement('template'); template.innerHTML = html;
    expect(readScore(template.content.firstElementChild!).score).toEqual(root.toJSON());
    await root.renderComplete;
    expect(currentPitch(root)).toBe('D');
    expect(root.shadowRoot!.querySelector('script')).toBeNull();
    expect(root.shadowRoot!.querySelector('.transcript pre')!.textContent).toContain('<script>');
  });

  it('refuses invalid exports and displays user-controlled diagnostics as text', async () => {
    const root = mount();
    await root.renderComplete;
    note(root).pitch = '<img src=x onerror=alert(1)>';
    expect(() => root.toJSON()).toThrow('Fix notation errors');
    expect(() => root.toHTML()).toThrow('Fix notation errors');
    await root.renderComplete;
    expect(root.shadowRoot!.querySelector('img')).toBeNull();
    expect(root.shadowRoot!.querySelector('.diagnostics')!.textContent).toContain('<img src=x');
    expect(root.shadowRoot!.querySelector('svg')).toBeNull();
  });

  it('reports invalid layout options instead of invoking engraving', async () => {
    const root = mount('<music-measure max-measures="0" print-width="-4" measure-numbers="sometimes"><music-rest measure></music-rest></music-measure>');
    await root.renderComplete;
    expect(root.diagnostics.filter(diagnostic => diagnostic.code === 'invalid-layout')).toHaveLength(3);
    expect(engine.render).not.toHaveBeenCalled();
  });

  it('emits diagnostics/render details and keeps hit regions linked to authored elements', async () => {
    const root = mount();
    const renderListener = vi.fn(); const diagnosticsListener = vi.fn();
    root.addEventListener('notation-render', renderListener);
    root.addEventListener('notation-diagnostics', diagnosticsListener);
    await root.renderComplete;
    expect(renderListener).toHaveBeenCalledTimes(1);
    const event = renderListener.mock.calls[0][0] as CustomEvent;
    expect(event.bubbles).toBe(true); expect(event.composed).toBe(true);
    expect(event.detail.score).toBe(root.score);
    expect(event.detail.diagnostics).toEqual([]);
    expect(event.detail.hitRegions).toEqual(root.getHitRegions());
    expect(diagnosticsListener.mock.calls[0][0].detail.diagnostics).toEqual([]);
    const hit = root.getHitRegions()[0];
    expect(hit.sourceId).toBe('note');
    expect(root.getSource(hit.sourceId)).toBe(note(root));
    expect(root.getSource('missing')).toBeUndefined();
  });

  it('bubbles notation-select from SVG hit elements with the source element', async () => {
    const root = mount();
    await root.renderComplete;
    const listener = vi.fn();
    document.body.addEventListener('notation-select', listener, { once: true });
    root.shadowRoot!.querySelector('.screen rect')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toEqual({ sourceId: 'note', sourceElement: note(root), ...noSelectionModifiers });
  });

  it.each(['svg', 'host'] as const)('preserves click count, modifiers and pointer type through the %s selection route', async route => {
    const root = mount('<music-system><music-staff><music-measure><music-note id="note" pitch="C4" duration="whole"></music-note></music-measure></music-staff></music-system>');
    await root.renderComplete;
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Win32');
    const hit = vi.spyOn(root, 'getSourceAtPoint').mockReturnValue('note');
    const listener = vi.fn(); root.addEventListener('notation-select', listener);
    const target = route === 'svg' ? root.shadowRoot!.querySelector('.screen rect')! : root;
    target.dispatchEvent(new PointerEvent('click', { bubbles: true, composed: true, cancelable: true,
      clientX: 120, clientY: 30, detail: 2, shiftKey: true, ctrlKey: true, metaKey: true, altKey: true, pointerType: 'pen' }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toEqual({ sourceId: 'note', sourceElement: note(root),
      clickCount: 2, shiftKey: true, ctrlKey: true, metaKey: true, altKey: true, pointerType: 'pen' });
    if (route === 'host') expect(hit).toHaveBeenCalledWith(120, 30);
    else expect(hit).not.toHaveBeenCalled();
  });

  it('keeps a double-click as two semantic clicks with no second activation event', async () => {
    const root = mount(); await root.renderComplete;
    const target = root.shadowRoot!.querySelector('.screen rect')!; const listener = vi.fn(); root.addEventListener('notation-select', listener);
    for (const [type, detail] of [['click', 1], ['click', 2], ['dblclick', 2]] as const) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true, detail }));
    }
    expect(listener.mock.calls.map(call => call[0].detail.clickCount)).toEqual([1, 2]);
  });

  it.each(['svg', 'host'] as const)('retains an exact child marking identity on the %s route', async route => {
    const root = mount('<music-system><music-staff><music-measure><music-note id="note" pitch="C4" duration="whole"><music-articulation id="mark" type="staccato"></music-articulation></music-note></music-measure></music-staff></music-system>');
    await root.renderComplete;
    vi.spyOn(root, 'getSourceAtPoint').mockReturnValue('mark');
    const child = document.createElementNS('http://www.w3.org/2000/svg', 'g'); child.setAttribute('data-source-id', 'mark');
    const glyph = document.createElementNS('http://www.w3.org/2000/svg', 'text'); child.append(glyph);
    root.shadowRoot!.querySelector('.screen g')!.append(child);
    const listener = vi.fn(); root.addEventListener('notation-select', listener);
    (route === 'svg' ? glyph : root).dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, detail: 2 }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toMatchObject({ sourceId: 'mark', sourceElement: root.getSource('mark'), clickCount: 2 });
  });

  it('does not dispatch notation selection for native controls or transcript text carrying a source-like attribute', async () => {
    const root = mount(); await root.renderComplete;
    const transcript = root.shadowRoot!.querySelector('.transcript pre')!; transcript.setAttribute('data-source-id', 'note');
    const listener = vi.fn(); root.addEventListener('notation-select', listener);
    transcript.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    const button = document.createElement('button'); button.setAttribute('data-source-id', 'note'); root.shadowRoot!.querySelector('.screen')!.append(button);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(listener).not.toHaveBeenCalled();
  });

  it('retains standalone notation selection when a workbook wraps the score in a disclosure', async () => {
    const root = mount(); const disclosure = document.createElement('details'); disclosure.open = true;
    document.body.append(disclosure); disclosure.append(root); await root.renderComplete;
    const listener = vi.fn(); root.addEventListener('notation-select', listener);
    root.shadowRoot!.querySelector('.screen rect')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail.sourceId).toBe('note');
  });

  it('leaves macOS Control-click native without a semantic activation', async () => {
    const root = mount(); await root.renderComplete;
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const listener = vi.fn(); root.addEventListener('notation-select', listener);
    const event = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, ctrlKey: true, detail: 1 });
    root.shadowRoot!.querySelector('.screen rect')!.dispatchEvent(event);
    expect(listener).not.toHaveBeenCalled(); expect(event.defaultPrevented).toBe(false);
  });

  it('does not prevent native instruction text behavior on the inert host route', async () => {
    const root = mount('<music-system><music-staff><music-measure><music-direction id="text" text="Play freely"></music-direction><music-note id="note" pitch="C4" duration="whole"></music-note></music-measure></music-staff></music-system>');
    await root.renderComplete; vi.spyOn(root, 'getSourceAtPoint').mockReturnValue('text');
    const listener = vi.fn(); root.addEventListener('notation-select', listener);
    const event = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, detail: 1 }); root.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(listener.mock.calls[0][0].detail).toMatchObject({ sourceId: 'text', sourceElement: root.getSource('text') });
  });

  it('exposes current measured hit testing with child-first identity and clipping checks', async () => {
    const root = mount('<music-system><music-staff><music-measure><music-note id="note" pitch="C4" duration="whole"><music-articulation id="mark" type="staccato"></music-articulation></music-note></music-measure></music-staff></music-system>');
    await root.renderComplete;
    const svg = root.shadowRoot!.querySelector<SVGSVGElement>('.screen svg')!; svg.classList.add('notation-svg');
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 50));
    Object.defineProperty(svg, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
    vi.stubGlobal('DOMPoint', class {
      readonly x: number; readonly y: number;
      constructor(x = 0, y = 0) { this.x = x; this.y = y; }
      matrixTransform() { return this; }
    });
    const layout: LayoutGeometry = { projection: 'screen', projectionId: 'unit-measured', revision: 1, scoreId: root.score!.id,
      systems: [{ index: 0, start: 0, end: 1, width: 200, height: 50, viewBox: { x: 0, y: 0, width: 200, height: 50 },
        ink: { x: 0, y: 0, width: 200, height: 50 }, pageBreak: false, staves: [], measures: [], events: [], annotations: [], tuplets: [], anchors: [],
        markings: [{ sourceId: 'mark', eventId: 'note', staffId: 'staff', measureId: 'bar', voiceId: 'voice', system: 0,
          kind: 'articulation', placement: 'above', x: 10, y: 10, width: 4, height: 4 }] }] };
    vi.spyOn(root, 'getLayoutGeometry').mockReturnValue(layout);
    expect(root.getSourceAtPoint(11, 11)).toBe('mark');
    expect(root.getSourceAtPoint(18, 11)).toBe('note');
    expect(root.getSourceAtPoint(201, 11)).toBeUndefined();
    expect(root.getSourceAtPoint(Number.NaN, 11)).toBeUndefined();
    vi.mocked(root.getLayoutGeometry).mockReturnValue(undefined);
    expect(root.getSourceAtPoint(11, 11)).toBeUndefined();
  });

  it('uses print hit regions in print-preview and labels print diagnostics distinctly', async () => {
    engine.render.mockImplementation((container, score, options) => {
      const result = draw(container, score, options);
      const diagnostic: Diagnostic = { severity: 'warning', code: 'layout-overflow', sourceId: score.id, message: 'An intentional notice' };
      return { ...result, diagnostics: [diagnostic] };
    });
    const root = mount('<music-measure print-width="420" print-preview><music-note id="n" pitch="C4" duration="whole"></music-note></music-measure>');
    await root.renderComplete;
    expect(root.getHitRegions()[0].width).toBe(420);
    expect(root.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['layout-overflow', 'print-layout-overflow']);
    expect(root.diagnostics[1].message).toBe('Print: An intentional notice');
    root.printPreview = false;
    await root.renderComplete;
    expect(root.getHitRegions()[0].width).toBe(680);
  });
});

describe('coordinate selection on every rendered root', () => {
  const roots = ['music-system', 'music-staff', 'music-measure'] as const;

  async function fixture(kind: typeof roots[number]) {
    viewport(200);
    // Supply measured adapter output while retaining the real projection
    // lifecycle. happy-dom itself cannot measure SVG ink or screen matrices.
    engine.render.mockImplementation((container, score, options) => {
      const result = draw(container, score, options);
      const svg = container.querySelector('svg')!;
      svg.classList.add('notation-svg');
      vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 50));
      Object.defineProperty(svg, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
      return { ...result, hitRegions: result.hitRegions.map(hit => ({ ...hit, width: 8 })),
        systemGeometry: [{ index: 0, start: 0, end: 1, width: 200, height: 50,
          viewBox: { x: 0, y: 0, width: 200, height: 50 }, ink: { x: 0, y: 0, width: 200, height: 50 },
          pageBreak: false, staves: [], measures: [], events: [], annotations: [], tuplets: [], anchors: [] }] };
    });
    vi.stubGlobal('DOMPoint', class {
      readonly x: number; readonly y: number;
      constructor(x = 0, y = 0) { this.x = x; this.y = y; }
      matrixTransform() { return this; }
    });
    const measure = '<music-measure incomplete><music-note id="note" pitch="F4" duration="quarter"></music-note><music-rest id="rest" duration="quarter"></music-rest></music-measure>';
    const staff = `<music-staff>${measure}</music-staff>`;
    const root = mount(kind === 'music-measure' ? measure : kind === 'music-staff' ? staff : `<music-system>${staff}</music-system>`);
    await root.renderComplete;
    expect(root.getLayoutGeometry()).toBeDefined();
    expect(root.getSourceAtPoint(17, 11)).toBe('rest');
    return root;
  }

  const routes = roots.flatMap(kind => (['host', 'background'] as const).map(route => ({ kind, route })));
  it.each(routes)('selects exact note/rest identities once through the $kind $route', async ({ kind, route }) => {
    const root = await fixture(kind);
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Win32');
    const listener = vi.fn(); root.addEventListener('notation-select', listener);
    const target = route === 'host' ? root : root.shadowRoot!.querySelector('.screen svg')!;
    for (const [sourceId, clientX, clickCount] of [['note', 5, 1], ['rest', 17, 2]] as const) {
      const event = new PointerEvent('click', { bubbles: true, composed: true, cancelable: true,
        clientX, clientY: 11, detail: clickCount, shiftKey: true, ctrlKey: true, metaKey: true, altKey: true, pointerType: 'pen' });
      target.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(listener).toHaveBeenCalledTimes(clickCount);
      expect(listener.mock.lastCall![0].detail).toEqual({ sourceId, sourceElement: root.getSource(sourceId),
        clickCount, shiftKey: true, ctrlKey: true, metaKey: true, altKey: true, pointerType: 'pen' });
    }
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true, detail: 2, clientX: 17, clientY: 11 }));
    expect(listener).toHaveBeenCalledTimes(2);
    const miss = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, clientX: 150, clientY: 11 });
    target.dispatchEvent(miss);
    expect(listener).toHaveBeenCalledTimes(2); expect(miss.defaultPrevented).toBe(false);
  });

  it.each(roots)('rejects coordinate selection while %s geometry is invalidated', async kind => {
    const root = await fixture(kind);
    const background = root.shadowRoot!.querySelector('.screen svg')!;
    const listener = vi.fn(); root.addEventListener('notation-select', listener);
    root.querySelector('music-rest')!.setAttribute('duration', 'eighth');
    for (const target of [root, background]) {
      const event = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, clientX: 17, clientY: 11 });
      target.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(listener).not.toHaveBeenCalled();
    expect(root.getLayoutGeometry()).toBeUndefined();
    await root.renderComplete;
    root.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: 17, clientY: 11 }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.lastCall![0].detail.sourceId).toBe('rest');
  });

  it.each(roots)('preserves native controls, prose, prevented clicks and secondary clicks on %s', async kind => {
    const root = await fixture(kind);
    const measure = root.querySelector('music-measure') ?? root;
    const direction = document.createElement('music-direction'); direction.id = 'instruction'; direction.text = 'Play freely';
    measure.prepend(direction); await root.renderComplete;
    const listener = vi.fn(); root.addEventListener('notation-select', listener);
    const hit = vi.spyOn(root, 'getSourceAtPoint').mockReturnValue('rest');
    const transcript = root.shadowRoot!.querySelector('.transcript pre')!;
    transcript.setAttribute('data-source-id', 'rest');
    const button = document.createElement('button'); button.setAttribute('data-source-id', 'rest');
    root.shadowRoot!.querySelector('.screen')!.append(button);
    for (const target of [transcript, button]) {
      const event = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, clientX: 17, clientY: 11 });
      target.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
    }
    const prevented = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, clientX: 17, clientY: 11 });
    prevented.preventDefault(); root.dispatchEvent(prevented);
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
    for (const options of [{ button: 2 }, { ctrlKey: true }]) {
      const event = new MouseEvent('click', { ...options, bubbles: true, composed: true, cancelable: true, clientX: 17, clientY: 11 });
      root.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
    }
    expect(listener).not.toHaveBeenCalled(); expect(hit).not.toHaveBeenCalled();
    hit.mockReturnValue('instruction');
    const prose = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, clientX: 17, clientY: 11 });
    root.dispatchEvent(prose);
    expect(prose.defaultPrevented).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.lastCall![0].detail).toMatchObject({ sourceId: 'instruction', sourceElement: direction });
  });

  it('does not activate nested source surfaces as if they rendered their own projection', async () => {
    const root = await fixture('music-system');
    const listener = vi.fn(); root.addEventListener('notation-select', listener);
    for (const nested of root.querySelectorAll<MusicSurface>('music-staff,music-measure')) {
      const hit = vi.spyOn(nested, 'getSourceAtPoint').mockReturnValue('rest');
      nested.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: 17, clientY: 11 }));
      expect(hit).not.toHaveBeenCalled();
    }
    expect(listener).not.toHaveBeenCalled();
  });
});
