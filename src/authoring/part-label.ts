import type { AuthorProject } from './types.js';

type Part = AuthorProject['parts'][number];
const reservedNames = new Set(['Full score']);

function displayedName(part: Part): string {
  return part.label.replace(/[\t\n\f\r ]+/g, ' ').trim() || part.id;
}

/** A display label only; selection and instruction recipients always use the part ID. */
export function partLabel(part: Part, parts: readonly Part[]): string {
  const name = displayedName(part);
  const candidates = parts.some(candidate => candidate.id === part.id)
    ? parts.map(candidate => candidate.id === part.id ? part : candidate) : [...parts, part];
  const entries = candidates.map(candidate => ({ part: candidate, name: displayedName(candidate) }));
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
  if (counts.get(name) === 1 && !reservedNames.has(name)) return name;

  // Preserve every ordinary unique name, even if it happens to look like an ID
  // suffix generated for another part. Allocate the remaining labels by stable
  // source ID so reordering the part list cannot rename the visible choices.
  const used = new Set([...reservedNames, ...entries.filter(entry => counts.get(entry.name) === 1 && !reservedNames.has(entry.name)).map(entry => entry.name)]);
  const duplicates = entries.filter(entry => counts.get(entry.name)! > 1 || reservedNames.has(entry.name))
    .sort((a, b) => a.part.id < b.part.id ? -1 : a.part.id > b.part.id ? 1 : 0);
  for (const entry of duplicates) {
    let label = `${entry.name} (${entry.part.id})`;
    while (used.has(label)) label += ` · ID: ${entry.part.id}`;
    used.add(label);
    if (entry.part.id === part.id) return label;
  }
  return name;
}
