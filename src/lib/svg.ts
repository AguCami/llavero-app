import { Color, Path, Shape, SRGBColorSpace, Vector2 } from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { outlineShapes } from './outline';
import { DEFAULT_LAYER_HEIGHT, DEFAULT_LAYER_TRANSFORM, type Bounds, type Layer } from './types';

/** Detalle del rasterizado al fundir y recortar capas (píxeles del lado mayor). */
const MERGE_DETAIL = 1100;

/** Cuántos segmentos se usan al convertir curvas Bézier en polilíneas. */
const CURVE_SEGMENTS = 40;
/** Dos puntos más cercanos que esto (en unidades normalizadas) se consideran el mismo. */
const EPSILON = 1e-6;

/**
 * Cómo se reparte el dibujo en capas:
 * - `single`: todo el dibujo fundido en una sola pieza.
 * - `color`: una capa por familia de color, recortadas por orden de pintado.
 * - `raw`: un trazo, una capa; sin fundir nada.
 */
export type ParseMode = 'single' | 'color' | 'raw';

export interface ParsedSvg {
  layers: Layer[];
  /** Trazos que se fundieron al agrupar por color. */
  groupedPaths: number;
  /** Capas descartadas por quedar tapadas del todo por las de encima. */
  coveredLayers: number;
  /** Relación alto/ancho del dibujo original. */
  aspect: number;
  /** Trazos que sólo tenían `stroke` y se rellenaron para poder extruirlos. */
  strokeOnlyPaths: number;
  /** Trazos descartados por quedar vacíos tras el saneado. */
  droppedPaths: number;
  /** Trazos invisibles en el SVG (sin relleno, transparentes u ocultos). */
  invisiblePaths: number;
  /** Nombre del trazo ocultado por parecer el fondo del archivo, si lo hubo. */
  backgroundLayer: string | null;
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

/** ¿El nodo o alguno de sus ancestros está oculto en el propio SVG? */
function isHiddenNode(node: Element | undefined): boolean {
  let current: Element | null = node ?? null;
  while (current && current.nodeName.toLowerCase() !== 'svg') {
    const style = current.getAttribute('style') ?? '';
    if (current.getAttribute('display') === 'none' || /display\s*:\s*none/.test(style)) return true;
    if (current.getAttribute('visibility') === 'hidden' || /visibility\s*:\s*hidden/.test(style)) return true;
    current = current.parentElement;
  }
  return false;
}

/**
 * ¿El trazo pinta algo? `SVGLoader` devuelve también los trazos sin relleno y
 * los transparentes; si no se filtran, un rectángulo de fondo invisible se
 * convierte en una capa sólida que tapa el dibujo entero.
 */
function isVisible(path: { userData?: { style?: Record<string, string>; node?: Element } }): boolean {
  const style = path.userData?.style;
  if (!style) return true;
  if (isHiddenNode(path.userData?.node)) return false;

  const opacity = Number(style.opacity ?? 1);
  if (Number.isFinite(opacity) && opacity <= 0.001) return false;

  const hasFill = !!style.fill && style.fill !== 'none';
  const fillOpacity = Number(style.fillOpacity ?? 1);
  const fillVisible = hasFill && (!Number.isFinite(fillOpacity) || fillOpacity > 0.001);

  const hasStroke = !!style.stroke && style.stroke !== 'none';
  const strokeOpacity = Number(style.strokeOpacity ?? 1);
  const strokeVisible = hasStroke && (!Number.isFinite(strokeOpacity) || strokeOpacity > 0.001);

  return fillVisible || strokeVisible;
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

/** Área del contorno menos la de sus huecos. */
function shapeArea(rings: RawShape[]): number {
  let area = 0;
  for (const ring of rings) {
    area += Math.abs(polygonArea(ring.contour));
    for (const hole of ring.holes) area -= Math.abs(polygonArea(hole));
  }
  return area;
}

function boundsArea(bounds: Bounds): number {
  return Math.max(0, bounds.maxX - bounds.minX) * Math.max(0, bounds.maxY - bounds.minY);
}

function contains(outer: Bounds, inner: Bounds, tolerance: number): boolean {
  return (
    outer.minX <= inner.minX + tolerance &&
    outer.minY <= inner.minY + tolerance &&
    outer.maxX >= inner.maxX - tolerance &&
    outer.maxY >= inner.maxY - tolerance
  );
}

/**
 * ¿El primer trazo es el rectángulo de fondo del archivo? Lo es cuando ocupa
 * su caja por completo (o sea, es un rectángulo) y encierra a todo lo demás
 * con holgura. Muchos exportadores lo añaden aunque se vea "sin fondo".
 */
function looksLikeBackground(first: RawShape[], rest: RawShape[]): boolean {
  if (!rest.length) return false;
  const box = boundsOf(first);
  const boxArea = boundsArea(box);
  if (boxArea <= 0) return false;
  // Un rectángulo llena su caja; un logo cualquiera deja mucho aire.
  if (shapeArea(first) < boxArea * 0.95) return false;
  if (first.some((ring) => ring.contour.length > 8 || ring.holes.length)) return false;

  const contentBox = boundsOf(rest);
  const tolerance = Math.max(box.maxX - box.minX, box.maxY - box.minY) * 0.01;
  if (!contains(box, contentBox, tolerance)) return false;
  // Si el contenido llena casi toda la caja, no es un fondo: es parte del dibujo.
  return boundsArea(contentBox) < boxArea * 0.92;
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

/** Nombre corriente de un color, para que las capas se reconozcan de un vistazo. */
function colorName(hex: string): string {
  const hsl = { h: 0, s: 0, l: 0 };
  // Sin indicar el espacio, `getHSL` responde en lineal-sRGB y los tonos salen
  // corridos y oscurecidos: un naranja se leería como rojo.
  new Color(hex).getHSL(hsl, SRGBColorSpace);
  const hue = hsl.h * 360;
  if (hsl.l < 0.1) return 'Negro';
  if (hsl.l > 0.9 && hsl.s < 0.32) return 'Blanco';
  if (hsl.s < 0.15) return hsl.l > 0.62 ? 'Gris claro' : hsl.l < 0.34 ? 'Gris oscuro' : 'Gris';

  const scale: [number, string][] = [
    [15, 'Rojo'],
    [42, 'Naranja'],
    [66, 'Amarillo'],
    [150, 'Verde'],
    [196, 'Turquesa'],
    [255, 'Azul'],
    [288, 'Violeta'],
    [335, 'Rosa'],
    [360, 'Rojo'],
  ];
  const base = scale.find(([max]) => hue <= max)?.[1] ?? 'Color';
  if (hsl.l > 0.74) return `${base} claro`;
  if (hsl.l < 0.3) return `${base} oscuro`;
  return base;
}

/** Superficie de las formas ya construidas: contorno menos huecos. */
function shapesArea(shapes: Shape[]): number {
  let area = 0;
  for (const shape of shapes) {
    const { shape: contour, holes } = shape.extractPoints(12);
    area += Math.abs(polygonArea(contour as Vector2[]));
    for (const hole of holes as Vector2[][]) area -= Math.abs(polygonArea(hole));
  }
  return area;
}

/** Ruta SVG de la capa, en el mismo encuadre para todas (Y hacia abajo). */
function previewPath(shapes: Shape[]): string {
  const ring = (points: Vector2[]) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(4)} ${(-p.y).toFixed(4)}`).join('') + 'Z';
  return shapes
    .map((shape) => {
      const { shape: contour, holes } = shape.extractPoints(12);
      return [ring(contour as Vector2[]), ...(holes as Vector2[][]).map(ring)].join('');
    })
    .join('');
}

/**
 * Convierte un SVG en capas listas para extruir.
 *
 * El dibujo se normaliza: eje Y hacia arriba, centrado en el origen y con
 * ancho 1. El tamaño real en milímetros se aplica al construir el modelo.
 */
export function parseSvg(svgText: string, mode: ParseMode = 'color'): ParsedSvg {
  const groupByColor = mode !== 'raw';
  const data = new SVGLoader().parse(svgText);
  if (!data.paths.length) {
    throw new Error('El archivo no contiene trazos vectoriales. Exportalo como SVG con formas, no como imagen incrustada.');
  }

  let strokeOnlyPaths = 0;
  let droppedPaths = 0;
  let invisiblePaths = 0;

  const entries: { rings: RawShape[]; color: string; name: string }[] = [];
  data.paths.forEach((path, index) => {
    if (!isVisible(path)) {
      invisiblePaths += 1;
      return;
    }
    const style = path.userData?.style as Record<string, string> | undefined;
    const hasFill = !!style?.fill && style.fill !== 'none';
    if (!hasFill && style?.stroke && style.stroke !== 'none') strokeOnlyPaths += 1;

    const rings = path
      .toShapes()
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

  // El fondo se detecta antes de agrupar: si no, podría fundirse con una
  // forma del mismo color y dejaría de poder ocultarse por su cuenta.
  const backgroundFirst =
    entries.length > 1 && looksLikeBackground(entries[0].rings, entries.slice(1).flatMap((e) => e.rings));

  // Agrupar deja una capa por tinta (o una sola para todo el dibujo) en vez de
  // una por trazo: un logo real trae decenas de trazos y la lista se vuelve
  // inmanejable.
  let groupedPaths = 0;
  if (mode === 'single') {
    const background = backgroundFirst ? entries[0] : null;
    const art = backgroundFirst ? entries.slice(1) : entries;
    // El color de la pieza es el del trazo que más superficie ocupa.
    const dominant = art.reduce((best, entry) => (shapeArea(entry.rings) > shapeArea(best.rings) ? entry : best), art[0]);
    const merged = { rings: art.flatMap((entry) => entry.rings), color: dominant.color, name: 'Dibujo' };
    groupedPaths = art.length - 1;
    entries.length = 0;
    entries.push(...(background ? [background, merged] : [merged]));
  } else if (groupByColor) {
    const groups = new Map<string, (typeof entries)[number]>();
    const top = new Map<string, number>();
    entries.forEach((entry, index) => {
      // Se agrupa por familia de color, no por hex exacto: una ilustración
      // trae decenas de blancos y grises casi idénticos que son la misma tinta.
      const key = backgroundFirst && index === 0 ? '#fondo' : colorName(entry.color);
      const existing = groups.get(key);
      if (existing) {
        existing.rings.push(...entry.rings);
        groupedPaths += 1;
      } else {
        groups.set(key, { ...entry, rings: [...entry.rings] });
      }
      // Una tinta se apila donde aparece por última vez. Si se apilara donde
      // aparece por primera vez, las partes que el dibujo pinta por encima de
      // otra tinta (los ojos sobre la cara) las borraría el recorte.
      top.set(key, index);
    });
    const order = [...groups.keys()].sort((a, b) => (top.get(a) ?? 0) - (top.get(b) ?? 0));
    entries.length = 0;
    entries.push(...order.map((key) => groups.get(key)!));
  }

  // El fondo se oculta y, sobre todo, no cuenta para el encuadre: si contase,
  // el dibujo saldría más chico que el ancho pedido.
  const backgroundIndex = backgroundFirst ? 0 : -1;
  const visibleEntries = entries.filter((_, index) => index !== backgroundIndex);

  const bounds = boundsOf(visibleEntries.flatMap((e) => e.rings));
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

  const used = new Map<string, number>();
  const nameFor = (entry: (typeof entries)[number]) => {
    if (!groupByColor || entry.name === 'Dibujo') return entry.name;
    const base = colorName(entry.color);
    const seen = (used.get(base) ?? 0) + 1;
    used.set(base, seen);
    return seen === 1 ? base : `${base} ${seen}`;
  };

  let shapesByEntry = entries.map((entry) => entry.rings.map((ring) => ringsToShape(ring, transform)));

  if (groupByColor) {
    // Cada capa se funde en un sólido y se recorta con las de encima, igual
    // que las pinta el SVG. Si no, decenas de formas superpuestas comparten
    // caras y el resultado se ve rayado (y el STL queda lleno de tabiques).
    shapesByEntry = shapesByEntry.map((shapes, index) => {
      const above = shapesByEntry.slice(index + 1).flat();
      return outlineShapes(shapes, {
        margin: 0,
        smoothing: 0,
        subtract: above,
        detail: MERGE_DETAIL,
      });
    });
  }

  const layers: Layer[] = entries.map((entry, index) => ({
    id: `layer-${index}-${Math.random().toString(36).slice(2, 8)}`,
    name: nameFor(entry),
    preview: previewPath(shapesByEntry[index]),
    area: shapesArea(shapesByEntry[index]),
    shapes: shapesByEntry[index],
    color: entry.color,
    mode: index === backgroundIndex ? 'hidden' : 'relief',
    height: DEFAULT_LAYER_HEIGHT,
    bevel: 0,
    ...DEFAULT_LAYER_TRANSFORM,
  }));

  const visible = layers.filter((layer) => layer.shapes.length > 0);

  return {
    layers: visible,
    aspect: rawHeight / rawWidth,
    strokeOnlyPaths,
    droppedPaths,
    invisiblePaths,
    groupedPaths,
    coveredLayers: layers.length - visible.length,
    backgroundLayer: backgroundIndex >= 0 ? layers[backgroundIndex].name : null,
  };
}
