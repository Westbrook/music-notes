import { MUSIC_ATTRIBUTES, readScore } from '../dom/index.js';
import { add, compare, meterTime } from '../model/index.js';
import type { Diagnostic, Score } from '../model/types.js';
import type { AuthorProject, InstructionScope, LayoutProfile, MeasureColumnIdentity, PartDefinition } from './types.js';

/** Bounds apply before parsing, including the unaccepted source buffer. */
export const MAX_SOURCE_LENGTH = 2_000_000;
export const MAX_PROJECT_LENGTH = 8_000_000;
const MAX_ELEMENTS = 25_000;
const MAX_SOURCE_DEPTH = 32;
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
const annotationTags = new Set(['music-tempo', 'music-dynamics', 'music-direction', 'music-harmony', 'music-rehearsal']);
const safeGlobals = new Set(['id', 'title', 'lang', 'dir', 'aria-label', 'aria-description']);
const sourceState = new WeakMap<Element, { original: string; outer: string; prefix: string; suffix: string; assignedIds: boolean }>();
const projectNotices = new WeakMap<AuthorProject, readonly string[]>();
let sequence = 0;

export class ProjectValidationError extends Error {
  readonly diagnostics: readonly Diagnostic[];
  constructor(message: string, diagnostics: readonly Diagnostic[] = []) {
    super(message);
    this.name = 'ProjectValidationError';
    this.diagnostics = diagnostics;
  }
}

function fail(message: string): never { throw new ProjectValidationError(message); }
function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.length > 256 || /[\s\0]/.test(value) || forbiddenKeys.has(value)) {
    fail(`${label} must be a unique, nonempty identifier without whitespace or reserved object keys (maximum 256 characters).`);
  }
  return value;
}
function newId(kind: string, taken: ReadonlySet<string> = new Set()): string {
  let id: string;
  do {
    const token = typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2)}`;
    id = `author-${kind}-${token}`;
  } while (taken.has(id));
  return id;
}

function knownAttribute(tag: string, name: string): boolean {
  return MUSIC_ATTRIBUTES[tag].includes(name) || safeGlobals.has(name) || /^data-[a-z0-9_.:-]+$/.test(name);
}

/**
 * A small lexer enforces the explicitly closed HTML grammar before an HTML
 * parser can repair dropped wrappers, duplicate attributes, or unclosed tags.
 * DOM validation below remains necessary: comments and entities follow HTML's
 * parsing rules, not this lexer's approximation of them.
 */
function checkMarkup(html: string): void {
  const stack: string[] = [];
  let count = 0;
  for (let offset = 0; offset < html.length;) {
    const open = html.indexOf('<', offset);
    if (open < 0) break;
    if (html.startsWith('<!--', open)) {
      const end = html.indexOf('-->', open + 4);
      if (end < 0) fail('Close every HTML comment with -->.');
      offset = end + 3;
      continue;
    }
    let cursor = open + 1;
    const closing = html[cursor] === '/';
    if (closing) cursor++;
    const nameStart = cursor;
    while (/[a-zA-Z0-9-]/.test(html[cursor] ?? '') && cursor < html.length) cursor++;
    const tag = html.slice(nameStart, cursor).toLowerCase();
    if (!Object.hasOwn(MUSIC_ATTRIBUTES, tag)) {
      fail(`Only documented music elements are allowed in source; found ${tag ? `<${tag}>` : 'unsupported markup'}. Encode literal < in text as &lt;.`);
    }
    if (closing) {
      while (/\s/.test(html[cursor] ?? '') && cursor < html.length) cursor++;
      if (html[cursor] !== '>') fail(`Invalid closing tag for <${tag}>.`);
      if (stack.pop() !== tag) fail(`Close music elements in their authored order; unexpected </${tag}>.`);
      offset = cursor + 1;
      continue;
    }
    const attributes = new Set<string>();
    while (cursor < html.length) {
      const beforeSpace = cursor;
      while (/\s/.test(html[cursor] ?? '') && cursor < html.length) cursor++;
      if (html[cursor] === '>') break;
      if (html[cursor] === '/') fail(`Custom elements need explicit closing tags; write </${tag}> instead of />.`);
      if (beforeSpace === cursor) fail(`Separate attributes on <${tag}> with whitespace.`);
      const start = cursor;
      while (cursor < html.length && !/[\s=<>/"'`]/.test(html[cursor])) cursor++;
      const name = html.slice(start, cursor).toLowerCase();
      if (!name || !knownAttribute(tag, name)) fail(`Attribute "${name}" is not allowed on <${tag}>. Use documented notation attributes or data-* metadata; scripts, event handlers, and styles cannot be imported.`);
      if (attributes.has(name)) fail(`Attribute "${name}" is repeated on <${tag}>.`);
      attributes.add(name);
      if (attributes.size > 64) fail('A music element cannot contain more than 64 attributes.');
      const afterName = cursor;
      while (/\s/.test(html[cursor] ?? '') && cursor < html.length) cursor++;
      if (html[cursor] !== '=') { cursor = afterName; continue; }
      cursor++;
      while (/\s/.test(html[cursor] ?? '') && cursor < html.length) cursor++;
      const quote = html[cursor];
      if (quote === '"' || quote === "'") {
        const end = html.indexOf(quote, cursor + 1);
        if (end < 0) fail(`Close the quoted value for "${name}".`);
        cursor = end + 1;
      } else {
        const valueStart = cursor;
        while (cursor < html.length && !/[\s>]/.test(html[cursor])) {
          if (/[<"'`=]/.test(html[cursor])) fail(`Invalid unquoted value for "${name}".`);
          cursor++;
        }
        if (cursor === valueStart) fail(`Attribute "${name}" needs a value after =.`);
      }
    }
    if (html[cursor] !== '>') fail(`Close the opening <${tag}> tag.`);
    stack.push(tag);
    if (stack.length > MAX_SOURCE_DEPTH) fail(`Source nesting exceeds ${MAX_SOURCE_DEPTH} elements.`);
    if (++count > MAX_ELEMENTS) fail(`Source exceeds ${MAX_ELEMENTS.toLocaleString()} music elements.`);
    offset = cursor + 1;
  }
  if (stack.length) fail(`Add the missing </${stack[stack.length - 1]}> closing tag.`);
}

function checkLayoutAttributes(element: Element): void {
  for (const name of ['max-measures', 'print-width']) {
    const value = element.getAttribute(name);
    if (value === null) continue;
    const number = Number(value);
    if (!value.trim() || !Number.isFinite(number) || number <= 0 || (name === 'max-measures' && !Number.isSafeInteger(number))) {
      fail(`${name} must be a positive ${name === 'max-measures' ? 'integer' : 'number'}.`);
    }
  }
  const numbers = element.getAttribute('measure-numbers');
  if (numbers !== null && !['all', 'system', 'none'].includes(numbers)) fail('measure-numbers must be all, system, or none.');
  for (const name of ['justify-last', 'print-preview']) {
    const value = element.getAttribute(name);
    if (value !== null && !['', name, 'true'].includes(value)) fail(`${name} is a boolean attribute; remove it to disable it.`);
  }
}

function ensureValidMusic(root: Element): ReturnType<typeof readScore> {
  const result = readScore(root);
  const errors = result.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
  if (errors.length) {
    throw new ProjectValidationError(errors.slice(0, 5).map(diagnostic => `${diagnostic.message} [${diagnostic.sourceId}]`).join('\n')
      + (errors.length > 5 ? `\n…and ${errors.length - 5} more source errors.` : ''), result.diagnostics);
  }
  return result;
}

/** Parse into an inert document; no imported node enters the live application. */
export function parseSource(html: string): Element {
  if (typeof html !== 'string' || !html.trim()) fail('Source must contain one music-staff or music-system.');
  if (html.length > MAX_SOURCE_LENGTH) fail(`Source exceeds the ${MAX_SOURCE_LENGTH.toLocaleString()} character limit.`);
  if (html.includes('\0')) fail('Source cannot contain null characters.');
  checkMarkup(html);
  const owner = document.implementation.createHTMLDocument('');
  const template = owner.createElement('template');
  template.innerHTML = html;
  const roots = [...template.content.children];
  if (roots.length !== 1 || !['music-staff', 'music-system'].includes(roots[0].localName)) fail('Source must contain exactly one music-staff or music-system root.');
  const root = roots[0];
  for (const node of template.content.childNodes) {
    if (node !== root && node.nodeType !== 8 && !(node.nodeType === 3 && !node.textContent?.trim())) fail('Only comments and whitespace may surround the score root.');
  }
  const elements = [root, ...root.querySelectorAll('*')];
  if (elements.length > MAX_ELEMENTS) fail('Source contains too many music elements.');
  const taken = new Set<string>();
  for (const element of elements) {
    const tag = element.localName;
    if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !Object.hasOwn(MUSIC_ATTRIBUTES, tag)) fail(`Element <${tag}> is not allowed in music source.`);
    for (const attribute of element.attributes) {
      if (attribute.namespaceURI || !knownAttribute(tag, attribute.name)) fail(`Attribute "${attribute.name}" is not allowed on <${tag}>.`);
    }
    checkLayoutAttributes(element);
    if (!element.hasAttribute('id')) continue;
    const id = identifier(element.getAttribute('id'), 'Source ID');
    if (taken.has(id)) fail(`Source ID "${id}" is repeated. Give every music element its own ID.`);
    taken.add(id);
  }
  let assignedIds = false;
  for (const element of elements) {
    if (element.hasAttribute('id')) continue;
    const id = newId(element.localName.replace('music-', ''), taken);
    taken.add(id);
    element.setAttribute('id', id);
    assignedIds = true;
  }
  ensureValidMusic(root);
  const serializeOutside = (nodes: readonly Node[]) => nodes.map(node => node.nodeType === 8 ? `<!--${node.textContent ?? ''}-->` : node.textContent ?? '').join('');
  const siblings = [...template.content.childNodes];
  const at = siblings.indexOf(root);
  const prefix = serializeOutside(siblings.slice(0, at));
  const suffix = serializeOutside(siblings.slice(at + 1));
  if (prefix.length + root.outerHTML.length + suffix.length > MAX_SOURCE_LENGTH) fail('Source with persistent IDs exceeds the supported source size; split this score into smaller projects.');
  sourceState.set(root, { original: html, outer: root.outerHTML, prefix, suffix, assignedIds });
  return root;
}

function acceptedHtml(root: Element): string {
  const saved = sourceState.get(root);
  if (saved && !saved.assignedIds && saved.outer === root.outerHTML) return saved.original;
  return `${saved?.prefix ?? ''}${root.outerHTML}${saved?.suffix ?? ''}`;
}

/** Current source markup, retaining surrounding comments and original text when unchanged. */
export function getSourceHtml(root: Element): string { return acceptedHtml(root); }
/** Preserve the source framing when staging edits on an otherwise detached clone. */
export function copySourceContext(from: Element, to: Element): void {
  const context = sourceState.get(from);
  if (context) sourceState.set(to, { ...context });
}

export function findSource(root: Element, id: string): Element | undefined {
  if (root.getAttribute('id') === id) return root;
  return [...root.querySelectorAll('[id]')].find(element => element.getAttribute('id') === id);
}

export function defaultLayout(): LayoutProfile {
  return { paper: 'letter', orientation: 'portrait', marginMm: 15, staffScale: 1,
    measureNumbers: 'system', maxMeasures: null, justifyLast: false, breaks: {}, keeps: {}, reviewedTurns: {} };
}

export function getProjectNotices(project: AuthorProject): readonly string[] { return projectNotices.get(project) ?? []; }
export function copyProjectNotices(from: AuthorProject, to: AuthorProject): void {
  const notices = projectNotices.get(from);
  if (notices) projectNotices.set(to, [...notices]);
}

function jsonSafe(value: unknown): void {
  const seen = new Set<object>();
  const queue = [{ value, depth: 0 }];
  let count = 0;
  while (queue.length) {
    const item = queue.pop()!;
    if (++count > 200_000 || item.depth > 16) fail('Project data is too large or deeply nested.');
    if (item.value === null || typeof item.value === 'boolean' || typeof item.value === 'string') continue;
    if (typeof item.value === 'number') { if (!Number.isFinite(item.value)) fail('Project numbers must be finite.'); continue; }
    if (typeof item.value !== 'object') fail('A project may contain only JSON data.');
    const object = item.value;
    const prototype = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null && !(Array.isArray(object) && prototype === Array.prototype)) fail('Project objects must not have custom prototypes.');
    if (seen.has(object)) fail('Project data must not contain cycles or shared object references.');
    seen.add(object);
    if (Object.getOwnPropertySymbols(object).length) fail('Project objects cannot contain symbol keys.');
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(object))) {
      if (Array.isArray(object) && key === 'length') continue;
      if (forbiddenKeys.has(key) || !('value' in descriptor)) fail(`Project key "${key}" is not allowed.`);
      if (Array.isArray(object) && !/^(0|[1-9]\d*)$/.test(key)) fail('Project arrays cannot have named properties.');
      queue.push({ value: descriptor.value, depth: item.depth + 1 });
    }
    if (Array.isArray(object) && Object.keys(object).length !== object.length) fail('Project arrays cannot contain empty slots.');
  }
}

function record(value: unknown, label: string, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  const result = value as Record<string, unknown>;
  if (keys && (Object.keys(result).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(result, key)))) fail(`${label} must contain exactly: ${keys.join(', ')}.`);
  return result;
}
function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum || value.includes('\0')) fail(`${label} must be text of at most ${maximum.toLocaleString()} characters without null characters.`);
  return value;
}
function list(value: unknown, label: string, maximum = MAX_ELEMENTS): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} must be an array of at most ${maximum} items.`);
  return value;
}
function ids(value: unknown, label: string, allowEmpty = true): string[] {
  const result = list(value, label).map(entry => identifier(entry, label));
  if ((!allowEmpty && !result.length) || new Set(result).size !== result.length) fail(`${label} must contain ${allowEmpty ? '' : 'one or more '}distinct IDs.`);
  return result;
}
function choice<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) fail(`${label} must be ${values.join(', ')}.`);
  return value as T;
}
function numeric(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) fail(`${label} must be a number from ${minimum} to ${maximum}.`);
  return value;
}
function bool(value: unknown, label: string): boolean { if (typeof value !== 'boolean') fail(`${label} must be true or false.`); return value; }

function layout(value: unknown, label: string): LayoutProfile {
  const object = record(value, label, ['paper', 'orientation', 'marginMm', 'staffScale', 'measureNumbers', 'maxMeasures', 'justifyLast', 'breaks', 'keeps', 'reviewedTurns']);
  const maxMeasures = object.maxMeasures === null ? null : numeric(object.maxMeasures, 1, MAX_ELEMENTS, `${label}.maxMeasures`);
  if (maxMeasures !== null && !Number.isSafeInteger(maxMeasures)) fail(`${label}.maxMeasures must be an integer or null.`);
  const breaks = Object.fromEntries(Object.entries(record(object.breaks, `${label}.breaks`)).map(([key, value]) => [identifier(key, 'Break column'), choice(value, ['auto', 'line', 'page'] as const, 'Break choice')]));
  const keeps = Object.fromEntries(Object.entries(record(object.keeps, `${label}.keeps`)).map(([key, value]) => [identifier(key, 'Keep column'), bool(value, 'Keep choice')]));
  const reviewedTurns = Object.fromEntries(Object.entries(record(object.reviewedTurns, `${label}.reviewedTurns`)).map(([key, value]) => [identifier(key, 'Turn column'), text(value, 'Turn review', 10_000)]));
  return { paper: choice(object.paper, ['letter', 'a4'], `${label}.paper`), orientation: choice(object.orientation, ['portrait', 'landscape'], `${label}.orientation`),
    marginMm: numeric(object.marginMm, 0, 80, `${label}.marginMm`), staffScale: numeric(object.staffScale, 0.5, 3, `${label}.staffScale`),
    measureNumbers: choice(object.measureNumbers, ['all', 'system', 'none'], `${label}.measureNumbers`), maxMeasures,
    justifyLast: bool(object.justifyLast, `${label}.justifyLast`), breaks, keeps, reviewedTurns };
}

function projectShape(value: unknown): AuthorProject {
  jsonSafe(value);
  const object = record(value, 'Project', ['version', 'id', 'metadata', 'sourceHtml', 'parts', 'columns', 'layouts', 'instructionScopes', 'reviewedShortMeasures', 'pendingSource', 'updatedAt']);
  if (object.version !== 1) fail(`Unsupported project version ${String(object.version)}. This application reads version 1; retain the original file.`);
  const metadata = record(object.metadata, 'Metadata', ['title', 'composer', 'subtitle']);
  const parts = list(object.parts, 'Parts', 256).map((entry, index): PartDefinition => {
    const part = record(entry, `Part ${index + 1}`, ['id', 'label', 'staffIds']);
    const id = identifier(part.id, 'Part ID');
    if (id === 'score') fail('A part cannot use the reserved ID "score".');
    return { id, label: text(part.label, 'Part label', 1000), staffIds: ids(part.staffIds, 'Part staff IDs', false) };
  });
  if (new Set(parts.map(part => part.id)).size !== parts.length) fail('Part IDs must be distinct.');
  const columns = list(object.columns, 'Columns').map((entry, index): MeasureColumnIdentity => {
    const column = record(entry, `Column ${index + 1}`, ['id', 'measureIds']);
    return { id: identifier(column.id, 'Column ID'), measureIds: ids(column.measureIds, 'Column measure IDs', false) };
  });
  if (new Set(columns.map(column => column.id)).size !== columns.length) fail('Column IDs must be distinct.');
  const layouts = Object.fromEntries(Object.entries(record(object.layouts, 'Layouts')).map(([key, value]) => [identifier(key, 'Layout ID'), layout(value, `Layout ${key}`)]));
  const instructionScopes = Object.fromEntries(Object.entries(record(object.instructionScopes, 'Instruction scopes')).map(([key, value]): [string, InstructionScope] => [identifier(key, 'Instruction ID'), value === 'all' ? 'all' : ids(value, 'Instruction part IDs', false)]));
  const updatedAt = numeric(object.updatedAt, 0, Number.MAX_SAFE_INTEGER, 'updatedAt');
  if (!Number.isSafeInteger(updatedAt)) fail('updatedAt must be an integer timestamp.');
  return { version: 1, id: identifier(object.id, 'Project ID'),
    metadata: { title: text(metadata.title, 'Title', 1000), composer: text(metadata.composer, 'Composer', 1000), subtitle: text(metadata.subtitle, 'Subtitle', 4000) },
    sourceHtml: text(object.sourceHtml, 'Source', MAX_SOURCE_LENGTH), parts, columns, layouts, instructionScopes,
    reviewedShortMeasures: ids(object.reviewedShortMeasures, 'Reviewed short measures'),
    pendingSource: object.pendingSource === null ? null : text(object.pendingSource, 'Unaccepted source buffer', MAX_SOURCE_LENGTH), updatedAt };
}

function measureColumns(score: Score, previous: readonly MeasureColumnIdentity[] = []): MeasureColumnIdentity[] {
  const owner = new Map<string, string>();
  for (const column of previous) {
    for (const id of column.measureIds) {
      if (owner.has(id)) fail(`Measure "${id}" belongs to more than one stored column.`);
      owner.set(id, column.id);
    }
  }
  const used = new Set<string>();
  return score.staves[0].measures.map((_, index) => {
    const measureIds = score.staves.map(staff => staff.measures[index].id);
    const candidates = [...new Set(measureIds.map(id => owner.get(id)).filter((id): id is string => id !== undefined))];
    if (candidates.length > 1) fail(`Measures at position ${index + 1} now combine different saved columns. Move aligned measures together or explicitly reset their layout preferences.`);
    const id = candidates[0] ?? newId('column', used);
    if (used.has(id)) fail(`Saved column "${id}" was split across different positions. Keep aligned staff measures together or reset their layout preferences.`);
    used.add(id);
    return { id, measureIds };
  });
}

function shortMeasureIds(score: Score): Set<string> {
  return new Set(score.staves.flatMap(staff => staff.measures.filter(measure => measure.incomplete
    && measure.voices.every(voice => voice.events.length > 0) && measure.voices.some(voice => {
    const last = voice.events.at(-1);
    return !last || compare(add(last.onset, last.time), meterTime(measure.meter)) < 0;
  })).map(measure => measure.id)));
}

function validateReferences(project: AuthorProject, root: Element, score: Score): void {
  const staffIds = new Set(score.staves.map(staff => staff.id));
  for (const part of project.parts) {
    for (const id of part.staffIds) if (!staffIds.has(id)) fail(`Part "${part.label || part.id}" refers to missing staff "${id}". Repair the part membership before applying this project.`);
  }
  const layoutIds = new Set(['score', ...project.parts.map(part => part.id)]);
  for (const id of layoutIds) if (!Object.hasOwn(project.layouts, id)) fail(`Project is missing layout "${id}".`);
  for (const id of Object.keys(project.layouts)) if (!layoutIds.has(id)) fail(`Layout "${id}" has no corresponding part. Remove or reconnect it explicitly.`);
  const expected = score.staves[0].measures.map((_, index) => score.staves.map(staff => staff.measures[index].id));
  if (project.columns.length !== expected.length || project.columns.some((column, index) => column.measureIds.length !== expected[index].length || column.measureIds.some((id, staff) => id !== expected[index][staff]))) fail('Stored columns do not match the ordered parallel measures in the source.');
  const columnIds = new Set(project.columns.map(column => column.id));
  for (const [name, profile] of Object.entries(project.layouts)) {
    for (const key of [...Object.keys(profile.breaks), ...Object.keys(profile.keeps), ...Object.keys(profile.reviewedTurns)]) {
      if (!columnIds.has(key)) fail(`Layout "${name}" refers to removed column "${key}". Clear or reconnect that layout choice before applying the source.`);
    }
  }
  const partIds = new Set(project.parts.map(part => part.id));
  for (const [id, scope] of Object.entries(project.instructionScopes)) {
    const instruction = findSource(root, id);
    if (!instruction || !annotationTags.has(instruction.localName)) fail(`Instruction scope "${id}" no longer refers to an annotation. Remove or reconnect its scope before applying the source.`);
    if (scope !== 'all') for (const part of scope) if (!partIds.has(part)) fail(`Instruction "${id}" refers to missing part "${part}". Choose its recipients explicitly.`);
  }
  const shorts = shortMeasureIds(score);
  for (const id of project.reviewedShortMeasures) if (!shorts.has(id)) fail(`Reviewed short measure "${id}" is missing or is not an incomplete short measure.`);
}

export function createProject(sourceHtml: string, title?: string, parts?: PartDefinition[]): AuthorProject {
  const root = parseSource(sourceHtml);
  const { score } = ensureValidMusic(root);
  const definitions = parts ?? score.staves.map((staff, index) => ({ id: newId('part'), label: staff.label || `Part ${index + 1}`, staffIds: [staff.id] }));
  const project: AuthorProject = { version: 1, id: newId('project'), metadata: { title: title ?? (score.label || 'Untitled score'), composer: '', subtitle: '' },
    sourceHtml: acceptedHtml(root), parts: definitions, columns: measureColumns(score),
    layouts: Object.fromEntries(['score', ...definitions.map(part => part.id)].map(id => [id, defaultLayout()])),
    instructionScopes: {}, reviewedShortMeasures: [], pendingSource: null, updatedAt: Date.now() };
  const checked = projectShape(project);
  validateReferences(checked, root, score);
  return checked;
}

/** Reconcile presentation identities without mutating the accepted project. */
export function normalizeProject(project: AuthorProject, source: Element): AuthorProject {
  const next = projectShape(project);
  const root = parseSource(acceptedHtml(source));
  const { score } = ensureValidMusic(root);
  const notices: string[] = [];
  const staffIds = new Set(score.staves.map(staff => staff.id));
  next.parts = next.parts.flatMap(part => {
    const remaining = part.staffIds.filter(id => staffIds.has(id));
    if (remaining.length === part.staffIds.length) return [part];
    if (remaining.length) {
      notices.push(`Removed missing staff membership from part "${part.label || part.id}"; its remaining staves and layout are retained.`);
      return [{ ...part, staffIds: remaining }];
    }
    notices.push(`Removed empty part "${part.label || part.id}" and its layout because none of its staves remain.`);
    delete next.layouts[part.id];
    return [];
  });
  for (const part of next.parts) if (!Object.hasOwn(next.layouts, part.id)) next.layouts[part.id] = defaultLayout();
  if (!Object.hasOwn(next.layouts, 'score')) next.layouts.score = defaultLayout();
  next.columns = measureColumns(score, next.columns);
  next.sourceHtml = acceptedHtml(root);
  const shortIds = shortMeasureIds(score);
  next.reviewedShortMeasures = next.reviewedShortMeasures.filter(id => {
    if (shortIds.has(id)) return true;
    notices.push(`Removed the review for short measure "${id}" because it is no longer present as an incomplete short measure.`);
    return false;
  });
  next.updatedAt = Date.now();
  validateReferences(next, root, score);
  projectNotices.set(next, notices);
  return next;
}

/** Version-1 project JSON is portable; pendingSource is text, never accepted DOM. */
export function importProject(input: string): AuthorProject {
  if (typeof input !== 'string' || input.length > MAX_PROJECT_LENGTH) fail(`Project exceeds the ${MAX_PROJECT_LENGTH.toLocaleString()} character limit.`);
  let value: unknown;
  try { value = JSON.parse(input); } catch { fail('This is not valid project JSON. The original file has not been changed.'); }
  const project = projectShape(value);
  const root = parseSource(project.sourceHtml);
  const { score } = ensureValidMusic(root);
  validateReferences(project, root, score);
  project.sourceHtml = acceptedHtml(root);
  return project;
}

/** A successful serialization is a backup payload, not evidence of a download. */
export function serializeProject(project: AuthorProject): string {
  const checked = projectShape(project);
  const root = parseSource(checked.sourceHtml);
  const { score } = ensureValidMusic(root);
  validateReferences(checked, root, score);
  checked.sourceHtml = acceptedHtml(root);
  const serialized = JSON.stringify(checked, null, 2);
  if (serialized.length > MAX_PROJECT_LENGTH) fail(`Project exceeds the ${MAX_PROJECT_LENGTH.toLocaleString()} character limit.`);
  return serialized;
}
