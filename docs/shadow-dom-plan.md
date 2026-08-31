# Shadow DOM and slot boundaries

Implemented 2026-08-31. This records the delivered boundaries and the conditions for moving additional features. See [UI and state architecture](ui-state-architecture.md) for store ownership and current verification results.

## Delivered boundaries

| Component | Shadow ownership | Caller-owned content / actions |
| --- | --- | --- |
| `music-workbook-toolbar` | Preview checkbox, print action, help, status, local styles | `actions` and `links` slots; injected `WorkbookState`; fallback links remain available |
| `music-view-switch` | Native Write / Read / Pages buttons and their pressed state | `.mode` input; typed, bubbling, composed `view-request` intent |
| `music-workspace-frame` | Grid layout, measured paper width, side/sheet presentation | `score`, `tools`, and `palette` slots containing complete native regions |
| `music-panel-frame` | Header/body/footer framing | Named slots; the existing supplied body retains scrolling |
| `music-source-editor` | Native Source field, label, descriptions, validation feedback, Apply/Revert | `renderState()` input and `source-change`, `source-apply`, `source-revert` intents |
| `music-event-navigator` | Named navigation region and keyed event/marking buttons | `.state` / synchronous `renderState()`; `navigate-request` with source identity and modifiers |
| `music-score-viewport` | Isolated imported score and separate selection/gesture mounts | `actions` and `help` slots; explicit mount and geometry integration |
| `MusicSurface` | Existing notation drawing, diagnostics and transcript | Public current-projection snapshots, freshness checks, native-control bounds and scroll notification |

Every component uses an open root. Properties and action events carry state and intent; slots carry DOM; CSS custom properties and intentional parts provide visual customization. Signals stores remain independent of these presentation boundaries. The workspace applies view transitions, including entry parking, focus, native surfaces and rendering, before publishing the accepted mode.

## Slots preserve native content ownership

Slotted elements keep their logical DOM parent and tree. A shadow component can arrange them without cloning controls, replacing their identity, or breaking existing same-tree native references. [Lit slot composition](https://lit.dev/docs/components/shadow-dom/#rendering-children-with-slots)

The workbench supplies complete native regions:

```html
<music-workspace-frame mode="write" tools-presentation="closed">
  <section slot="score" aria-label="Music score editor">
    <!-- Existing score scroll owner, viewport and keyboard help -->
  </section>
  <aside slot="tools" aria-label="Writing tools">
    <!-- Complete native tablist, panels, labels and controls -->
  </aside>
  <section slot="palette" aria-label="Music palette">
    <!-- Existing native action groups -->
  </section>
</music-workspace-frame>
```

The frame host itself is the grid. Its slots use `display: contents`; there is no additional shadow scrolling container. `mode` and `tools-presentation` attributes select layout synchronously, and the existing measured-width custom properties remain on the host. Persistent supplied nodes retain drafts, disclosure state, focus and selection across view and pane changes.

Source retains its native outer popover and header naming, with the complete editor inside the supplied body:

```html
<section id="source-panel" popover="auto" aria-labelledby="source-heading">
  <music-panel-frame>
    <div slot="header">
      <h2 id="source-heading">Musical HTML</h2>
      <button type="button" popovertarget="source-panel"
        popovertargetaction="hide">Close</button>
    </div>
    <div slot="body" class="source-content popover-body">
      <music-source-editor id="source-editor"></music-source-editor>
    </div>
  </music-panel-frame>
</section>
```

The Source editor owns all of its label, textarea, description, error and action relationships in one root. Its feedback reveals errors through the outside `.popover-body` using composed ancestry, without scrolling the notation. Focused native drafts retain their value, selection and scroll during ordinary state refresh. Explicit replacement and Revert use `forceValue`.

The reusable panel's optional `footer` slot remains available. The workbook similarly provides additive action/link slots after its required controls; caller listeners and node identities are preserved. These controls remain a native group, without introducing ARIA toolbar arrow-key behavior.

Render assigned content through slots rather than cloning or mirroring it into a second store. `slotchange` observes assignment changes, not arbitrary edits within assigned subtrees. [Slot change behavior](https://developer.mozilla.org/en-US/docs/Web/API/HTMLSlotElement/slotchange_event)

## Scoped control and browser ownership

[`ControlScope`](../src/authoring/control-scope.ts) searches a base tree and explicitly registered UI roots. Author registers the view switch, navigator and Source roots. The musical viewport's private source is never registered, so imported musical IDs cannot become application controls.

Element scopes use the native tree's indexed ID lookup when it resolves inside the owner, with a literal scoped-selector fallback for duplicate IDs owned elsewhere. Shadow roots use their own ID index. No persistent ID cache or recursive discovery of arbitrary component roots is needed. Registrations return idempotent cleanup functions.

Form controllers, selection controls, entry pitch, native surfaces and workspace tools accept `ControlRoot`. They keep document services separate from scoped control lookup. Deep focused-element inspection preserves explicit handoffs to another component; ownership is checked separately with the scope or composed containment.

[`composed-dom.ts`](../src/ui/composed-dom.ts) follows assigned slots, logical parents and shadow hosts for presentation-related ancestry. Focus reveal, clipping, popover positioning and viewport anchors use that policy, including suppressed or unassigned content. Native label, form and disabled-fieldset semantics retain their logical-tree rules. A shadow label wrapping a slot does not become the native label of a light-DOM input. [HTML labels](https://html.spec.whatwg.org/multipage/forms.html#the-label-element), [form ownership](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#association-of-controls-and-forms)

`NativeSurfaces` supports explicit panel registration, cleanup and queries for owned open surfaces. Native state is authoritative even before delayed toggle notifications update application metadata. The workspace separately preserves browser-wide Escape precedence for a native surface outside its control scope.

Complete native selects retain their button/selectedcontent/options structure. The new Source and workbook components use action contracts and do not promise outer-form participation. Slotted native inputs retain their native form relationship. A future custom form field should deliberately implement form association, including reset, disabled state, value and validation.

Element-reference ARIA properties have their own scope rules; they are not a universal repair for native associations split across roots. Prefer local relationships and qualify any cross-root accessibility adapter in supported browsers and assistive technologies. [Reflected element references](https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model/Reflected_attributes#reflected_element_references)

## Score integration and printing

[`ScoreViewport`](../src/authoring/ui/score-viewport.ts) replaces the hand-built Author shadow tree. It exposes stable `scoreMount`, `overlayMount`, and `previewMount` references with separate rendering owners. Clearing selection decorations cannot delete gesture previews. Decorative mounts remain pointer-inert and hidden from accessibility; caller actions/help are siblings outside them.

`MusicSurface.getRenderedProjection()` supplies the current surface, render revision, layout identity and complete system/SVG associations. `isProjectionCurrent(snapshot)` verifies freshness; consumers read actual SVG transforms when measuring. Source/options changes, refresh, reconnect, errors and missing SVG revoke obsolete geometry. The existing fixed print projection can still survive viewport-only resize.

Author's selection, pointer, viewport-anchor and HUD controllers no longer query private notation selectors or inject styles. `getNativeControlBounds()` supplies protected presentation bounds. Bubbling, composed `notation-viewport-change` events carry the actual scroller. `diagnosticsPresentation = 'errors'` suppresses duplicate warning presentation without reengraving, changing the diagnostic data, hiding errors or removing the transcript.

The musical source grammar stays in light DOM relative to its musical root. The hidden default slot on `MusicSurface` suppresses the source's visual presentation; it is not an application extension slot. UI controls and `slot` attributes must not enter serialized musical source.

Physical pages retain their current direct sheet structure, document staging, print CSS and synchronous final preflight-to-print contract. The screen components explicitly hide in print media. A future shadow page presenter would need to migrate measurement, styles and completion together.

## Retained and future boundaries

- **Properties and shared selection controls:** remain complete native light-DOM regions supplied through the workbench. Properties' Spelling invoker and the palette share the same native pitch chooser. Inspector drafts also span multiple tool regions. Move this feature only after it owns its fields/actions and has a deliberate chooser contract; simply moving its template would split those relationships.
- **Review and document surfaces:** retain native outer popovers and their shared trigger/description relationships. The panel frame is available for additional composition without changing those references.
- **Top-level Author:** remains a light-DOM composer. Browser-level state and native workspace IDs still support one complete workspace per document; scoped controllers do not claim full multi-workspace embedding.
- **Public score slot:** deferred. Keep imported source inside the viewport's ID boundary. A future embedding API may slot a wrapper around one complete musical root; it should not distribute individual notes or staves.
- **MusicSurface style sharing:** its existing presentation style remains. Adopted stylesheet extraction is a separate measured optimization rather than a reason to change source-element lifecycle.

## Styling, performance and verification

Components own small static styles, consume inherited tokens and expose specific parts. `::slotted()` styles directly assigned elements; nested caller content keeps its stylesheet. Component styles include local focus treatment, forced-colors rules and applicable responsive/print behavior. [Lit component styles](https://lit.dev/docs/components/styles/)

Shadow DOM provides encapsulation, not an automatic speed improvement. Keep keyed updates, connected-only subscriptions, stable engraving mounts and current-geometry guards. Slot assignment alone does not author music or trigger engraving. Bundle budgets and entry separation remain enforced; measure actual interaction behavior when changing boundaries.

The focused [browser suite](../tests/shadow-dom-browser.html) covers slot assignment/fallback, instance isolation, form/reset/disabled/inert semantics, native labels and descriptions, focus, composed action events, nested slot scrolling, geometry ownership and Source popover return focus. Existing notation and Author suites cover engraving, editing, native selects, pane transitions, source drafts, responsive layouts, physical page composition and print request boundaries.

Browser regression results qualify the tested engine and scripted interactions. They do not establish screen-reader combinations, native touch/software-keyboard behavior, saved PDFs or physical printing. See [current verification](ui-state-architecture.md) for the recorded commands, counts, budgets and remaining qualification limits.
