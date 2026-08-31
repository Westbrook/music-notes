import { describe, expect, it } from 'vitest';
import { partLabel } from '../src/authoring/part-label.js';
import type { AuthorProject } from '../src/authoring/types.js';

type Part = AuthorProject['parts'][number];
const part = (id: string, label: string, staffId = id): Part => ({ id, label, staffIds: [staffId] });

describe('shared part display identity', () => {
  it('keeps a unique named part uncluttered', () => {
    const parts = [part('flute-part', 'Flute'), part('piano-part', 'Piano')];
    expect(parts.map(item => partLabel(item, parts))).toEqual(['Flute', 'Piano']);
  });

  it('distinguishes duplicate names by exact ID regardless of staff membership', () => {
    const parts = [part('lead-flute', 'Lead', 'flute'), part('lead-piano', 'Lead', 'piano')];
    expect(parts.map(item => partLabel(item, parts))).toEqual(['Lead (lead-flute)', 'Lead (lead-piano)']);
  });

  it('uses the ID for empty and whitespace-only names', () => {
    const parts = [part('unnamed', ''), part('blank', ' \t\n ')];
    expect(parts.map(item => partLabel(item, parts))).toEqual(['unnamed', 'blank']);
  });

  it('detects duplicate displayed names after normal HTML whitespace collapse', () => {
    const parts = [part('one', ' Lead \n Flute '), part('two', 'Lead Flute')];
    expect(parts.map(item => partLabel(item, parts))).toEqual(['Lead Flute (one)', 'Lead Flute (two)']);
    expect(parts[0].label).toBe(' Lead \n Flute ');
  });

  it('distinguishes an unnamed ID fallback from another part deliberately named that ID', () => {
    const parts = [part('unnamed', ''), part('named', 'unnamed')];
    expect(parts.map(item => partLabel(item, parts))).toEqual(['unnamed (unnamed)', 'unnamed (named)']);
  });

  it('MARK-RECIPIENT-IDENTITY avoids generated labels colliding with an ordinary authored name', () => {
    const parts = [part('flute', 'Lead'), part('piano', 'Lead'), part('other', 'Lead (flute)')];
    const labels = parts.map(item => partLabel(item, parts));
    expect(new Set(labels).size).toBe(parts.length);
    expect(labels[2]).toBe('Lead (flute)');
    expect(labels[0]).toContain('flute');
    expect(labels[1]).toBe('Lead (piano)');
  });

  it('MARK-RECIPIENT-IDENTITY resolves repeated generated collisions independently of part ordering', () => {
    const parts = [part('flute', 'Lead'), part('piano', 'Lead'), part('other', 'Lead (flute)'),
      part('another', 'Lead (flute) · ID: flute')];
    const labels = Object.fromEntries(parts.map(item => [item.id, partLabel(item, parts)]));
    expect(new Set(Object.values(labels)).size).toBe(parts.length);
    expect(labels.other).toBe('Lead (flute)');
    expect(labels.another).toBe('Lead (flute) · ID: flute');
    const reversed = [...parts].reverse();
    expect(Object.fromEntries(reversed.map(item => [item.id, partLabel(item, reversed)]))).toEqual(labels);
  });

  it('MARK-RECIPIENT-IDENTITY removes unnecessary suffixes after the competing parts are renamed', () => {
    const parts = [part('flute', 'Lead'), part('piano', 'Lead'), part('other', 'Lead (flute)')];
    expect(partLabel(parts[0], parts)).toBe('Lead (flute) · ID: flute');
    parts[2].label = 'Strings';
    expect(partLabel(parts[0], parts)).toBe('Lead (flute)');
    expect(partLabel(parts[2], parts)).toBe('Strings');
    parts[1].label = 'Piano';
    expect(parts.map(item => partLabel(item, parts))).toEqual(['Lead', 'Piano', 'Strings']);
  });

  it('MARK-RECIPIENT-IDENTITY reserves the built-in Full score label without taking another authored name', () => {
    const parts = [part('condensed', 'Full score'), part('literal', 'Full score (condensed)')];
    const labels = parts.map(item => partLabel(item, parts));
    expect(labels[0]).not.toBe('Full score');
    expect(labels[0]).not.toBe('Full score (condensed)');
    expect(labels[0]).toContain('condensed');
    expect(labels[1]).toBe('Full score (condensed)');
    expect(new Set(['Full score', ...labels]).size).toBe(3);
    const reversed = [...parts].reverse();
    expect(parts.map(item => partLabel(item, reversed))).toEqual(labels);
  });

  it('changes labels after renaming without mutating the supplied parts or their order', () => {
    const parts = [part('one', 'Lead'), part('two', 'Lead'), part('three', 'Bass')];
    parts[1].label = 'Piano';
    for (const item of parts) { Object.freeze(item.staffIds); Object.freeze(item); }
    const readonlyParts = Object.freeze(parts);
    const before = JSON.stringify(readonlyParts);
    expect(readonlyParts.map(item => partLabel(item, readonlyParts))).toEqual(['Lead', 'Piano', 'Bass']);
    expect(JSON.stringify(readonlyParts)).toBe(before);
  });
});
