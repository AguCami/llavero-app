import { Color, Path, Shape, Vector2 } from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { DEFAULT_LAYER_HEIGHT, type Bounds, type Layer } from './types';

/** Cuántos segmentos se usan al convertir curvas Bézier en polilíneas. */
const CURVE_SEGMENTS = 40;
/** Dos puntos más cercanos que esto (en unidades normalizadas) se consideran el mismo. */
const EPSILON = 1e-6;

export interface ParsedSvg {
  layers: Layer[];
  /** Relación alto/ancho del dibujo original. */
  aspect: number;
  /** Trazos que sólo tenían `stroke` y se rellenaron para poder extruirlos. */
  strokeOnlyPaths: number;
  /** Trazos descartados por quedar vacíos tras el saneado. */
  droppedPaths: number;
}

function polygonArea(points: Vector2[]): number {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += (points[j].x + points[i].x) * (points[j].y - points[i].y);
  }
  return area / 2;
}

/** Quita puntos repetidos y cierra implícitamente el contorno. */
function cleanRing(points: Vector2[]): Vector2[] {
  const out: Vector2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > EPSILON || Math.abs(last.y - p.y) > EPSILON) {
      out.push(p.clone());
    }
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last && Math.abs(first.x - last.x) < EPSILON && Math.abs(first.y - last.y) < EPSILON) {
    out.pop();
  }
  return out;
}

interface RawShape {
  contour: Vector2[];
  holes: Vector2[][];
}

function shapeToRings(shape: Shape): RawShape | null {
  const { shape: contour, holes } = shape.extractPoints(CURVE_SEGMENTS);
  const cleanContour = cleanRing(contour as Vector2[]);
  if (cleanContour.length < 3) return null;
  const cleanHoles = (holes as Vector2[][])
    .map(cleanRing)
    .filter((hole) => hole.length >= 3 && Math.abs(polygonArea(hole)) > EPSILON);
  return { contour: cleanContour, holes: cleanHoles };
}

function boundsOf(rings: RawShape[]): Bounds {
  const bounds: Bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  for (const ring of rings) {
    for (const p of ring.contour) {
      bounds.minX = Math.min(bounds.minX, p.x);
      bounds.minY = Math.min(bounds.minY, p.y);
      bounds.maxX = Math.max(bounds.maxX, p.x);
      bounds.maxY = Math.max(bounds.maxY, p.y);
    }
  }
  return bounds;
}

function ringsToShape(raw: RawShape, transform: (p: Vector2) => Vector2): Shape {
  const shape = new Shape(raw.contour.map(transform));
  for (const hole of raw.holes) {
    shape.holes.push(new Path(hole.map(transform)));
  }
  return shape;
}

function toHex(value: string): string | null {
  try {
    return `#${new Color(value).getHexString()}`;
  } catch {
    return null;
  }
}

/** Color de vista previa de la capa, siempre en formato `#rrggbb`. */
function colorOf(path: { color?: Color }, style: Record<string, string> | undefined): string {
  const fill = style?.fill;
  if (fill && fill !== 'none' && !fill.startsWith('url(')) {
    // `path.color` ya resolvió nombres de color, `currentColor`, etc.
    return path.color ? `#${path.color.getHexString()}` : toHex(fill) ?? '#8b8b8b';
  }
  const stroke = style?.stroke;
  if (stroke && stroke !== 'none' && !stroke.startsWith('url(')) return toHex(stroke) ?? '#8b8b8b';
  return path.color ? `#${path.color.getHexString()}` : '#8b8b8b';
}

/**
 * Convierte un SVG en capas listas para extruir.
 *
 * El dibujo se normaliza: eje Y hacia arriba, centrado en el origen y con
 * ancho 1. El tamaño real en milímetros se aplica al construir el modelo.
 */
export function parseSvg(svgText: string): ParsedSvg {
  const data = new SVGLoader().parse(svgText);
  if (!data.paths.length) {
    throw new Error('El archivo no contiene trazos vectoriales. Exportalo como SVG con formas, no como imagen incrustada.');
  }

  let strokeOnlyPaths = 0;
  let droppedPaths = 0;

  const entries: { rings: RawShape[]; color: string; name: string }[] = [];
  data.paths.forEach((path, index) => {
    const style = path.userData?.style as Record<string, string> | undefined;
    const hasFill = !!style?.fill && style.fill !== 'none';
    if (!hasFill && style?.stroke && style.stroke !== 'none') strokeOnlyPaths += 1;

    const rings = SVGLoader.createShapes(path)
      .map(shapeToRings)
      .filter((r): r is RawShape => r !== null);

    if (!rings.length) {
      droppedPaths += 1;
      return;
    }
    const id = (path.userData?.node as Element | undefined)?.id;
    entries.push({
      rings,
      color: colorOf(path, style),
      name: id && id.trim() ? id : `Trazo ${index + 1}`,
    });
  });

  if (!entries.length) {
    throw new Error('No se pudo extraer ninguna forma cerrada del SVG.');
  }

  const bounds = boundsOf(entries.flatMap((e) => e.rings));
  const rawWidth = bounds.maxX - bounds.minX;
  const rawHeight = bounds.maxY - bounds.minY;
  if (!(rawWidth > 0) || !(rawHeight > 0)) {
    throw new Error('El dibujo del SVG no tiene superficie.');
  }

  const scale = 1 / rawWidth;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  // El SVG tiene el eje Y hacia abajo: al invertirlo queda con Y hacia arriba.
  const transform = (p: Vector2) => new Vector2((p.x - cx) * scale, -(p.y - cy) * scale);

  const layers: Layer[] = entries.map((entry, index) => ({
    id: `layer-${index}-${Math.random().toString(36).slice(2, 8)}`,
    name: entry.name,
    shapes: entry.rings.map((ring) => ringsToShape(ring, transform)),
    color: entry.color,
    mode: 'relief',
    height: DEFAULT_LAYER_HEIGHT,
    bevel: 0,
  }));

  return { layers, aspect: rawHeight / rawWidth, strokeOnlyPaths, droppedPaths };
}
