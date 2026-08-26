import { Path, Shape, Vector2 } from 'three';

/**
 * Genera el contorno exterior del dibujo con un margen uniforme, al estilo
 * "sticker": se rasteriza la silueta, se dilata con una transformada de
 * distancia y se vuelve a vectorizar con marching squares.
 */

const MAX_RESOLUTION = 1100;
const MIN_RESOLUTION = 220;
/** Segmentos por curva al convertir las formas en polilíneas para rasterizar. */
const CONTOUR_SEGMENTS = 24;
/**
 * Tolerancia de simplificación del contorno, en píxeles de la rejilla. Un
 * contorno con vértices muy juntos hace que los chaflanes se auto-intersequen.
 */
const TOLERANCE_PIXELS = 1.5;

interface Field {
  /** Valor por nodo; positivo = dentro de la figura resultante. */
  values: Float64Array;
  /** 1 = píxel cubierto por el dibujo original. */
  mask: Uint8Array;
  width: number;
  height: number;
  step: number;
  /** Coordenada de mundo del nodo (0,0). */
  originX: number;
  originY: number;
}

/** Transformada de distancia euclídea exacta (Felzenszwalb & Huttenlocher). */
function distanceTransform(binary: Uint8Array, width: number, height: number): Float64Array {
  const INF = 1e20;
  const grid = new Float64Array(width * height);
  for (let i = 0; i < grid.length; i++) grid[i] = binary[i] ? 0 : INF;

  const size = Math.max(width, height);
  const f = new Float64Array(size);
  const d = new Float64Array(size);
  const v = new Int32Array(size);
  const z = new Float64Array(size + 1);

  const transform1d = (n: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x];
    transform1d(height);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y];
  }
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) f[x] = grid[row + x];
    transform1d(width);
    for (let x = 0; x < width; x++) grid[row + x] = Math.sqrt(d[x]);
  }
  return grid;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boxOf(rings: Vector2[][]): Box {
  const box: Box = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  for (const ring of rings) {
    for (const p of ring) {
      box.minX = Math.min(box.minX, p.x);
      box.minY = Math.min(box.minY, p.y);
      box.maxX = Math.max(box.maxX, p.x);
      box.maxY = Math.max(box.maxY, p.y);
    }
  }
  return box;
}

/** Anillos de una forma (contorno + huecos) como polilíneas. */
function shapeRings(shape: Shape): Vector2[][] {
  return [shape.getPoints(CONTOUR_SEGMENTS), ...shape.holes.map((hole) => hole.getPoints(CONTOUR_SEGMENTS))];
}

/**
 * Rellena las formas en una rejilla de píxeles. Se hace a mano (sin canvas)
 * para poder ejecutarlo también fuera del navegador.
 *
 * Cada forma se rellena por separado con la regla par-impar (que resuelve sus
 * huecos) y el resultado se acumula: así dos formas que se solapan se funden
 * en una. Rellenarlas todas juntas las cancelaría en el solape, dejando un
 * agujero justo donde tenían que unirse.
 */
function rasterize(shapes: Vector2[][][], subtract: Vector2[][][], box: Box, padding: number, step: number): Field {
  const minX = box.minX - padding;
  const minY = box.minY - padding;
  const maxX = box.maxX + padding;
  const maxY = box.maxY + padding;

  const width = Math.max(4, Math.ceil((maxX - minX) / step) + 1);
  const height = Math.max(4, Math.ceil((maxY - minY) / step) + 1);
  const mask = new Uint8Array(width * height);
  // Centro del píxel (0,0); la fila 0 es la parte superior del dibujo.
  const originX = minX + step / 2;
  const originY = maxY - step / 2;

  const crossings: number[] = [];
  const fill = (rings: Vector2[][], y: number, row: number, value: 0 | 1) => {
    crossings.length = 0;
    for (const ring of rings) {
      for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
        const a = ring[k];
        const b = ring[i];
        if (a.y === b.y) continue;
        if (y < Math.min(a.y, b.y) || y >= Math.max(a.y, b.y)) continue;
        crossings.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    if (crossings.length < 2) return;
    crossings.sort((p, q) => p - q);
    for (let c = 0; c + 1 < crossings.length; c += 2) {
      // Píxeles cuyo centro cae dentro del tramo [x0, x1].
      const from = Math.ceil((crossings[c] - originX) / step);
      const to = Math.floor((crossings[c + 1] - originX) / step);
      for (let i = Math.max(0, from); i <= Math.min(width - 1, to); i++) mask[row + i] = value;
    }
  };

  for (let j = 0; j < height; j++) {
    const y = originY - j * step;
    const row = j * width;
    for (const rings of shapes) fill(rings, y, row, 1);
    // Lo que se resta se borra después, así vale para cualquier solape.
    for (const rings of subtract) fill(rings, y, row, 0);
  }

  return {
    values: new Float64Array(mask.length),
    mask,
    width,
    height,
    step,
    originX,
    originY,
  };
}

function nodeX(field: Field, i: number): number {
  return field.originX + i * field.step;
}

function nodeY(field: Field, j: number): number {
  return field.originY - j * field.step;
}

interface Loop {
  points: Vector2[];
  area: number;
}

/** Extrae las isolíneas de nivel 0 del campo con marching squares. */
function marchingSquares(field: Field): Loop[] {
  const { values, width, height } = field;
  const at = (i: number, j: number) => values[j * width + i];
  const segments: [Vector2, Vector2][] = [];

  const lerp = (ax: number, ay: number, av: number, bx: number, by: number, bv: number) => {
    const t = av / (av - bv);
    return new Vector2(ax + (bx - ax) * t, ay + (by - ay) * t);
  };

  for (let j = 0; j < height - 1; j++) {
    for (let i = 0; i < width - 1; i++) {
      const v0 = at(i, j); // arriba-izquierda
      const v1 = at(i + 1, j); // arriba-derecha
      const v2 = at(i + 1, j + 1); // abajo-derecha
      const v3 = at(i, j + 1); // abajo-izquierda
      let code = 0;
      if (v0 > 0) code |= 8;
      if (v1 > 0) code |= 4;
      if (v2 > 0) code |= 2;
      if (v3 > 0) code |= 1;
      if (code === 0 || code === 15) continue;

      const x0 = nodeX(field, i);
      const x1 = nodeX(field, i + 1);
      const y0 = nodeY(field, j);
      const y1 = nodeY(field, j + 1);

      const top = () => lerp(x0, y0, v0, x1, y0, v1);
      const right = () => lerp(x1, y0, v1, x1, y1, v2);
      const bottom = () => lerp(x0, y1, v3, x1, y1, v2);
      const left = () => lerp(x0, y0, v0, x0, y1, v3);

      // Los segmentos se orientan dejando el interior (valor > 0) a la izquierda.
      const push = (a: Vector2, b: Vector2) => segments.push([a, b]);
      switch (code) {
        case 1: push(bottom(), left()); break;
        case 2: push(right(), bottom()); break;
        case 3: push(right(), left()); break;
        case 4: push(top(), right()); break;
        case 5: {
          const center = (v0 + v1 + v2 + v3) / 4;
          if (center > 0) { push(top(), left()); push(bottom(), right()); }
          else { push(top(), right()); push(bottom(), left()); }
          break;
        }
        case 6: push(top(), bottom()); break;
        case 7: push(top(), left()); break;
        case 8: push(left(), top()); break;
        case 9: push(bottom(), top()); break;
        case 10: {
          const center = (v0 + v1 + v2 + v3) / 4;
          if (center > 0) { push(left(), bottom()); push(right(), top()); }
          else { push(left(), top()); push(right(), bottom()); }
          break;
        }
        case 11: push(right(), top()); break;
        case 12: push(left(), right()); break;
        case 13: push(bottom(), right()); break;
        case 14: push(left(), bottom()); break;
      }
    }
  }

  // Encadenar segmentos por extremos coincidentes.
  const precision = field.step * 1e-3;
  const key = (p: Vector2) => `${Math.round(p.x / precision)}|${Math.round(p.y / precision)}`;
  const startMap = new Map<string, number[]>();
  segments.forEach(([a], index) => {
    const k = key(a);
    const list = startMap.get(k);
    if (list) list.push(index);
    else startMap.set(k, [index]);
  });

  const used = new Uint8Array(segments.length);
  const loops: Loop[] = [];
  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    const points: Vector2[] = [segments[start][0]];
    let current = start;
    used[current] = 1;
    for (;;) {
      const end = segments[current][1];
      const candidates = startMap.get(key(end));
      const next = candidates?.find((index) => !used[index]);
      if (next === undefined) break;
      points.push(segments[next][0]);
      used[next] = 1;
      current = next;
    }
    if (points.length < 3) continue;
    let area = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      area += (points[j].x + points[i].x) * (points[j].y - points[i].y);
    }
    loops.push({ points, area: -area / 2 });
  }
  return loops;
}

/** Simplificación Douglas–Peucker sobre un anillo cerrado. */
function simplify(points: Vector2[], tolerance: number): Vector2[] {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    if (last - first < 2) continue;
    const a = points[first];
    const b = points[last];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    let maxDist = -1;
    let maxIndex = first;
    for (let i = first + 1; i < last; i++) {
      const p = points[i];
      let dist: number;
      if (lengthSq === 0) {
        dist = p.distanceTo(a);
      } else {
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
        dist = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
      }
      if (dist > maxDist) {
        maxDist = dist;
        maxIndex = i;
      }
    }
    if (maxDist > tolerance) {
      keep[maxIndex] = 1;
      stack.push([first, maxIndex], [maxIndex, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

function pointInPolygon(point: Vector2, polygon: Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export interface OutlineOptions {
  /** Margen alrededor del dibujo, en las mismas unidades que las formas. */
  margin: number;
  /** 0 = contorno fiel, 1 = muy redondeado (cierra recovecos estrechos). */
  smoothing: number;
  /**
   * Radio de acuerdo de los entrantes, en unidades de mundo. Si se indica,
   * sustituye al valor derivado de `smoothing`.
   */
  fillet?: number;
  /** Formas a restar del resultado (agujeros de cualquier solape). */
  subtract?: Shape[];
}

/**
 * Devuelve el contorno del conjunto de formas, engordado `margin` unidades.
 * Un `margin` de 0 con `smoothing` 0 devuelve prácticamente la silueta unida.
 */
export function outlineShapes(shapes: Shape[], options: OutlineOptions): Shape[] {
  if (!shapes.length) return [];
  const perShape = shapes.map(shapeRings);
  const perSubtract = (options.subtract ?? []).map(shapeRings);
  const box = boxOf(perShape.flat());
  if (!Number.isFinite(box.minX)) return [];

  const margin = Math.max(0, options.margin);
  const smoothing = Math.max(0, Math.min(1, options.smoothing));
  // El redondeo es un cierre morfológico: primero se dilata y después se erosiona.
  const closing =
    options.fillet !== undefined
      ? Math.max(0, options.fillet)
      : smoothing * Math.max(margin, (box.maxX - box.minX) * 0.05) * 1.2;
  const grown = margin + closing;

  // La resolución se fija sobre el dibujo, de modo que un margen grande no baje el detalle.
  const drawingExtent = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1e-6);
  const extent = drawingExtent + 2 * grown;
  const detail = Math.round(700 * (extent / drawingExtent));
  const step = extent / Math.min(MAX_RESOLUTION, Math.max(MIN_RESOLUTION, detail));
  // Se deja un borde de varios píxeles para que las isolíneas cierren dentro de la rejilla.
  const padding = grown + step * 4;

  const field = rasterize(perShape, perSubtract, box, padding, step);
  const mask = field.mask;
  const outsideDistance = distanceTransform(mask, field.width, field.height);

  if (closing > 0) {
    const dilated = new Uint8Array(mask.length);
    for (let i = 0; i < mask.length; i++) dilated[i] = outsideDistance[i] * step <= grown ? 1 : 0;
    // Erosión: distancia de cada píxel al exterior de la región dilatada.
    const inverted = new Uint8Array(mask.length);
    for (let i = 0; i < mask.length; i++) inverted[i] = dilated[i] ? 0 : 1;
    const insideDistance = distanceTransform(inverted, field.width, field.height);
    const level = Math.max(closing, step * 0.5);
    for (let i = 0; i < mask.length; i++) field.values[i] = insideDistance[i] * step - level;
  } else {
    // Con margen 0 se usa medio píxel para recuperar la silueta unida.
    const level = Math.max(margin, step * 0.5);
    for (let i = 0; i < mask.length; i++) field.values[i] = level - outsideDistance[i] * step;
  }

  const loops = marchingSquares(field);
  const tolerance = field.step * TOLERANCE_PIXELS;
  const simplified = loops
    .map((loop) => ({ ...loop, points: simplify(loop.points, tolerance) }))
    .filter((loop) => loop.points.length >= 3 && Math.abs(loop.area) > field.step * field.step * 4);

  const outers = simplified.filter((loop) => loop.area > 0).sort((a, b) => b.area - a.area);
  const holes = simplified.filter((loop) => loop.area <= 0);

  return outers.map((outer, index) => {
    const shape = new Shape(outer.points);
    for (const hole of holes) {
      // Cada hueco pertenece al contorno más pequeño que lo contiene.
      const owner = outers.findLastIndex((candidate) => pointInPolygon(hole.points[0], candidate.points));
      if (owner === index) shape.holes.push(new Path(hole.points));
    }
    return shape;
  });
}
