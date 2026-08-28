import { describe, expect, it } from 'vitest';
import { canShareRest, eventMarkingOrder, eventMarkingPlacement, placeEventMarking } from '../src/engraving/semantics.js';
import { ARTICULATION_TYPES, ORNAMENT_TYPES, durationTime, rational } from '../src/model/index.js';
import type { ArticulationMarking, EventMarking, MusicEvent } from '../src/model/types.js';
import type { InkBox } from '../src/engraving/geometry.js';

const articulation = (type: ArticulationMarking['type'], placement: ArticulationMarking['placement'] = 'auto'): ArticulationMarking => ({
  id: type, kind: 'articulation', type, placement,
});
const rest = (id: string, markings?: readonly EventMarking[]): MusicEvent => ({
  id, kind: 'rest', pitches: [], duration: 'quarter', dots: 0,
  onset: rational(0), time: durationTime('quarter'), tupletIds: [],
  beam: 'auto', stem: 'auto', tie: 'none', measureRest: false, rhythmic: false,
  ...(markings ? { markings } : {}),
});
const collides = (a: InkBox, b: InkBox, gap = 0) => a.x < b.x + b.width + gap && b.x < a.x + a.width + gap
  && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

describe('event marking placement preserves musical meaning', () => {
  it.each(['above', 'below'] as const)('keeps a harmony interval %s regardless of the printed stem', placement => {
    const interval = { id: 'b3', kind: 'interval', interval: { number: 3, alter: -1 }, placement } as const;
    const source = JSON.stringify(interval);
    for (const stem of ['up', 'down', 'none'] as const) {
      expect(eventMarkingPlacement(interval, stem)).toBe(placement);
    }
    expect(JSON.stringify(interval)).toBe(source);
  });

  it.each(ARTICULATION_TYPES)('always places %s opposite the printed stem without rewriting legacy placement', type => {
    for (const authored of ['auto', 'above', 'below'] as const) {
      const marking = articulation(type, authored);
      const source = JSON.stringify(marking);
      expect(eventMarkingPlacement(marking, 'up')).toBe('below');
      expect(eventMarkingPlacement(marking, 'down')).toBe('above');
      expect(eventMarkingPlacement(marking, 'none')).toBe('above');
      expect(JSON.stringify(marking)).toBe(source);
    }
  });

  it.each(ORNAMENT_TYPES)('always places %s opposite the printed stem, including explicit legacy sides', type => {
    for (const authored of ['above', 'below'] as const) {
      const marking = { id: type, kind: 'ornament', type, placement: authored } as const;
      const source = JSON.stringify(marking);
      expect(eventMarkingPlacement(marking, 'up')).toBe('below');
      expect(eventMarkingPlacement(marking, 'down')).toBe('above');
      expect(eventMarkingPlacement(marking, 'none')).toBe('above');
      expect(JSON.stringify(marking)).toBe(source);
    }
  });

  it('orders intervals near the head and longer symbols outward without changing source order', () => {
    const markings: readonly EventMarking[] = [
      { id: 'trill', kind: 'ornament', type: 'trill', placement: 'above' },
      articulation('accent'),
      { id: 'fifth', kind: 'interval', interval: { number: 5, alter: 0 }, placement: 'above' },
      articulation('staccato'),
      { id: 'third', kind: 'interval', interval: { number: 3, alter: -1 }, placement: 'above' },
      articulation('fermata'),
    ];
    const source = JSON.stringify(markings);
    expect([...markings].sort((a, b) => eventMarkingOrder(a) - eventMarkingOrder(b)).map(mark => mark.id))
      .toEqual(['third', 'fifth', 'staccato', 'accent', 'fermata', 'trill']);
    expect(JSON.stringify(markings)).toBe(source);
  });

  it('uses each real head position instead of a common staff annotation lane', () => {
    const higher = placeEventMarking({ head: { x: 40, y: 22, width: 12, height: 16 },
      width: 8, height: 8, placement: 'above', obstacles: [] });
    const middle = placeEventMarking({ head: { x: 90, y: 42, width: 12, height: 16 },
      width: 8, height: 8, placement: 'above', obstacles: [] });
    expect(middle.y - higher.y).toBe(20);
    expect(higher.x + higher.width / 2).toBe(46);
    expect(middle.x + middle.width / 2).toBe(96);
    expect(higher.y + higher.height).toBe(19);
  });

  it('uses a bounded lateral clearance instead of jumping a whole stem', () => {
    const head = { x: 100, y: 80, width: 12, height: 16 };
    const stem = { x: 112, y: 40, width: 1.5, height: 45 };
    const ink = placeEventMarking({ head, width: 16, height: 10, placement: 'above',
      obstacles: [head, stem], lateralShift: 4, preferredShift: -1 });
    expect(ink.y + ink.height).toBe(head.y - 3);
    expect(Math.abs(ink.x + ink.width / 2 - head.x - head.width / 2)).toBe(4);
    expect(collides(ink, stem, 2)).toBe(false);
  });

  it('clears staff lines, ties, beams and brackets without flipping its side', () => {
    const head = { x: 100, y: 80, width: 12, height: 16 };
    const obstacles: InkBox[] = [
      head,
      { x: 0, y: 60, width: 300, height: 1 },
      { x: 95, y: 67, width: 50, height: 10 },
      { x: 90, y: 45, width: 80, height: 5 },
      { x: 70, y: 30, width: 120, height: 9 },
    ];
    const request = { head, width: 15, height: 11, placement: 'above' as const, obstacles };
    const ink = placeEventMarking(request);
    expect(obstacles.every(obstacle => !collides(ink, obstacle, 2))).toBe(true);
    expect(ink.y + ink.height).toBeLessThan(head.y);
    expect(placeEventMarking({ ...request, obstacles: [...obstacles].reverse() })).toEqual(ink);
    const below = placeEventMarking({ ...request, placement: 'below', obstacles: [head,
      { x: 0, y: 102, width: 300, height: 1 }, { x: 95, y: 110, width: 50, height: 12 }] });
    expect(below.y).toBeGreaterThan(head.y + head.height);
    expect(below.y).toBeGreaterThanOrEqual(124);
  });

  it('stacks multiple figures independently from the same head and retains all ink', () => {
    const head = { x: 100, y: 80, width: 12, height: 16 };
    const first = placeEventMarking({ head, width: 8, height: 9, placement: 'above', obstacles: [head] });
    const second = placeEventMarking({ head, width: 15, height: 12, placement: 'above', obstacles: [head, first] });
    expect(second.y + second.height).toBeLessThanOrEqual(first.y - 2);
    expect(first.x + first.width / 2).toBe(head.x + head.width / 2);
    expect(second.x + second.width / 2).toBe(head.x + head.width / 2);
  });

  it('keeps conventional fermatas and ornaments outside the actual staff bounds', () => {
    const head = { x: 100, y: 60, width: 12, height: 10 };
    const ink = placeEventMarking({ head, width: 15, height: 9, placement: 'above',
      outsideStaff: { top: 40, bottom: 80 }, obstacles: [head] });
    expect(ink.y + ink.height).toBeLessThanOrEqual(36);
    const oneLine = placeEventMarking({ head, width: 15, height: 9, placement: 'below',
      outsideStaff: { top: 65, bottom: 65 }, obstacles: [head] });
    expect(oneLine.y).toBeGreaterThanOrEqual(73);
  });

  it('does not coalesce marked rests and silently drop a fermata or its source identity', () => {
    const a = rest('a');
    const b = rest('b');
    expect(canShareRest(a, b)).toBe(true);
    expect(canShareRest({ ...a, markings: [] }, b)).toBe(true);
    const marked = rest('marked', [articulation('fermata')]);
    expect(canShareRest(a, marked)).toBe(false);
    expect(canShareRest(marked, a)).toBe(false);
    expect(canShareRest(marked, rest('other', [{ ...articulation('fermata'), id: 'other-fermata' }]))).toBe(false);
  });
});
