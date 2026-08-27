/** Visible ink in SVG coordinates, not a font's em box or an invisible hit area. */
export interface InkBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function unionInk(boxes: readonly InkBox[]): InkBox | undefined {
  if (!boxes.length) return undefined;
  const x = Math.min(...boxes.map(box => box.x));
  const y = Math.min(...boxes.map(box => box.y));
  return {
    x, y,
    width: Math.max(...boxes.map(box => box.x + box.width)) - x,
    height: Math.max(...boxes.map(box => box.y + box.height)) - y,
  };
}

export function moveInk(box: InkBox, x: number, y: number): InkBox {
  return { ...box, x: box.x + x, y: box.y + y };
}

/** A small horizontal gutter also protects italic overhang and adjacent marks. */
export function overlapsInkX(left: InkBox, right: InkBox, gutter = 3): boolean {
  return left.x < right.x + right.width + gutter && right.x < left.x + left.width + gutter;
}

interface Transform { a: number; b: number; c: number; d: number; e: number; f: number }

export function transformInk(box: InkBox, matrix: Transform): InkBox {
  const points = [
    [box.x, box.y], [box.x + box.width, box.y],
    [box.x, box.y + box.height], [box.x + box.width, box.y + box.height],
  ].map(([x, y]) => ({ x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f }));
  const x = Math.min(...points.map(point => point.x));
  const y = Math.min(...points.map(point => point.y));
  return { x, y, width: Math.max(...points.map(point => point.x)) - x, height: Math.max(...points.map(point => point.y)) - y };
}

let measurementContext: CanvasRenderingContext2D | undefined;
const textMetrics = new Map<string, TextMetrics>();

function measureText(text: string, font: string): TextMetrics {
  const key = `${font}\n${text}`;
  const cached = textMetrics.get(key);
  if (cached) return cached;
  measurementContext ??= document.createElement('canvas').getContext('2d') ?? undefined;
  if (!measurementContext) throw new Error('This browser cannot measure the notation fonts.');
  measurementContext.font = font;
  measurementContext.textAlign = 'left';
  measurementContext.textBaseline = 'alphabetic';
  const metrics = measurementContext.measureText(text);
  if (textMetrics.size >= 4096) textMetrics.clear();
  textMetrics.set(key, metrics);
  return metrics;
}

/**
 * VexFlow emits simple, alphabetic-baseline SVG text. SVG getBBox includes the
 * entire Bravura em box (about 161px for a 40px glyph), so use the font's actual
 * painted bounds. Paths and shapes still use native SVG geometry. Transparent
 * VexFlow pointer rectangles are deliberately excluded. A hidden measurement
 * projection remains measurable; visibility:hidden is not missing musical ink.
 */
export function visibleInk(root: SVGGraphicsElement, relativeTo: SVGGraphicsElement = root): InkBox[] {
  const boxes: InkBox[] = [];
  const inverse = relativeTo.getCTM()?.inverse();
  const leaves = root.matches('text,path,rect,line,circle,ellipse,polygon,polyline') ? [root]
    : [...root.querySelectorAll<SVGGraphicsElement>('text,path,rect,line,circle,ellipse,polygon,polyline')];
  for (const leaf of leaves) {
    const style = getComputedStyle(leaf);
    if (Number(style.opacity) === 0 || (style.fill === 'none' && style.stroke === 'none')) continue;
    let box: InkBox;
    if (leaf instanceof SVGTextElement) {
      const metrics = measureText(leaf.textContent ?? '', `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`);
      const advance = style.textAnchor === 'middle' ? metrics.width / 2 : style.textAnchor === 'end' ? metrics.width : 0;
      box = {
        x: (leaf.x.baseVal[0]?.value ?? 0) - advance - metrics.actualBoundingBoxLeft,
        y: (leaf.y.baseVal[0]?.value ?? 0) - metrics.actualBoundingBoxAscent,
        width: metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight,
        height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
      };
    } else {
      const bounds = leaf.getBBox();
      const stroke = style.stroke === 'none' ? 0 : (Number.parseFloat(style.strokeWidth) || 0) / 2;
      box = { x: bounds.x - stroke, y: bounds.y - stroke, width: bounds.width + 2 * stroke, height: bounds.height + 2 * stroke };
    }
    if (box.width <= 0 || box.height <= 0) continue;
    const matrix = leaf.getCTM();
    boxes.push(inverse && matrix ? transformInk(box, inverse.multiply(matrix)) : box);
  }
  return boxes;
}
