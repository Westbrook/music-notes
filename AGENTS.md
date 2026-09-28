# Music Notes agent instructions

Music Notes renders readable musical HTML as SVG and provides a separate Author
workspace. This is a source project, not a published npm package.

## Setup and checks

Use npm and Node 22.12 or newer on a supported even-numbered release. Install
with `npm install`; start Vite with `npm run dev`. `/index.html` is the notation
workbook and `/author.html` is Author.

For implementation changes, run the relevant tests and checks. The full sequence is:

```sh
npm test
npm run typecheck
npm run check:icons
npm run build
npm run check:bundle
```

`check:bundle` reads the production output, so run it after a successful fresh
build. Browser fixtures are separate from `npm test`; see [README verification](README.md#verify)
for the relevant fixture and Playwright commands. Use the pinned Playwright
package and its matching browsers with isolated recovery data. Documentation-only
changes need link and content checks, not a full application test run.

## Core contracts

- Authored musical DOM is the editable source of truth. Models, SVG, playback,
  and page previews are projections. Preserve source identities and serialization.
- Keep `src/model` independent of browsers, UI state, and VexFlow. Use exact
  rational arithmetic for musical timing; keep engine-specific behavior in the
  engraving adapter. The workbook must not load the Author application.
- Preserve explicit pitch spelling, written rhythm, and tuplet ratios. Do not
  invent pitches for rhythm/three-roads notation, silently fill drafts, drop
  unsupported constructs, or present invalid music as successfully engraved.
- Stage Author edits, validate the complete score, and commit one reversible
  transaction. Reject stale actions; preserve unapplied drafts and their original
  targets. Keep selection edits independent of the next-entry recipe. Previews
  and no-ops must not add musical history.
- Preserve native control semantics, accessible labels, keyboard/focus behavior,
  and unsupported-browser fallbacks. Reuse shared UI tokens and components.
  Keep accepted music, form drafts, and workspace state under their existing
  owners; never replace a Lit-owned DOM range from a controller.
- Verify behavior at the affected layer. Real SVG/font geometry needs browser
  checks; synthetic events do not establish native touch or assistive-technology
  behavior. Intercepting `window.print()` proves only that printing was requested.

## Read for the task

- [Development contracts](docs/development.md): rendering, measurement, lifecycle,
  editing, and printing changes; detailed rules migrated from `.augment-guidelines`.
- [Authoring grammar](docs/authoring.md): DOM/API, parsing, serialization, or musical
  semantics. Consult [three-roads](docs/three-roads.md) and
  [event markings](docs/event-markings.md) when those constructs are affected.
- [UI/state architecture](docs/ui-state-architecture.md): UI ownership, signals,
  native controls, icons, and presentation changes. Also consult `DESIGN.md`
  when present in the checkout for shared tokens and control styling.
- [Author workspace](docs/author-workspace.md): user-facing editing, recovery,
  playback, and page workflows.
- [Design review](docs/design-review.md) and [notation expansion](docs/notation-expansion.md):
  engraving acceptance criteria and verification limits.

Keep the applicable docs accurate when behavior changes. Read the sections
relevant to the task; this list is not a mandatory full-repository reading pass.
