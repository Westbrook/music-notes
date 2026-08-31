# UI and state architecture

The application uses Lit 3.3.3, signal-polyfill 0.2.2, and signal-utils 0.21.1. Exact runtime versions and the lockfile make upgrades deliberate. Musical HTML, project files, selection identities, and transactional editing retain their existing contracts.

## Ownership

| Layer | Responsibility | Must not own |
| --- | --- | --- |
| `src/model`, `src/dom` | Musical meaning, validation, source grammar | Lit, application state, UI effects |
| `EditorSession`, `state/editor-signals.ts` | Accepted transactions, undo/redo, selection, cached score and project selectors | UI rendering, focus, layout |
| `DraftStore` | Per-form values, original target, conflicts, explicit apply/discard | Accepted music, DOM controls |
| `AuthorViewState` | Ephemeral workspace choices and narrow computed selectors | Music history, element references, measurements |
| `WorkbookState` | Preview choice and print readiness with injected host operations | DOM queries, controls |
| Lit templates and elements | Native presentation, text/attribute bindings, keyed collections | Musical commands, persistence |
| `SignalController` | Subscribe while connected; batch view notifications; dispose on disconnect | State mutation, project policy |
| Application and engraving controllers | Commands, native focus/popovers, geometry, recovery, printing | Duplicated accepted state |

`AuthorWorkspace` is the application coordinator. `bootstrap.ts` starts it and cleans up development reloads; importing `main.ts` does not start the application. Its public `view` signal is observation-only. Workspace actions run through its controls so changing views also handles focus, entry parking, native surfaces, and rendering.

## State contracts

`EditorSession` publishes one signal state after a validated transaction has reconciled source, history, cursor, and selection. `session.signals` provides get-only selectors. Structured values are frozen, and accepted score projections are reused across metadata, draft, cursor, and selection changes. UI code should prefer these cached selectors for presentation:

```ts
const score = session.signals.score.get();
const hasDraft = session.signals.hasPendingSource.get();
session.execute(command); // The mutation boundary remains explicit.
```

The legacy `session.project`, `session.score`, and related snapshot methods keep their defensive-copy and live-source inspection behavior. Command guards still inspect the actual source DOM to reject stale actions. Editing an exposed source node directly is not a signal transaction; use commands or `applySource()` to validate and publish accepted changes.

`DraftStore` uses a `SignalMap` of independently replaced records. `select(form)` returns a cached, frozen form view; `signals.dirtyCount` and `signals.dirtyDrafts` provide aggregate selectors. A change to one form does not invalidate another form's selector. Existing `snapshot()` and resolution methods return defensive mutable copies for compatibility. Dirty drafts retain their original targets through selection changes.

The reusable stores create no global application instances. `AuthorViewState`, `DraftStore`, and `WorkbookState` can run without a DOM. `EditorSession` depends on the musical DOM reader but has no Lit or view dependency.

## Reusing presentation

`music-author-shell` composes shadow components and complete slotted native regions. `mountAuthorShell(root)` performs the first render synchronously so controllers can bind their owned controls; subsequent renders retain them. Features receive view data or an injected model and publish user intent. The application coordinator owns accepted changes and their focus, recovery, and rendering effects.

| Component | Public delivery contract |
| --- | --- |
| `music-workbook-toolbar` | Inject `.model: WorkbookState`. Its `actions` and `links` slots follow the owned preview/print controls; `sourceHref` supplies fallback link content. Local labels, help, status, and unique default IDs share its shadow root. |
| `music-workspace-frame` | Slots `score`, `tools`, and `palette` arrange caller-owned regions. `.mode` and `.toolsPresentation` reflect `mode` and `tools-presentation`; presentation is `closed`, `side`, or `sheet`. The frame adds no scroll owner. |
| `music-panel-frame` | Slots `header`, `body`, and `footer` frame a native region. The assigned body remains its scroll owner; the caller keeps dialog/popover semantics. |
| `music-view-switch` | `.mode` supplies the accepted mode. `view-request` carries `{ mode }`; the coordinator performs the transition before publishing the new mode. |
| `music-source-editor` | `renderState({ documentId, value, status, readOnly })` supplies the view. `source-change` and `source-apply` carry `{ value }`; `source-revert` requests discard. Native fields, labels, descriptions, and feedback share its shadow root. |
| `music-event-navigator` | `.state` supplies the measure, active voice, selected IDs, and optional marking ID. `navigate-request` carries a source ID and modifier keys. Keyed native buttons retain identity and repair focus when an item disappears. `renderState(state, fallbackFocus)` supports synchronous coordinator updates. |
| `music-score-viewport` | Stable `.scoreMount`, `.overlayMount`, and `.previewMount` separate accepted projection, selection decoration, and gesture previews. `actions` and `help` slots keep caller-owned controls outside the musical source. |

Source updates preserve a focused local draft unless `renderState(state, { forceValue: true })` explicitly replaces it. Use `inputValue`, `focusInput()`, `fail()`, `clearFailure()`, and `refreshFailure()` for integration instead of querying its textarea or alert. Validation and persistence remain application responsibilities; its outer `.popover-body` still owns scrolling and dismissal. View, Source, and navigator intent events bubble and are composed.

The top-level shell, Properties and its shared selection choosers, authored musical children, and physical page output retain their existing logical trees. Complete light-DOM regions supplied through slots preserve native labels, descriptions, popover targets, and form relationships. The complete Author coordinator still supports **one workspace per document** because it owns document view/print state and the composition's IDs. Feature components, scoped controllers, and state stores can be reused independently. See the [shadow DOM and slot plan](shadow-dom-plan.md) for boundary decisions and acceptance gates.

Inject a `WorkbookState` into an independent toolbar, or use `createWorkbookState()` to connect it to authored score roots:

```ts
import './src/demo/workbook-toolbar.js';
import { createWorkbookState } from './src/demo/workbook-controls.js';

const toolbar = document.createElement('music-workbook-toolbar');
toolbar.printWidth = 680;
toolbar.model = createWorkbookState({
  root: document,
  requestPrint: () => window.print(),
});
document.body.prepend(toolbar);
// On teardown, dispose the model and remove the toolbar.
```

`SignalController` connects a stable selector to Lit. It uses signal-utils `reaction`, which coalesces synchronous writes on the microtask queue; Lit then batches its own update. Disconnect cancels pending notifications and releases the watcher. Reconnect reads current state. Call `refresh()` when replacing a dependency that is not itself a signal, such as an injected store.

```ts
private readonly view = new SignalController(this, () => this.model.view.get());
protected render() { return html`<output>${this.view.value.status}</output>`; }
```

The controller tracks only the selector function, not arbitrary signal reads elsewhere in `render()`. Return a cached computed view or a narrow primitive selector, and keep mutation in event handlers.

## DOM and accessibility boundaries

`ControlScope` binds controllers to an explicit `Document`, `ShadowRoot`, or `HTMLElement`. `register(root)` adds an owned root and returns an idempotent release function; release registrations during teardown. Queries inspect only those roots and ordinary descendants without discovering shadow roots. Author registers the view switch, navigator, and Source editor while leaving the musical source tree outside its control scope. ID lookup uses native tree indexes where available, with a scoped fallback for duplicate IDs.

Focus and geometry use the composed-tree helpers in `src/ui/composed-dom.ts`, following assigned slots and shadow hosts to find actual focused controls, scroll owners, and clipping ancestors. Native label, form, fieldset, and ID-reference relationships still follow their platform DOM rules. `ControlScope.activeElement` preserves focus handed elsewhere; use a separate ownership check before restoring or redirecting it. Native surfaces have explicit registration and cleanup, while browser-wide native Escape precedence remains separate from control discovery.

`MusicSurface.getRenderedProjection()` returns a current `{ surface, renderRevision, layout, frames }` snapshot; each frame associates a measured system with its SVG and optional scrolling row. Check `isProjectionCurrent(snapshot)` before using retained frames, and read fresh bounds/CTMs after scrolling. SVG references are measurement-only. Missing, invalidated, or detached projections return `undefined`.

`MusicSurface.diagnosticsPresentation` is `all` by default; Author uses `errors` and delivers routine notices through Review. Errors and the accessible transcript remain available. `getNativeControlBounds()` supplies current client-coordinate regions that decoration must avoid. Both the surface and score viewport emit bubbling, composed `notation-viewport-change` events with `{ scroller, layout }`, preserving the actual scroll owner across retargeting. The viewport's bounds API also covers its assigned actions/help regions.

- Source-only musical elements keep synchronous attribute reflection. Only outer score roots allocate full presentation and engraving mounts; nested staves and measures remain source data.
- Lit owns score loading, diagnostics, transcripts, Author templates, native option/checkbox collections, event navigation, and page furniture. The engraving adapter owns its stable SVG mounts, geometry, and render-completion promises.
- Native buttons, selects, checkboxes, dialogs, details, and popovers keep browser keyboard and focus behavior. Authored select defaults initialize the native value as well as reset attributes. Repeated template renders preserve user edits.
- Keyed lists reuse surviving options, events, annotations, markings, and checkboxes. Navigation repairs focus when a focused item disappears; normal label or selection updates do not refocus controls.
- Text bindings escape source labels, project metadata, and diagnostic prose. Do not introduce `unsafeHTML` for user content or render generated SVG back into the editable source tree.
- Printing reuses measured complete SVG systems. Draft stamps and publication checks update synchronously before the print request. UI scheduling never creates an asynchronous gap between final validation and printing.

Every dynamic container has one rendering owner. Controllers may modify explicitly unbound properties or the contents of designated empty mounts; they must not replace a Lit-owned range with `textContent` or `replaceChildren`. `setPagePreflightMessage()` exists for transient preflight feedback through the same owner.

## Icons and control content

**Phosphor Fill** action icons and **Bravura** music glyphs are synchronous SVG definitions. Import named exports from `src/ui/icons/phosphor.ts` or `src/ui/icons/bravura.ts`; each contains only its name, view box, and paths. There is no runtime catalog, dynamic import, network request, font loading, or measurement step. Unused definitions can be removed by the bundler. The Phosphor 2.1.1 source and MIT license are recorded in the third-party notices. Bravura paths are extracted offline from the exact Bravura 1.392 font bundled with VexFlow 5.0.0, with provenance and a reproducible generator in `scripts/generate-bravura-icons.py`. Score engraving continues to use VexFlow and its font.

`music-button-content` supplies presentation inside a native button or link. Its `icon` property receives an `IconDefinition` object; `layout` is a reflected attribute. SVG paths are delivered in the component's normal Lit render, without a second loading or readiness cycle. Labels stay in its light-DOM slot. The default layout places the icon above a smaller label. `inline` and `icon-only` use the same component, with `icon-only` visually hiding the label while retaining its accessible name. The surrounding native control owns disabled state, focus, events, forms, popovers, and optional tooltip text. `music-icon` offers the same definition property for standalone decorative artwork.

```ts
import { html } from 'lit';
import { buttonContent } from '../ui/button-content.js';
import { phArrowUUpLeft, phPrinter } from '../ui/icons/phosphor.js';

html`<button type="button">${buttonContent(phArrowUUpLeft, 'Undo')}</button>`;
html`<button type="button">${buttonContent(phPrinter, 'Print', { layout: 'inline' })}</button>`;
html`<button type="button" title="Undo">${buttonContent(phArrowUUpLeft, 'Undo', { layout: 'icon-only' })}</button>`;
```

Use `--music-icon-size`, `--music-button-label-size`, `--music-button-gap`, and `--music-button-inline-gap` for local sizing. `--music-icon-opacity` defaults to **0.8**, applied once to the SVG; labels retain full opacity. The icon/label parts expose further styling without replacing the native control. Colors inherit from their control, including disabled, selected, and forced-color states. Bravura outlines are centered by their ink bounds during generation, with a scale cap so a staccato dot does not become an oversized circle. Whole/half rest icons include a ledger line to retain their meaning outside a stave.

The small `notation-icons.ts` helpers map durations, rests, accidentals, clefs, event kinds, and markings to named icons. Controls publish their current icon alongside accepted selection or entry-recipe labels, so editing, undo, and redo cannot leave an old value pictured. Commands and score state remain outside the components.

The Write view uses `ph:note-pencil`, music entry uses `ph:music-notes-plus`, and the part selector uses `ph:stack-simple`. Generic contextual Edit retains `ph:pencil-simple`, with the actual Bravura glyph taking precedence for attached musical marks; Pages retains `ph:files`.

Controllers that change a button label use a literal, unbound `<span data-control-label>Initial label</span>` inside `buttonContent()`, then call `setControlLabel(button, text)`. `setControlIcon(button, icon)` updates the component property. Do not replace the whole button's `textContent`, or mutate a Lit-bound label range.

Native notation options retain their exact text and submitted values. Inside a `<select>`, insert complete `nativeOptionTemplate({ value, label, icon })` expressions, so Lit binds each option before native `selectedcontent` cloning. Do not place nested template expressions inside literal static options: Chromium can clone their unfinished Lit markers and detach their parts. For changing collections, `renderNativeOptions()` accepts `NativeOption.icon` and reuses keyed native options. Inline SVG paths survive native cloning without custom-element properties or font readiness. Rich options have explicit accessible names; the ordinary-select fallback still displays the original text. Native controls retain their keyboard and form behavior.

For a static select with an explicit default, place `nativeSelectDefault(value)` after its options and keep `selected: true` on the default option. The directive sets the initial native value once, after the options exist. Later renders preserve user changes, and the selected attribute retains native form reset behavior.

The icon option browser fixture also compares reset behavior against a native DOM baseline without Lit. Chromium 151 resets the selected value correctly but leaves `selectedcontent` showing the previous option in both cases. The fixture reports this browser limitation separately; it does not qualify reset cloning as passing or add a custom reset implementation.

## Delivery and performance

Vite builds separate workbook and Author entry points, a cached UI runtime chunk, an Author template chunk, and separate stable notation fonts. Explicit manual chunk assignment prevents Author templates from being pulled into the workbook through shared model dependencies. The manifest records the actual graph.

```sh
npm test
npm run typecheck
npm run check:icons
npm run build
npm run check:bundle
```

`check:bundle` totals emitted HTML, synchronous JavaScript imports, CSS, and referenced assets using per-file gzip sizes. It fails above 50 kB for the initial workbook or 630 kB for initial Author delivery, and rejects any Author chunk in the workbook's complete graph, including dynamic imports. Lazy engraving is excluded from the initial workbook figure; fonts already imported by Author are included. HTTP overhead, cache state, and browser execution time are separate measurements.

`check:icons` builds a standalone button from each icon family with Vite and checks the emitted output: exactly the requested definition remains, with one synchronous chunk, no dynamic imports, and no engraving or font dependencies. Lit is external to these small fixture bundles. This verifies tree shaking against the production bundler rather than relying only on source conventions.

The measured initial delivery is about **49.6 kB gzip for the workbook** and **625.6 kB for Author**, within the **50 kB / 630 kB** budgets, compared with **48.3 kB** and **606.5 kB** before icon controls. Phosphor definitions live in individual modules behind a named-export barrel, so the workbook loads only its two icons. Bravura retains original outline coordinates with static optical view boxes and lossless SVG command compression. Cached score selectors, indexed control lookup, keyed DOM updates, lazy nested-surface presentation, and disconnected subscriptions remove avoidable interaction and lifecycle work without changing engraving policy.

For a repeatable comparison, build another checkout with `vite build --manifest`, then run `node scripts/check-bundle.mjs /absolute/path/to/that/dist`.

Unit coverage includes atomic signal publication, independent stores, stale-source guards, immutable/cached projections, form conflicts, connection/reconnection, focused node identity, defaults, and safe text. Browser fixtures exercise actual fonts and SVG, native selects/popovers, writing and selection, responsive widths, parts, and physical pages. Run the browser pages listed in the README; a print-request check does not validate a saved PDF or physical paper output.

Open `/tests/shadow-dom-browser.html` and select **Run shadow component checks** for component state isolation, slots and fallback content, native labels/descriptions and form behavior, composed focus, scrolling/popover placement, Source return focus, and score-ID isolation. These checks report DOM/native-API behavior; they do not establish screen-reader, trusted keyboard/touch, or physical-print qualification.

API references: [Lit templates](https://lit.dev/docs/templates/overview/), [Lit reactive controllers](https://lit.dev/docs/composition/controllers/), [signal-polyfill](https://github.com/proposal-signals/signal-polyfill), and [signal-utils](https://github.com/proposal-signals/signal-utils).

## Initial Lit migration verification — 2026-08-31

- `npm test`: 100 files, 3,999 passing tests (baseline: 90 files, 3,908 tests).
- TypeScript checking, production build, bundle budgets, and entry-point separation pass.
- Browser suites: foundation 35/35, notation expansion 10/10, three roads 7/7, event markings 8/8, Author 23/23, workspace journeys 21/21.
- Author checks inspect 31 isolated workspaces, 62 native selects, 12 physical pages, and 36 complete systems. The foundation checks include 40 notation matrix cases and 4,342 visible-ink bounds checks across 383 rendered systems.
- Optimized production entry points open without console warnings/errors. Keyboard insertion and Undo/Redo were also exercised through browser controls. Desktop and narrow presentation were visually inspected.

These are Chromium/local-browser results. Other browser engines, screen-reader combinations, physical printing, and saved PDF output were not newly qualified by this migration.


## Shadow component verification — 2026-08-31

- `npm test -- --maxWorkers=4 --reporter=dot`: **110 files, 4,158 passing tests**. The prior Lit migration had 3,999 tests.
- TypeScript checking, production build, bundle budgets, and workbook/Author dependency separation pass.
- Browser suites: foundation **35/35**, notation expansion **10/10**, three roads **7/7**, event markings **8/8**, Author **23/23**, workspace journeys **21/21**, shadow components **9/9** — **113 passing browser checks** in total.
- Shadow checks cover caller-owned slots, independent component models, native form/reset/disabled/inert behavior, labels/descriptions, composed intent events, focus/reveal, private scroll notifications, source-ID isolation, and Source popover return focus.
- Workspace journeys retain the short-screen notation budget and 44px view controls. Obsolete document padding was removed because it overrode the frame's slotted styles.
- Reconstruction tests retain stable score mounts while resetting Source feedback, focused drafts, views, print guards and expanded Tools accessibility state. Disposed actions and deferred persistence cannot overwrite a replacement workspace's UI.
- Optimized workbook and Author entry points open without console warnings/errors; mode transitions and the Source component were exercised in the production build. Desktop Source and narrow workbook layouts were visually inspected.

Initial delivery before this shadow migration was **47.0 / 599.3 kB gzip** (workbook / Author); it is now **48.3 / 606.5 kB**, under the unchanged **50 / 630 kB** budgets. Native indexed control lookup reduced the same isolated 32-note/32-Undo unit fixture from about 10.02 s to 2.62 s compared with the first scoped-selector implementation. That fixture timing is an implementation comparison, not a browser latency benchmark.

These are Chromium/local-browser checks. Screen-reader combinations, other browser engines, trusted touch/software-keyboard workflows, saved PDFs, and physical printing remain separate qualification work.

## Icon control verification — 2026-08-31

- `npm test -- --maxWorkers=4 --reporter=dot`: **113 files, 4,176 passing tests**.
- TypeScript, production build, bundle budgets, and `check:icons` pass. Initial delivery is **49.6 / 625.2 kB gzip** (workbook / Author). The initial workbook contains only its `ph:code` and `ph:printer` definitions.
- The offline Bravura generator verifies source provenance and exact contour/control-point equivalence for all **59 glyphs**, including projected optical bounds.
- Browser suites: Author **23/23**, workspace journeys **21/21**, shadow components **9/9**. Icon option checks pass for synchronous artwork, native label/value preservation, keyed updates, initial defaults, and user edits. Native reset-cloning behavior is separately recorded against the browser-only baseline described above.
- Real controls report SVG opacity **0.8** and label opacity **1**. The 390px phone fixture retains **44px controls**, a **101px palette**, and **451px usable score height** in its score view. The expanded tool layout was visually inspected.
- Both optimized production entry points render their Phosphor/Bravura control paths; Author starts with the correct quarter-note recipe. Bravura control artwork has no runtime font dependency.
- Long workspace tests now release Lit render ranges during fixture cleanup before unlinking their DOM. This removes test-spy retention without changing production teardown, assertions, or heap limits.
