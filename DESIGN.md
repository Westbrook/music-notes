# Design system

Music Notes uses a small shared foundation for application controls. The executable
defaults live in [src/ui/design-tokens.css](src/ui/design-tokens.css). This guide
records the visual relationships those tokens support and how to extend them.
The first shared family is choice groups; other application surfaces are being
aligned incrementally.

## Principles

- **Keep the score primary.** Controls use calm surfaces and restrained borders;
  musical content, writing feedback, and selection remain easy to find.
- **Make related choices look related.** Reuse geometry, icon and label alignment,
  and state cues across workspace modes, views, and musical choices. Express
  priority through placement and border contrast.
- **Keep interaction stable.** Selection changes preserve control dimensions,
  label weight, focus, and the position of nearby controls. Responsive layouts
  recover available choices when space grows.
- **Use native semantics.** Native buttons, selects, popovers, and disclosures own
  interaction. Presentation components supply artwork and layout; accepted music
  and workspace transitions remain with their existing controllers.

## Shared tokens

Use the `--music-ui-*` prefix for values shared across application and component
boundaries. Names describe a role, such as `color-active` or `control-size`, so a
theme can change the value without changing its consumers. Keep a value local
when it belongs to one layout or one musical meaning.

### Colors

| Token suffix (`--music-ui-…`) | Default | Purpose |
| --- | --- | --- |
| `color-paper` | `#fff` | Light choice-group surface |
| `color-surface` | `#f7f8fa` | Surrounding control and picker surfaces |
| `color-ink` | `#303942` | Control text and icons |
| `color-muted` | `#56616d` | Supporting text |
| `color-border` | `#798794` | Emphasized control and selected-choice borders |
| `color-divider` | `#c8cfd6` | Quiet group outlines and separators |
| `color-active` | `#dce3ea` | Selected and hover fill |
| `color-focus` | `#7037a0` | Keyboard focus indicator |

Author keeps its score-specific selection, insertion, warning, and error colors
under `--author-*`. Reuse shared UI tokens for common controls and preserve those
semantic colors for their respective feedback. Existing Author aliases bridge
the shared defaults into its page styles.

### Geometry and typography

| Token suffix (`--music-ui-…`) | Default | Purpose |
| --- | --- | --- |
| `control-size` | `max(44px, 2.75rem)` | Minimum choice target and compact control height |
| `icon-size` | `1.25rem` | Shared icon box |
| `label-size` | `0.72rem` | Stacked control caption |
| `label-line-height` | `1.15` | Compact caption line height |
| `control-weight` | `550` | Control label weight in every state |
| `control-padding-block` | `3px` | Compact vertical padding |
| `control-padding-inline` | `6px` | Compact horizontal padding |
| `control-radius` | `6px` | Individual choice corners |
| `group-radius` | `8px` | Choice-group corners |
| `content-gap` | `2px` | Stacked icon-to-label gap |
| `group-gap` | `2px` | Gap between choices in one group |
| `group-padding` | `2px` | Inset between choices and their group outline |
| `group-spacing` | `6px` | Separation between neighboring groups |
| `border-width` | `1px` | Control borders and inset group outlines |
| `focus-width` | `3px` | Visible keyboard focus outline |
| `disabled-opacity` | `0.5` | Disabled control presentation |

Controls inherit the surrounding system sans-serif font. Keep the same font,
weight, padding, border width, and icon box when a choice becomes active. A border
can change color without changing its space. Longer labels may make a button
wider, and dense or multiline choosers may need greater height.

The control-size formula retains a 44px minimum and grows with the root font size.
Use rem-based icon and caption sizes so enlarged text remains useful. Let the
layout wrap or pack choices into overflow as targets grow.

## Applying and overriding tokens

Author loads the declaration-only sheet before its page styles in `author.html`:

```html
<link rel="stylesheet" href="/src/ui/design-tokens.css">
<link rel="stylesheet" href="/src/authoring/author.css">
```

Other entry points can use a CSS `@import` at the start of their main stylesheet.
Choose one page loading route to avoid duplicate emitted token CSS. Place scoped
overrides in the page or region's styles:

```css
.large-controls {
  --music-ui-control-size: max(48px, 3rem);
}
```

The defaults use `:where(:root)` so ordinary page or theme selectors can override
them. Scope an override to the document, a region, or a custom-element host.
Custom properties inherit through shadow roots; shadow styles consume the same
values as page styles. Keep shared defaults at the document boundary to preserve
that inheritance. Shared component modules, including `music-button-content`,
`music-icon`, and `music-toggle-button-group`, import `./design-tokens.css` so
standalone delivery includes the defaults too. The token sheet supplies values;
page and shadow styles own their selectors.

Existing component hooks take precedence where they are consumed:

| Hook | Local adjustment |
| --- | --- |
| `--music-toggle-button-size`, `--music-toggle-label-size` | Toggle target and caption size |
| `--music-toggle-gap`, `--music-toggle-background`, `--music-toggle-border` | Toggle group's spacing and surface |
| `--music-button-label-size`, `--music-button-gap` | `music-button-content` caption and stacked gap |
| `--music-button-inline-gap` | Gap for its inline layout |
| `--music-icon-size`, `--music-icon-opacity` | Icon box and artwork opacity |

Use a component hook for one deliberate exception and a shared token to align a
region. A component hook overrides its corresponding shared token; scoped shared
tokens override the document defaults. Icon opacity retains its existing `0.8` default;
labels stay fully opaque. See [icon and control APIs](docs/ui-state-architecture.md#icons-and-control-content)
for the supported stacked, inline, and icon-only presentations.

## Choice-group family

Use a light container with a subtle inset outline, a small shared padding, and
individually rounded choices. The padding keeps buttons clear of their container
without reducing their minimum target size. An active choice has a tinted fill
and a visible border. Workspace mode
and view choices may use the stronger border color to signal their priority.
Their icon/label geometry and selection language stay consistent with musical
groups. Maintain a visible gap between separate groups.

| Location | Choices and layout |
| --- | --- |
| `#workspace-mode-slot` | Write notes / Select; both remain directly available |
| `music-view-switch` | Write / Read / Pages; stable top-level navigation |
| `music-toggle-button-group` | Responsive musical choices with native overflow |
| `.selection-shortcuts` | Direct accidentals and road directions for selected music |
| `#entry-kind` | Note / Rest before Accidentals in the quick entry palette |
| `.entry-direction-choices` | Relative pitch direction within the writing chooser |
| `.accidental-choices`, `#selection-chooser-accidentals` | Full accidental choices; retain readable grid layouts |

Sharing this family preserves each control's behavior and state contract.
Buttons expose `aria-pressed`; existing radio choices expose `aria-checked`.
The toggle group requires one selection by default. Dots and Attack configure a
neutral `toggle-off-value`, allowing the selected choice to clear on repetition.

Group borders fit the visible controls plus the shared padding. Include both
insets when measuring overflow; reserve the padded group height in its row and
center adjacent standalone controls. A responsive row can give groups more
space to reveal complete buttons up to `overflow-at`, while keeping options in
their authored order. When every option is in overflow, use the first option's
icon for its trigger. Direct siblings in a `data-toggle-group-row` share the
available width. See the [toggle group contract](docs/ui-state-architecture.md#toggle-button-groups)
for measurement, configuration, and event details.

Keep the footer's mode, More, and Location controls stable between Write notes
and Select. When the footer needs multiple rows, musical tools appear above its
default controls. Changing a musical recipe must preserve those navigation
positions. See [Author workspace layout](docs/author-workspace.md).

## Related layouts and accessibility

Tools tabs retain their panel-navigation structure and underline cue. The event
navigator retains voice, event, and marking hierarchy, including inline labels
and disclosure controls. They reuse applicable colors, focus, and control tokens
while keeping the geometry needed to express those relationships. Popovers,
forms, score overlays, and printed pages retain their own layout responsibilities.

Every focusable control needs a visible keyboard focus indicator. Preserve its
native accessible name, disabled state, and keyboard behavior. Use real
`select`/`option` elements for overflow, with customizable-select enhancement
behind feature queries and the ordinary-select fallback intact.

Forced-colors defaults map to system colors in the token sheet. Components also
provide explicit group, selected, and focus outlines so these remain visible
when backgrounds or box shadows are suppressed. Keep focus distinguishable from
selection and expose state through accessibility attributes as well as color.

## Extending the system

- Start from the closest existing control family and consume its shared tokens.
- Keep component-specific overrides available and scoped to the intended region.
- Check default, active, hover, disabled, and focused states with identical text;
  a state change should preserve geometry and nearby positions.
- Check narrow and wide layouts, enlarged root text, and shrink-then-grow sizing.
  Confirm overflow recovers buttons and group borders fit their visible contents.
- Inspect native keyboard interaction and forced colors alongside normal styling.
- Update this guide when introducing a shared role or changing a family contract.
  Keep the defaults in the token sheet and behavior in the owning components.
