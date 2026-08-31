import type { ViewMode } from './types.js';
import { activeElement, composedAncestors, composedContains, composedParent, isRenderedInParent } from '../ui/composed-dom.js';
import { asControlScope } from './control-scope.js';
import type { ControlRoot, ControlScope } from './control-scope.js';

/** The edit route remains compatible with callers, but Properties is not a tab. */
export type WorkspaceTool = 'edit' | 'rhythm' | 'markings' | 'measure';
export type WorkspaceGeneralTool = Exclude<WorkspaceTool, 'edit'>;
export type WorkspacePanePlacement = 'side' | 'sheet';
export type WorkspaceToolsPresentation = 'closed' | WorkspacePanePlacement;

export interface WorkspaceToolsState {
  readonly mode: ViewMode;
  /** The retained preference; Read and Pages can hide an otherwise open pane. */
  readonly open: boolean;
  readonly expanded: boolean;
  /** Current destination; edit denotes the untabbed Properties region. */
  readonly tab: WorkspaceTool;
  readonly view: 'properties' | 'tools';
  /** Other tools returns to this tab without replacing the Properties target. */
  readonly generalTab: WorkspaceGeneralTool;
  readonly visible: boolean;
  /** Available placement supplied from the independently measured writing frame. */
  readonly panePlacement: WorkspacePanePlacement;
  /** Effective presentation; retained expansion cannot make a hidden view an active sheet. */
  readonly presentation: WorkspaceToolsPresentation;
}

export interface WorkspaceToolsTransition {
  readonly reason: 'show' | 'hide' | 'tab' | 'mode' | 'expand' | 'collapse' | 'layout';
  readonly previous: WorkspaceToolsState;
  readonly next: WorkspaceToolsState;
}

export interface WorkspaceToolsEntryContext {
  readonly entryMode: boolean;
  /** Supplied by the musical owner; opening a pane never invents an inspection target. */
  readonly hasPropertiesTarget: boolean;
}

export interface WorkspaceToolsDestinationToggle {
  /** A focusable action in this document, outside the pane, that remains available on close. */
  readonly invoker: HTMLElement;
  readonly focusTarget?: string | HTMLElement;
  /** The owner compares actual musical targets; matching a panel name alone is insufficient. */
  readonly sameContext: boolean;
}

export type WorkspaceToolsToggleResult = 'opened' | 'closed' | 'unavailable';

export interface WorkspaceToolsOptions {
  /** Attribute presentation belongs to the workspace owner, not a queried descendant. */
  stateHost?: HTMLElement;
  initial?: Partial<Pick<WorkspaceToolsState, 'mode' | 'open' | 'expanded' | 'tab' | 'generalTab' | 'panePlacement'>>;
  /** Capture the visible musical anchor and cancel gestures before DOM layout changes. */
  beforeChange?: (transition: WorkspaceToolsTransition) => void;
  /** Navigation notification only. The owner decides when explicit correction parks entry. */
  onOpen?: () => void;
  /** Task changes retain pane dimensions; only layout changes need a new render. */
  afterChange?: (state: WorkspaceToolsState, transition: WorkspaceToolsTransition) => void;
  /** Restore the preserved visible writing anchor and focus, never jump to an older selection. */
  onReturnToScore?: () => void;
  /** Owners can include their in-flow popover fallbacks when a workspace view changes. */
  closeTransientPopovers?: () => void;
}

interface ScrollPosition { panelTop: number; panelLeft: number; paneTop: number; paneLeft: number }

const panelIds: Record<WorkspaceTool, string> = {
  edit: 'selection-inspector', rhythm: 'passage-inspector',
  markings: 'annotation-inspector', measure: 'measure-inspector',
};
const generalTools: readonly WorkspaceGeneralTool[] = ['rhythm', 'markings', 'measure'];
const tools: readonly WorkspaceTool[] = ['edit', ...generalTools];
const toolLabels: Record<WorkspaceTool, string> = { edit: 'Properties', rhythm: 'Relationships', markings: 'Instructions', measure: 'Measure' };

function isViewMode(value: string | undefined): value is ViewMode {
  return value === 'write' || value === 'read' || value === 'pages';
}

function presentation(state: Pick<WorkspaceToolsState, 'mode' | 'open' | 'expanded' | 'panePlacement'>): WorkspaceToolsPresentation {
  return state.mode !== 'write' || !state.open ? 'closed' : state.expanded || state.panePlacement === 'sheet' ? 'sheet' : 'side';
}

function canFocus(element: HTMLElement | null | undefined): element is HTMLElement {
  if (!element?.isConnected
    || element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true') return false;
  const view = element.ownerDocument.defaultView;
  for (const current of [element, ...composedAncestors(element)]) {
    if (!isRenderedInParent(current) || current.matches('[hidden], [inert], [aria-hidden="true"], dialog:not([open])')) return false;
    const style = view?.getComputedStyle(current);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse'
      || style?.contentVisibility === 'hidden') return false;
  }
  return true;
}

/** One persistent pane. Musical targets, drafts, entry state and history belong to its owner. */
export class WorkspaceTools {
  private readonly options: WorkspaceToolsOptions;
  private readonly document: Document;
  private readonly scope: ControlScope;
  private readonly stateHost: HTMLElement;
  private readonly abort = new AbortController();
  private readonly pane: HTMLElement;
  private readonly toggleButton: HTMLButtonElement;
  private readonly hideButton: HTMLButtonElement | null;
  private readonly expandButton: HTMLButtonElement | null;
  private readonly otherButton: HTMLButtonElement;
  private readonly backButton: HTMLButtonElement;
  private readonly tablist: HTMLElement;
  private readonly tabs: Record<WorkspaceGeneralTool, HTMLButtonElement>;
  private readonly panels: Record<WorkspaceTool, HTMLElement>;
  private readonly positions = new Map<WorkspaceTool, Partial<Record<WorkspacePanePlacement, ScrollPosition>>>();
  private entryContext: WorkspaceToolsEntryContext = { entryMode: false, hasPropertiesTarget: false };
  private current: WorkspaceToolsState;
  private invoker: HTMLElement | null = null;
  private disposed = false;

  constructor(options: WorkspaceToolsOptions = {}, root: ControlRoot = document) {
    this.options = options;
    this.scope = asControlScope(root);
    this.document = this.scope.document;
    this.stateHost = options.stateHost ?? this.document.body;
    const control = <T extends HTMLElement>(id: string): T => {
      const element = this.scope.getElementById(id);
      if (!element) throw new Error('Missing workspace tools control: ' + id);
      return element as T;
    };
    this.pane = control('workspace-tools');
    this.toggleButton = control('tools-toggle');
    this.hideButton = this.scope.getElementById('tools-hide') as HTMLButtonElement | null;
    this.expandButton = this.scope.getElementById('tools-expand') as HTMLButtonElement | null;
    this.otherButton = control('other-tools');
    this.backButton = control('back-to-properties');
    const tablist = this.scope.querySelectorAll<HTMLElement>('[role="tablist"]').find(element => composedContains(this.pane, element));
    if (!tablist) throw new Error('Missing workspace tools tablist.');
    this.tablist = tablist;
    this.panels = Object.fromEntries(tools.map(tool => {
      const panel = control<HTMLElement>(panelIds[tool]);
      if (!composedContains(this.pane, panel) || composedContains(this.tablist, panel)) {
        throw new Error('Workspace tool ' + tool + ' must be a pane region outside the tablist.');
      }
      return [tool, panel];
    })) as Record<WorkspaceTool, HTMLElement>;
    this.tabs = Object.fromEntries(generalTools.map(tool => {
      const tab = control<HTMLButtonElement>('tool-tab-' + tool);
      if (!composedContains(this.tablist, tab)) throw new Error('Workspace tool ' + tool + ' must belong to its tablist.');
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', this.panels[tool].id);
      this.panels[tool].setAttribute('role', 'tabpanel');
      this.panels[tool].setAttribute('aria-labelledby', tab.id);
      return [tool, tab];
    })) as Record<WorkspaceGeneralTool, HTMLButtonElement>;
    this.panels.edit.setAttribute('role', 'region');
    this.panels.edit.setAttribute('aria-labelledby', control('properties-heading').id);
    if (!this.panels.edit.hasAttribute('tabindex')) this.panels.edit.tabIndex = -1;
    this.tablist.setAttribute('aria-orientation', 'horizontal');
    if (!this.tablist.hasAttribute('aria-label') && !this.tablist.hasAttribute('aria-labelledby')) {
      this.tablist.setAttribute('aria-label', 'Writing tools');
    }
    const initial = options.initial;
    const markupTab = generalTools.find(tool => this.tabs[tool].getAttribute('aria-selected') === 'true');
    const tab = initial?.tab ?? 'edit';
    const generalTab = tab === 'edit' ? initial?.generalTab ?? markupTab ?? 'rhythm' : tab;
    const mode = initial?.mode ?? (isViewMode(this.stateHost.dataset.view) ? this.stateHost.dataset.view : 'write');
    const open = initial?.open ?? !this.pane.hidden;
    const expanded = initial?.expanded ?? false;
    const panePlacement = initial?.panePlacement === 'sheet' ? 'sheet' : 'side';
    this.current = { mode, open, expanded, panePlacement, tab, generalTab,
      view: tab === 'edit' ? 'properties' : 'tools', visible: mode === 'write' && open,
      presentation: presentation({ mode, open, expanded, panePlacement }) };
    for (const button of [this.toggleButton, this.hideButton, this.expandButton, this.otherButton, this.backButton]) {
      if (button) button.type = 'button';
    }
    this.otherButton.setAttribute('aria-controls', this.tablist.id);
    this.backButton.setAttribute('aria-controls', this.panels.edit.id);
    this.render();
    const signal = this.abort.signal;
    this.toggleButton.addEventListener('click', () => this.toggle(this.toggleButton), { signal });
    this.hideButton?.addEventListener('click', () => this.hide(), { signal });
    this.otherButton.addEventListener('click', () => {
      if (!this.current.visible || this.current.view !== 'properties' || !canFocus(this.otherButton)) return;
      this.showGeneral();
    }, { signal });
    this.backButton.addEventListener('click', () => {
      if (!this.current.visible || this.current.view !== 'tools' || !this.entryContext.hasPropertiesTarget || !canFocus(this.backButton)) return;
      this.open('edit');
    }, { signal });
    this.expandButton?.addEventListener('click', () => {
      if (!this.current.visible) return;
      if (this.current.presentation === 'sheet') this.returnToScore();
      else this.setExpanded(true);
    }, { signal });
    for (const tool of generalTools) {
      const tab = this.tabs[tool];
      tab.addEventListener('click', () => {
        if (!this.current.visible || this.current.view !== 'tools' || !this.available(tool) || !canFocus(tab)) return;
        this.change({ tab: tool }, 'tab');
        this.focusTab(tool);
      }, { signal });
    }
    this.tablist.addEventListener('keydown', event => this.keydown(event), { signal });
    this.tablist.addEventListener('focusout', event => {
      // Re-entering the widget starts at its active tab, not an unactivated arrow stop.
      if (!event.relatedTarget || !composedContains(this.tablist, event.relatedTarget as Node)) this.rove(this.current.generalTab);
    }, { signal });
  }

  get state(): WorkspaceToolsState { return { ...this.current }; }

  /** Presentation query for the owner's disclosure state; this never captures a musical target. */
  isDestinationVisible(tab: WorkspaceTool, sameContext = true): boolean {
    return !this.disposed && this.current.visible && this.current.tab === tab && sameContext;
  }

  /** More toggles its destination; ordinary open actions retain their focus-only behavior. */
  toggleDestination(tab: WorkspaceTool, options: WorkspaceToolsDestinationToggle): WorkspaceToolsToggleResult {
    const { invoker, focusTarget, sameContext } = options;
    if (this.disposed || this.current.mode !== 'write' || !this.available(tab)
      || !this.validToggleInvoker(invoker)) return 'unavailable';
    if (this.isDestinationVisible(tab, sameContext)) {
      this.rememberInvoker(invoker);
      this.hide(false);
      // More owns this close. Never substitute the score or an older opener,
      // even if layout hooks remove the invoker during the transition.
      if (this.validToggleInvoker(invoker)) invoker.focus({ preventScroll: true });
      return 'closed';
    }
    this.open(tab, focusTarget, invoker);
    return 'opened';
  }

  /** A direct task names its panel and field without entering the general tab sequence. */
  open(tab: WorkspaceTool = this.current.tab, focusTarget?: string | HTMLElement, invoker?: HTMLElement): void {
    if (this.disposed || this.current.mode !== 'write' || !this.available(tab)) return;
    this.rememberInvoker(invoker);
    const changed = this.change({ open: true, tab }, this.current.visible ? 'tab' : 'show', true);
    if (!changed) this.options.onOpen?.();
    const field = typeof focusTarget === 'string'
      ? this.scope.getElementById(focusTarget.replace(/^#/, '')) : focusTarget;
    if (field && composedContains(this.panels[tab], field) && canFocus(field)) {
      field.focus({ preventScroll: true });
      this.revealField(field);
    } else this.focusDestination(tab);
  }

  show(invoker?: HTMLElement): void {
    if (this.entryContext.hasPropertiesTarget && (this.entryContext.entryMode || this.current.tab === 'edit')) {
      this.open('edit', undefined, invoker);
    } else this.showGeneral(undefined, invoker);
  }

  showGeneral(focusTarget?: string | HTMLElement, invoker?: HTMLElement): void {
    const destination = this.available(this.current.generalTab) ? this.current.generalTab : generalTools.find(tool => this.available(tool));
    if (destination) this.open(destination, focusTarget, invoker);
  }

  /** Present the owner's existing context without changing focus, target, drafts or pane layout. */
  setEntryContext(context: WorkspaceToolsEntryContext): void {
    if (this.disposed || this.entryContext.entryMode === context.entryMode && this.entryContext.hasPropertiesTarget === context.hasPropertiesTarget) return;
    this.entryContext = { ...context };
    this.renderNavigation();
  }

  hide(restoreFocus = true): void {
    if (this.disposed || !this.current.open) return;
    const visible = this.current.visible;
    this.change({ open: false }, 'hide');
    if (visible && restoreFocus) this.focusInvoker();
  }

  toggle(invoker?: HTMLElement): void {
    if (this.disposed || this.current.mode !== 'write') return;
    const destination = this.entryContext.entryMode && this.entryContext.hasPropertiesTarget ? 'edit' : this.current.generalTab;
    if (this.current.visible && this.current.tab === destination) this.hide();
    else if (destination === 'edit') this.open('edit', undefined, invoker);
    else this.showGeneral(undefined, invoker);
  }

  setMode(mode: ViewMode): void {
    if (this.disposed || mode === this.current.mode) return;
    const focusedInPane = composedContains(this.pane, activeElement(this.document));
    this.change({ mode }, 'mode');
    if (focusedInPane && !this.current.visible) {
      const viewButton = this.scope.getElementById('view-' + mode);
      if (canFocus(viewButton)) viewButton.focus({ preventScroll: true });
      else (activeElement(this.document) as HTMLElement | null)?.blur();
    }
  }

  setExpanded(expanded: boolean): void {
    if (this.disposed || !this.current.visible || expanded === this.current.expanded) return;
    this.change({ expanded }, expanded ? 'expand' : 'collapse');
  }

  /** More never measures the score column or chooses a smaller writing frame. */
  setPanePlacement(panePlacement: WorkspacePanePlacement): void {
    if (this.disposed || panePlacement !== 'side' && panePlacement !== 'sheet' || panePlacement === this.current.panePlacement) return;
    this.change({ panePlacement }, 'layout');
  }

  returnToScore(): void {
    if (this.disposed || this.current.presentation !== 'sheet') return;
    if (this.current.panePlacement === 'sheet') this.change({ open: false, expanded: false }, 'hide');
    else this.setExpanded(false);
    this.options.onReturnToScore?.();
    const active = activeElement(this.document) as HTMLElement | null;
    if (!this.options.onReturnToScore || active === this.document.body || !canFocus(active)) this.focusInvoker();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
  }

  private change(patch: Partial<Pick<WorkspaceToolsState, 'mode' | 'open' | 'expanded' | 'tab' | 'panePlacement'>>, reason: WorkspaceToolsTransition['reason'], opening = false): boolean {
    if (this.disposed) return false;
    const previous = this.state;
    const proposed = { ...previous, ...patch };
    const next: WorkspaceToolsState = { ...proposed, visible: proposed.open && proposed.mode === 'write', presentation: presentation(proposed),
      view: proposed.tab === 'edit' ? 'properties' : 'tools', generalTab: proposed.tab === 'edit' ? previous.generalTab : proposed.tab };
    if (next.mode === previous.mode && next.open === previous.open && next.expanded === previous.expanded && next.tab === previous.tab
      && next.panePlacement === previous.panePlacement) return false;
    const transition: WorkspaceToolsTransition = { reason, previous, next };
    this.options.beforeChange?.(transition);
    if (reason === 'mode') this.closePopovers();
    if (opening || (next.visible && !previous.visible)) this.options.onOpen?.();
    if (previous.presentation !== 'closed') this.saveScroll(previous.tab, previous.presentation);
    this.current = next;
    this.render();
    if (next.presentation !== 'closed') this.restoreScroll(next.tab, next.presentation);
    this.options.afterChange?.(this.state, transition);
    return true;
  }

  private render(): void {
    const state = this.current;
    this.pane.hidden = !state.visible;
    this.pane.dataset.activeTool = state.tab;
    this.pane.dataset.toolsView = state.view;
    this.pane.dataset.toolsPresentation = state.presentation;
    this.stateHost.dataset.toolsOpen = String(state.visible);
    this.stateHost.dataset.toolsExpanded = String(state.visible && state.expanded);
    this.stateHost.dataset.toolsPresentation = state.presentation;
    this.tablist.hidden = state.view !== 'tools';
    const expandLabel = this.expandButton?.querySelector<HTMLElement>('[data-tools-expand-label]') ?? this.expandButton;
    if (expandLabel) expandLabel.textContent = state.presentation === 'sheet' ? 'Return to score' : 'Expand task';
    if (this.expandButton) {
      if (state.panePlacement === 'sheet') this.expandButton.removeAttribute('aria-pressed');
      else this.expandButton.setAttribute('aria-pressed', String(state.expanded));
    }
    for (const tool of tools) this.panels[tool].hidden = state.tab !== tool;
    for (const tool of generalTools) this.tabs[tool].setAttribute('aria-selected', String(state.generalTab === tool));
    this.rove(state.generalTab);
    this.renderNavigation();
  }

  private renderNavigation(): void {
    const state = this.current;
    const properties = this.entryContext.entryMode && this.entryContext.hasPropertiesTarget;
    const destination = properties ? 'edit' : state.generalTab;
    this.toggleButton.disabled = state.mode !== 'write';
    this.toggleButton.setAttribute('aria-controls', this.pane.id);
    this.toggleButton.setAttribute('aria-expanded', String(state.visible && (properties ? state.view === 'properties' : state.view === 'tools')));
    this.toggleButton.dataset.toolsDestination = destination;
    this.toggleButton.title = `Show or hide ${toolLabels[destination]}`;
    const toggleLabel = this.toggleButton.querySelector<HTMLElement>('[data-tools-toggle-label]') ?? this.toggleButton;
    toggleLabel.textContent = 'More';
    this.otherButton.hidden = state.view !== 'properties';
    this.backButton.hidden = state.view !== 'tools' || !this.entryContext.hasPropertiesTarget;
  }

  private saveScroll(tool: WorkspaceTool, placement: WorkspacePanePlacement): void {
    const panel = this.panels[tool];
    const positions = this.positions.get(tool) ?? {};
    positions[placement] = { panelTop: panel.scrollTop, panelLeft: panel.scrollLeft, paneTop: this.pane.scrollTop, paneLeft: this.pane.scrollLeft };
    this.positions.set(tool, positions);
  }

  private restoreScroll(tool: WorkspaceTool, placement: WorkspacePanePlacement): void {
    const positions = this.positions.get(tool);
    // A new presentation starts near the existing reading position. Later layout
    // clamps must not overwrite the other presentation's saved position.
    const position = positions?.[placement] ?? positions?.[placement === 'side' ? 'sheet' : 'side'];
    const panel = this.panels[tool];
    panel.scrollTop = position?.panelTop ?? 0;
    panel.scrollLeft = position?.panelLeft ?? 0;
    this.pane.scrollTop = position?.paneTop ?? 0;
    this.pane.scrollLeft = position?.paneLeft ?? 0;
  }

  private available(tool: WorkspaceTool): boolean {
    if (tool === 'edit') return !!this.panels.edit;
    const tab = this.tabs[tool];
    return !!tab && !tab.disabled && tab.getAttribute('aria-disabled') !== 'true';
  }

  private rove(tool: WorkspaceGeneralTool): void {
    for (const candidate of generalTools) this.tabs[candidate].tabIndex = candidate === tool ? 0 : -1;
  }

  private focusDestination(tool: WorkspaceTool): void {
    const destination = tool === 'edit' ? this.panels.edit : this.tabs[tool];
    if (!canFocus(destination)) return;
    if (!this.visibleInPane(destination, tool === 'edit')) {
      // Reopening restores the form's reading position, not its offscreen header.
      const invoker = [this.invoker, this.toggleButton].find(candidate => candidate && this.validToggleInvoker(candidate));
      invoker?.focus({ preventScroll: true });
    } else if (tool === 'edit') destination.focus({ preventScroll: true });
    else this.focusTab(tool, false);
  }

  private focusTab(tool: WorkspaceGeneralTool, reveal = true): void {
    if (!this.available(tool) || !canFocus(this.tabs[tool])) return;
    this.rove(tool);
    this.tabs[tool].focus({ preventScroll: true });
    if (reveal) this.revealField(this.tabs[tool]);
  }

  private visibleInPane(element: HTMLElement, isRegion: boolean): boolean {
    const target = element.getBoundingClientRect();
    for (let ancestor = composedParent(element); ancestor && composedContains(this.pane, ancestor); ancestor = composedParent(ancestor)) {
      const container = ancestor as HTMLElement;
      const bounds = container.getBoundingClientRect();
      const top = bounds.top + container.clientTop;
      const left = bounds.left + container.clientLeft;
      // A large region can fill the clip; a tab needs its whole control visible.
      // Skip unmeasured geometry, which provides no evidence of clipping.
      if (target.height > 0 && container.clientHeight > 0 && container.scrollHeight > container.clientHeight) {
        const visibleHeight = Math.min(target.bottom, top + container.clientHeight) - Math.max(target.top, top);
        const requiredHeight = isRegion ? Math.min(target.height, container.clientHeight) : target.height;
        if (visibleHeight + 0.5 < requiredHeight) return false;
      }
      if (target.width > 0 && container.clientWidth > 0 && container.scrollWidth > container.clientWidth) {
        const visibleWidth = Math.min(target.right, left + container.clientWidth) - Math.max(target.left, left);
        const requiredWidth = isRegion ? Math.min(target.width, container.clientWidth) : target.width;
        if (visibleWidth + 0.5 < requiredWidth) return false;
      }
      if (container === this.pane) break;
    }
    return true;
  }

  private rememberInvoker(explicit?: HTMLElement): void {
    const candidate = explicit ?? this.scope.activeElement as HTMLElement | null;
    if (candidate && candidate !== this.document.body && !composedContains(this.pane, candidate) && canFocus(candidate)) this.invoker = candidate;
    else if (!this.invoker) this.invoker = this.toggleButton;
  }

  private validToggleInvoker(invoker: HTMLElement): boolean {
    if (invoker.ownerDocument !== this.document || composedContains(this.pane, invoker) || !canFocus(invoker)
      || invoker.matches('input[type="hidden"]')) return false;
    const tabIndex = invoker.getAttribute('tabindex');
    return invoker.tabIndex >= 0 || tabIndex !== null && /^[+-]?\d+$/.test(tabIndex.trim())
      || invoker.matches('button, a[href], input, select, textarea, summary');
  }

  private revealField(field: HTMLElement): void {
    // Reveal a direct task inside the pane only; scrollIntoView could also move the score.
    for (let ancestor = composedParent(field); ancestor && composedContains(this.pane, ancestor); ancestor = composedParent(ancestor)) {
      const container = ancestor as HTMLElement;
      const bounds = container.getBoundingClientRect();
      const target = field.getBoundingClientRect();
      const top = bounds.top + container.clientTop;
      const left = bounds.left + container.clientLeft;
      if (container.clientHeight > 0 && container.scrollHeight > container.clientHeight) {
        if (target.top < top) container.scrollTop += target.top - top;
        else if (target.bottom > top + container.clientHeight) container.scrollTop += Math.min(target.top - top, target.bottom - top - container.clientHeight);
      }
      if (container.clientWidth > 0 && container.scrollWidth > container.clientWidth) {
        if (target.left < left) container.scrollLeft += target.left - left;
        else if (target.right > left + container.clientWidth) container.scrollLeft += Math.min(target.left - left, target.right - left - container.clientWidth);
      }
      if (container === this.pane) break;
    }
  }

  private focusInvoker(): void {
    const target = [this.invoker, this.toggleButton, this.scope.getElementById('score-editor')].find(canFocus);
    target?.focus({ preventScroll: true });
  }

  private keydown(event: KeyboardEvent): void {
    if (this.disposed || !this.current.visible || this.current.view !== 'tools' || event.defaultPrevented
      || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
    const target = event.composedPath()[0] ?? event.target;
    const focused = generalTools.find(tool => target === this.tabs[tool]);
    if (!focused || !this.available(focused) || !canFocus(this.tabs[focused])) return;
    const available = generalTools.filter(tool => this.available(tool));
    const index = available.indexOf(focused);
    let destination: WorkspaceGeneralTool | undefined;
    if (event.key === 'ArrowRight') destination = available[(index + 1) % available.length];
    else if (event.key === 'ArrowLeft') destination = available[(index + available.length - 1) % available.length];
    else if (event.key === 'Home') destination = available[0];
    else if (event.key === 'End') destination = available[available.length - 1];
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopPropagation();
      this.change({ tab: focused }, 'tab');
      this.focusTab(focused);
      return;
    }
    if (destination) {
      event.preventDefault(); event.stopPropagation();
      this.focusTab(destination);
    }
  }

  private closePopovers(): void {
    if (this.options.closeTransientPopovers) {
      this.options.closeTransientPopovers();
      return;
    }
    for (const popover of this.scope.querySelectorAll<HTMLElement>('[popover]')) {
      if (typeof popover.hidePopover !== 'function') continue;
      try { popover.hidePopover(); } catch { /* Unsupported, disconnected, or closed surfaces need no dismissal. */ }
    }
  }
}
