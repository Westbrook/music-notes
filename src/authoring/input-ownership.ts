import type { MusicSurface } from '../components/music-surface.js';

export interface AuthorInputContext {
  host: HTMLElement;
  surface: MusicSurface | undefined;
}

export interface AuthorInputOwner {
  owner: 'native' | 'notation' | 'score' | 'outside';
  sourceId?: string;
  sourceElement?: Element;
}

type Modifiers = Pick<MouseEvent, 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>;

const glyphSources = new Set(['music-note', 'music-chord', 'music-rest', 'music-slash', 'music-rhythm',
  'music-road', 'music-articulation', 'music-ornament', 'music-interval', 'music-tuplet']);
const proseSources = new Set(['music-tempo', 'music-dynamics', 'music-direction', 'music-harmony', 'music-rehearsal']);
const nativeSelector = 'input,textarea,select,option,optgroup,button,a[href],summary,label,details,pre,code,blockquote,'
  + 'audio,video,iframe,object,embed,foreignObject,[data-author-input="native"],'
  + '.transcript,.diagnostics,.keyboard-help,.workspace-footer,.field-help,.vf-music-annotation,.vf-staff-label,.vf-measure-number,'
  + '[role="button"],[role="checkbox"],[role="combobox"],[role="link"],[role="listbox"],[role="menu"],'
  + '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="option"],[role="radio"],'
  + '[role="searchbox"],[role="slider"],[role="spinbutton"],[role="switch"],[role="tab"],[role="textbox"]';

function element(value: EventTarget): value is Element {
  // Events can arrive from another realm; an instanceof check would miss it.
  return 'nodeType' in value && value.nodeType === 1 && 'matches' in value && typeof value.matches === 'function';
}

/** Preserve native controls and readable text even across nested shadow roots. */
export function isNativeAuthorInput(event: Event): boolean {
  if ('isComposing' in event && event.isComposing) return true;
  return event.composedPath().some(item => {
    if (!element(item)) return false;
    if (item.matches(nativeSelector) || proseSources.has(item.localName)) return true;
    const editable = item.getAttribute('contenteditable')?.toLowerCase();
    return editable === '' || editable === 'true' || editable === 'plaintext-only'
      || (item as HTMLElement).isContentEditable === true || item.ownerDocument.designMode?.toLowerCase() === 'on';
  });
}

export function hasInputModifier(event: Modifiers): boolean {
  return event.shiftKey || event.ctrlKey || event.metaKey || event.altKey;
}

function macPlatform(platform: string): boolean { return /Mac|iPhone|iPad|iPod/i.test(platform); }

export function isNativeSecondaryClick(event: Pick<MouseEvent, 'button' | 'ctrlKey'>, platform = navigator.platform): boolean {
  return event.button !== 0 || (event.ctrlKey && macPlatform(platform));
}

/** macOS Control-click remains the platform's secondary-click gesture. */
export function selectionModifier(event: Modifiers, platform = navigator.platform): 'range' | 'toggle' | undefined {
  if (event.ctrlKey && macPlatform(platform)) return undefined;
  if (event.altKey) return undefined;
  if (event.shiftKey) return 'range';
  if (macPlatform(platform) ? event.metaKey : event.ctrlKey) return 'toggle';
  return undefined;
}

/**
 * Resolve ownership, not selection. Source identity comes from the currently
 * rendered surface; browser Selection objects are never musical targets.
 */
export function classifyAuthorInput(event: Event, context: AuthorInputContext): AuthorInputOwner {
  const path = event.composedPath();
  if (isNativeAuthorInput(event)) return { owner: 'native' };
  if (!path.includes(context.host)) return { owner: 'outside' };
  const drawn = path.find(item => element(item) && item.hasAttribute('data-source-id')) as Element | undefined;
  let sourceId = drawn?.getAttribute('data-source-id') ?? undefined;
  if (!sourceId && 'clientX' in event && 'clientY' in event
    && typeof event.clientX === 'number' && typeof event.clientY === 'number') {
    sourceId = context.surface?.getSourceAtPoint?.(event.clientX, event.clientY);
  }
  const sourceElement = sourceId ? context.surface?.getSource?.(sourceId) : undefined;
  if (sourceElement && proseSources.has(sourceElement.localName)) return { owner: 'native', sourceId, sourceElement };
  if (sourceElement && glyphSources.has(sourceElement.localName)) return { owner: 'notation', sourceId, sourceElement };
  return { owner: 'score' };
}

interface SelectionPress {
  surface: MusicSurface;
  projectionId: string;
  revision: number;
  sourceId: string;
}

export interface AuthorTextSelectionOptions {
  host: HTMLElement;
  context: () => { enabled: boolean; surface: MusicSurface | undefined };
}

/**
 * Author-only text-selection boundary. Canceling an owned mouse/selectstart
 * default avoids inherited user-select rules on Source, prose, or the workbook.
 * Pointerdown is observed, never prevented: touch panning and zoom stay native.
 */
export class AuthorTextSelection {
  private readonly options: AuthorTextSelectionOptions;
  private readonly abort = new AbortController();
  private press?: SelectionPress;
  private nativePress = false;

  constructor(options: AuthorTextSelectionOptions) {
    this.options = options;
    const document = options.host.ownerDocument;
    const listen = (target: EventTarget, type: string, callback: EventListener) => {
      target.addEventListener(type, callback, { capture: true, signal: this.abort.signal });
    };
    listen(document, 'pointerdown', event => this.remember(event as PointerEvent));
    listen(document, 'mousedown', event => {
      const mouse = event as MouseEvent;
      this.remember(mouse);
      if (this.press) mouse.preventDefault();
    });
    listen(document, 'selectstart', event => {
      const state = options.context();
      if (!state.enabled || this.nativePress) return;
      const owner = classifyAuthorInput(event, { host: options.host, surface: state.surface });
      if (owner.owner === 'notation' || (owner.owner === 'score' && this.currentPress(state.surface))) event.preventDefault();
    });
    for (const type of ['pointerup', 'pointercancel', 'mouseup', 'scroll']) listen(document, type, () => this.clear());
    if (document.defaultView) listen(document.defaultView, 'blur', () => this.clear());
  }

  private remember(event: MouseEvent | PointerEvent): void {
    this.press = undefined;
    const state = this.options.context();
    const platform = this.options.host.ownerDocument.defaultView?.navigator.platform ?? '';
    this.nativePress = isNativeSecondaryClick(event, platform) || ('isPrimary' in event && !event.isPrimary);
    if (!state.enabled || !state.surface || this.nativePress) return;
    const owner = classifyAuthorInput(event, { host: this.options.host, surface: state.surface });
    if (owner.owner !== 'notation' || !owner.sourceId) return;
    const layout = state.surface.getLayoutGeometry();
    if (layout) this.press = { surface: state.surface, projectionId: layout.projectionId,
      revision: layout.revision, sourceId: owner.sourceId };
  }

  private currentPress(surface: MusicSurface | undefined): boolean {
    if (!this.press || surface !== this.press.surface) return false;
    const layout = surface.getLayoutGeometry();
    return layout?.projectionId === this.press.projectionId && layout.revision === this.press.revision
      && !!surface.getSource(this.press.sourceId);
  }

  clear(): void { this.press = undefined; this.nativePress = false; }
  dispose(): void { this.clear(); this.abort.abort(); }
}
