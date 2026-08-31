import { readScore } from '../dom/index.js';
import { formatRational, validateScore } from '../model/index.js';
import type { Annotation, Diagnostic, Score } from '../model/types.js';
import { pageDimensions } from './pages.js';
import { defaultLayout, findSource, parseSource } from './project.js';
import type { AuthorProject, LayoutProfile, PagePlan, PartDefinition, ProjectionResult } from './types.js';

function partFor(project: AuthorProject, targetPartId: string): PartDefinition | undefined {
  if (targetPartId === 'score') return undefined;
  const part = project.parts.find(candidate => candidate.id === targetPartId);
  if (!part) throw new RangeError(`The part "${targetPartId}" no longer exists. Choose a current part or the full score.`);
  if (!part.staffIds.length || new Set(part.staffIds).size !== part.staffIds.length) {
    throw new RangeError(`Part "${part.label}" must contain at least one staff, with no duplicate staff membership.`);
  }
  return part;
}

function profileFor(project: AuthorProject, targetPartId: string): LayoutProfile {
  const profile = project.layouts[targetPartId] ?? project.layouts.score ?? defaultLayout();
  return {
    ...profile, breaks: { ...profile.breaks }, keeps: { ...profile.keeps }, reviewedTurns: { ...profile.reviewedTurns },
  };
}

interface OriginalInstruction { annotation: Annotation; staffId: string; column: number }

/**
 * Make a disposable DOM projection, never a second musical source. Defaults are
 * resolved against the complete authored score before staves are removed, so a
 * source break or shared instruction on an omitted staff is not silently lost.
 * Source IDs and explicit pitch spellings survive; no transposition is implied.
 */
export function buildProjection(project: AuthorProject, targetPartId = 'score'): ProjectionResult {
  const part = partFor(project, targetPartId);
  const source = parseSource(project.sourceHtml);
  const original = readScore(source);
  const diagnostics: Diagnostic[] = [];
  const profile = profileFor(project, targetPartId);
  const selected = part ? new Set(part.staffIds) : new Set(original.score.staves.map(staff => staff.id));
  const allStaffIds = new Set(original.score.staves.map(staff => staff.id));
  for (const id of selected) {
    if (!allStaffIds.has(id)) throw new RangeError(`Part "${part?.label ?? targetPartId}" refers to missing staff "${id}".`);
  }
  const staves = original.score.staves.filter(staff => selected.has(staff.id));
  const notations = new Set(staves.map(staff => staff.notation ?? 'pitched'));
  const notationLabel = notations.size > 1 ? 'mixed notation' : notations.has('three-roads') ? '3 roads music'
    : notations.has('rhythm') ? 'rhythm notation' : 'authored pitch';
  const partLabel = part?.label ?? 'Full score';
  const label = partLabel === notationLabel ? partLabel : `${partLabel} · ${notationLabel}`;
  const instructions: OriginalInstruction[] = original.score.staves.flatMap(staff => staff.measures.flatMap((measure, column) =>
    measure.annotations.map(annotation => ({ annotation, staffId: staff.id, column }))));
  // Keep references before pruning: shared annotations may belong to removed staves.
  const instructionSources = new Map(instructions.map(item => [item.annotation.id, original.sources.get(item.annotation.id)!]));
  const measureIndex = new Map<string, number>();
  for (const staff of original.score.staves) staff.measures.forEach((measure, index) => measureIndex.set(measure.id, index));
  const columnIndices = new Map<string, number>();
  for (const column of project.columns) {
    const matching = new Set(column.measureIds.flatMap(id => measureIndex.has(id) ? [measureIndex.get(id)!] : []));
    if (matching.size === 1 && !columnIndices.has(column.id)) {
      columnIndices.set(column.id, [...matching][0]);
    } else if (matching.size > 1 || columnIndices.has(column.id)) {
      diagnostics.push({ severity: 'error', code: 'ambiguous-layout-anchor', sourceId: source.id,
        message: `Layout column "${column.id}" has conflicting measure identities. Repair the project before applying layout choices.` });
    }
  }
  const overrides = new Map<number, { breakBefore?: 'auto' | 'line' | 'page'; keepWithNext?: boolean }>();
  for (const id of new Set([...Object.keys(profile.breaks), ...Object.keys(profile.keeps)])) {
    const index = columnIndices.get(id);
    if (index === undefined) {
      diagnostics.push({ severity: 'warning', code: 'orphaned-layout-anchor', sourceId: source.id,
        message: `Layout choice for column "${id}" no longer has a measure. Review or remove that choice.` });
      continue;
    }
    const current = overrides.get(index) ?? {};
    if (Object.hasOwn(profile.breaks, id)) {
      const value = profile.breaks[id];
      if (value !== 'auto' && value !== 'line' && value !== 'page') {
        diagnostics.push({ severity: 'error', code: 'invalid-layout-break', sourceId: source.id,
          message: `Layout column "${id}" must use automatic, line, or page breaking.` });
      } else if (current.breakBefore !== undefined && current.breakBefore !== value) {
        diagnostics.push({ severity: 'error', code: 'ambiguous-layout-anchor', sourceId: source.id,
          message: `Multiple layout columns give different breaks to the same measure. Repair column "${id}".` });
      } else current.breakBefore = value;
    }
    if (Object.hasOwn(profile.keeps, id)) {
      const value = profile.keeps[id];
      if (typeof value !== 'boolean') {
        diagnostics.push({ severity: 'error', code: 'invalid-layout-keep', sourceId: source.id,
          message: `Layout column "${id}" must explicitly enable or disable keeping the next measure.` });
      } else if (current.keepWithNext !== undefined && current.keepWithNext !== value) {
        diagnostics.push({ severity: 'error', code: 'ambiguous-layout-anchor', sourceId: source.id,
          message: `Multiple layout columns give different keep choices to the same measure. Repair column "${id}".` });
      } else current.keepWithNext = value;
    }
    overrides.set(index, current);
  }

  for (const staff of original.score.staves) {
    if (!selected.has(staff.id)) original.sources.get(staff.id)!.remove();
  }
  if (source.localName === 'music-system' && staves.length === 1) source.setAttribute('bracket', 'none');
  // A multistaff part preserves authored staff order and bracket: two staves do
  // not by themselves imply that the performer is a pianist.
  if (part) {
    const description = `${project.metadata.title || original.score.label || 'Untitled'} — ${label}`;
    // A standalone root's label is also its printed staff label. Do not turn a
    // document heading into a huge instrument label beside every system.
    source.setAttribute(source.localName === 'music-system' ? 'label' : 'aria-label', description);
  }

  for (const [index] of (original.score.staves[0]?.measures ?? []).entries()) {
    const defaults = original.score.staves.map(staff => staff.measures[index]);
    const override = overrides.get(index);
    const breakBefore = override?.breakBefore ?? (defaults.some(measure => measure.breakBefore === 'page') ? 'page'
      : defaults.some(measure => measure.breakBefore === 'line') ? 'line' : 'auto');
    const keepWithNext = override?.keepWithNext ?? defaults.some(measure => measure.keepWithNext);
    for (const staff of staves) {
      const measure = findSource(source, staff.measures[index].id)!;
      if (breakBefore === 'auto') measure.removeAttribute('break-before');
      else measure.setAttribute('break-before', breakBefore);
      measure.toggleAttribute('keep-with-next', keepWithNext);
    }
  }

  if (part) {
    for (const item of instructions) {
      const scope = project.instructionScopes[item.annotation.id];
      const authoredHere = selected.has(item.staffId);
      const included = scope === undefined ? authoredHere : scope === 'all' || scope.includes(part.id);
      const existing = findSource(source, item.annotation.id);
      if (!included) { existing?.remove(); continue; }
      if (existing) continue;
      const destination = findSource(source, staves[0].measures[item.column].id)!;
      const instruction = instructionSources.get(item.annotation.id)!.cloneNode(true) as Element;
      // Explicitly preserve the original musical position when changing the
      // containing staff or moving an annotation out of a sequential voice.
      instruction.setAttribute('at', formatRational(item.annotation.onset));
      destination.append(instruction);
    }
  }

  const dimensions = pageDimensions(profile);
  for (const message of dimensions.issues) diagnostics.push({ severity: 'error', code: 'invalid-page-settings', sourceId: source.id, message });
  source.setAttribute('print-width', String(Math.max(1, dimensions.engravingWidthPx)));
  source.setAttribute('measure-numbers', profile.measureNumbers);
  if (profile.maxMeasures === null) source.removeAttribute('max-measures');
  else source.setAttribute('max-measures', String(profile.maxMeasures));
  source.toggleAttribute('justify-last', profile.justifyLast);
  source.removeAttribute('print-preview');
  const projected = readScore(source);
  return { source, score: projected.score, diagnostics: [...diagnostics, ...projected.diagnostics], profile, label };
}

export interface PublicationOptions {
  draft?: boolean;
  /** Issues from the physical page planner, distinct from musical validation. */
  layoutIssues?: readonly string[];
  /** Explicit acknowledgement, never a claim that clipping or turns are safe. */
  acknowledgeLayoutWarnings?: boolean;
}

export interface PublicationPreflight {
  canPublish: boolean;
  errors: string[];
  warnings: string[];
  draft: boolean;
}

/** Musical validation and pending-source errors cannot be bypassed by draft printing. */
export function publicationPreflight(
  project: AuthorProject, score: Score, diagnostics: readonly Diagnostic[], options: PublicationOptions = {},
): PublicationPreflight {
  const errors = new Set<string>();
  const warnings = new Set<string>();
  const draft = options.draft === true;
  if (project.pendingSource !== null) errors.add('Apply or discard the pending source draft before printing. The current engraving does not contain those edits.');
  const measures = new Map(score.staves.flatMap(staff => staff.measures.map(measure => [measure.id, measure] as const)));
  const reviewed = new Set(project.reviewedShortMeasures);
  const allDiagnostics = [...diagnostics, ...validateScore(score)];
  const layoutWarning = (message: string) => {
    warnings.add(message);
    if (!options.acknowledgeLayoutWarnings) errors.add(`Review the layout before printing: ${message}`);
  };
  for (const diagnostic of allDiagnostics) {
    if (diagnostic.severity === 'error') { errors.add(diagnostic.message); continue; }
    const code = diagnostic.code.replace(/^print-/, '');
    const measure = diagnostic.measureId ? measures.get(diagnostic.measureId) : undefined;
    if (code === 'empty-voice') {
      if (draft) warnings.add(`Draft: ${diagnostic.message}`);
      else errors.add(`Complete the empty voice or write an explicit rest before publishing; a short-measure review cannot approve unwritten music. ${diagnostic.message}`);
    } else if (code === 'incomplete-measure') {
      if (measure && reviewed.has(measure.id)) warnings.add(`Measure ${measure.number} is an intentionally short measure approved by the author.`);
      else if (draft) warnings.add(`Draft: ${diagnostic.message}`);
      else errors.add(`Complete or explicitly review the short measure before publishing: ${diagnostic.message}`);
    } else if (code === 'tuplet-span') {
      if (draft) warnings.add(`Draft: ${diagnostic.message}`);
      else errors.add(`Complete the tuplet before publishing; a short-measure review does not approve an incomplete tuplet. ${diagnostic.message}`);
    } else if (code.startsWith('layout-') || code === 'orphaned-layout-anchor' || code === 'unjoined-barlines') {
      layoutWarning(diagnostic.message);
    } else warnings.add(diagnostic.message);
  }
  for (const message of options.layoutIssues ?? []) layoutWarning(message);
  if (draft) warnings.add('Draft output must be visibly marked DRAFT. This review does not establish that the music is ready to perform.');
  return { canPublish: errors.size === 0, errors: [...errors], warnings: [...warnings], draft };
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

/**
 * A conservative change token for manual reviews, not a safety certification or
 * security hash. Pass the actual page map so font/measurement changes also
 * invalidate a review. Save timestamps and the review records themselves do not.
 */
export function turnFingerprint(project: AuthorProject, targetPartId = 'score', pagePlan?: PagePlan): string {
  const part = partFor(project, targetPartId);
  const { reviewedTurns: _reviews, ...profile } = profileFor(project, targetPartId);
  const value = canonical({
    version: 'music-notes-turn-review-1', source: project.sourceHtml, metadata: project.metadata,
    targetPartId, part: part ?? null, parts: project.parts, columns: project.columns,
    instructions: project.instructionScopes, profile,
    pages: pagePlan ? {
      widthMm: pagePlan.widthMm, heightMm: pagePlan.heightMm,
      contentWidthPx: pagePlan.contentWidthPx, contentHeightPx: pagePlan.contentHeightPx,
      pages: pagePlan.pages,
    } : null,
  });
  // FNV-1a over UTF-16 code units is sufficient for a deterministic change token.
  let hash = 14695981039346656037n;
  for (let index = 0; index < value.length; index++) hash = BigInt.asUintN(64, (hash ^ BigInt(value.charCodeAt(index))) * 1099511628211n);
  return `turn-v1-${value.length}-${hash.toString(16).padStart(16, '0')}`;
}
