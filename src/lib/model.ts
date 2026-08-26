import {
  BufferGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Path,
  Shape,
  Vector2,
} from 'three';
import { outlineShapes } from './outline';
import type { Layer, ModelSettings } from './types';

export interface ModelStats {
  /** Dimensiones finales en mm. */
  width: number;
  depth: number;
  height: number;
  triangles: number;
  /** Volumen de material en cm³. */
  volume: number;
}

export interface BuiltModel {
  group: Group;
  stats: ModelStats;
  warnings: string[];
}

const CURVE_SEGMENTS = 24;

function transformShapes(shapes: Shape[], settings: ModelSettings): Shape[] {
  const scale = settings.width;
  const mirror = settings.mirror ? -1 : 1;
  const angle = (settings.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const apply = (p: Vector2) => {
    const x = p.x * scale * mirror;
    const y = p.y * scale;
    return new Vector2(x * cos - y * sin, x * sin + y * cos);
  };
  return shapes.map((shape) => {
    const { shape: contour, holes } = shape.extractPoints(CURVE_SEGMENTS);
    const next = new Shape((contour as Vector2[]).map(apply));
    for (const hole of holes as Vector2[][]) next.holes.push(new Path(hole.map(apply)));
    return next;
  });
}

function boundsOfShapes(shapes: Shape[]) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const shape of shapes) {
    for (const p of shape.getPoints(CURVE_SEGMENTS)) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { minX, minY, maxX, maxY };
}

function roundedRect(minX: number, minY: number, maxX: number, maxY: number, radius: number): Shape {
  const r = Math.max(0, Math.min(radius, (maxX - minX) / 2, (maxY - minY) / 2));
  const shape = new Shape();
  shape.moveTo(minX + r, minY);
  shape.lineTo(maxX - r, minY);
  if (r > 0) shape.quadraticCurveTo(maxX, minY, maxX, minY + r);
  shape.lineTo(maxX, maxY - r);
  if (r > 0) shape.quadraticCurveTo(maxX, maxY, maxX - r, maxY);
  shape.lineTo(minX + r, maxY);
  if (r > 0) shape.quadraticCurveTo(minX, maxY, minX, maxY - r);
  shape.lineTo(minX, minY + r);
  if (r > 0) shape.quadraticCurveTo(minX, minY, minX + r, minY);
  shape.closePath();
  return shape;
}

function circleShape(cx: number, cy: number, radius: number, segments = 64): Shape {
  const shape = new Shape();
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = cx + Math.cos(a) * radius;
    const y = cy + Math.sin(a) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

function circlePath(cx: number, cy: number, radius: number, segments = 48): Path {
  const points: Vector2[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    points.push(new Vector2(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius));
  }
  return new Path(points);
}

function pointInRing(point: Vector2, ring: Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInShapes(point: Vector2, shapes: Shape[]): boolean {
  for (const shape of shapes) {
    if (!pointInRing(point, shape.getPoints(CURVE_SEGMENTS))) continue;
    const inHole = shape.holes.some((hole) => pointInRing(point, hole.getPoints(CURVE_SEGMENTS)));
    if (!inHole) return true;
  }
  return false;
}

/** Punto del borde de `shapes` en la dirección `dir` partiendo del centro. */
function boundaryPoint(shapes: Shape[], dir: Vector2, fallbackRadius: number): Vector2 {
  const steps = 400;
  let last = new Vector2(0, 0);
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * fallbackRadius * 1.6;
    const p = new Vector2(dir.x * t, dir.y * t);
    if (pointInShapes(p, shapes)) last = p;
  }
  if (last.lengthSq() === 0) return new Vector2(dir.x * fallbackRadius, dir.y * fallbackRadius);
  return last;
}

/** Comprueba que la malla sea cerrada: cada arista debe aparecer en ambos sentidos. */
function isWatertight(geometry: BufferGeometry): boolean {
  const position = geometry.getAttribute('position');
  if (!position || position.count % 3 !== 0) return false;
  const key = (i: number) => `${position.getX(i).toFixed(4)},${position.getY(i).toFixed(4)},${position.getZ(i).toFixed(4)}`;
  const edges = new Map<string, number>();
  for (let i = 0; i < position.count; i += 3) {
    const corners = [key(i), key(i + 1), key(i + 2)];
    for (let e = 0; e < 3; e++) {
      const id = `${corners[e]}|${corners[(e + 1) % 3]}`;
      edges.set(id, (edges.get(id) ?? 0) + 1);
    }
  }
  for (const [id, count] of edges) {
    const [from, to] = id.split('|');
    if ((edges.get(`${to}|${from}`) ?? 0) !== count) return false;
  }
  return true;
}

function extrudeRaw(shapes: Shape[], depth: number, bevel: number): BufferGeometry {
  const geometry = new ExtrudeGeometry(shapes, {
    depth: bevel > 0 ? depth - bevel * 2 : depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    // Sin el desplazamiento negativo el chaflán agrandaría la pieza en X/Y.
    bevelOffset: -bevel,
    bevelSegments: 2,
    curveSegments: CURVE_SEGMENTS,
    steps: 1,
  });
  if (bevel > 0) geometry.translate(0, 0, bevel);
  return geometry;
}

/**
 * Extruye las formas ocupando exactamente `depth` en Z, desde z=0 hacia arriba
 * y sin salirse del contorno original en X/Y.
 *
 * `ExtrudeGeometry` desplaza cada vértice del chaflán por su bisectriz, lo que
 * se auto-interseca en contornos con recovecos más pequeños que el chaflán y
 * deja la malla abierta. Cuando pasa, se renuncia al chaflán en esa pieza: es
 * preferible un canto vivo a un STL que el laminador no pueda cerrar.
 */
function extrude(shapes: Shape[], depth: number, bevel: number, report?: { bevelDropped: number }): BufferGeometry {
  if (!(bevel > 0.001) || depth <= bevel * 2.2) return extrudeRaw(shapes, depth, 0);

  // Si el chaflán pedido rompe la malla se prueba con uno menor antes de rendirse.
  for (const factor of [1, 0.5, 0.25]) {
    const size = bevel * factor;
    if (depth <= size * 2.2) continue;
    const candidate = extrudeRaw(shapes, depth, size);
    if (isWatertight(candidate)) return candidate;
    candidate.dispose();
  }
  if (report) report.bevelDropped += 1;
  return extrudeRaw(shapes, depth, 0);
}

function geometryVolume(geometry: BufferGeometry): number {
  const position = geometry.getAttribute('position');
  if (!position) return 0;
  let volume = 0;
  for (let i = 0; i < position.count; i += 3) {
    const ax = position.getX(i);
    const ay = position.getY(i);
    const az = position.getZ(i);
    const bx = position.getX(i + 1);
    const by = position.getY(i + 1);
    const bz = position.getZ(i + 1);
    const cx = position.getX(i + 2);
    const cy = position.getY(i + 2);
    const cz = position.getZ(i + 2);
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(volume);
}

/**
 * `order` sólo afecta a la vista previa: separa en profundidad las capas que
 * comparten altura para que no parpadeen entre sí. La geometría no cambia.
 */
function makeMesh(geometry: BufferGeometry, color: string, z: number, name: string, order = 0): Mesh {
  const material = new MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.05,
    polygonOffset: order > 0,
    polygonOffsetFactor: -order,
    polygonOffsetUnits: -order,
  });
  const mesh = new Mesh(geometry, material);
  mesh.position.z = z;
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Copia una forma añadiendo huecos, descartando los que se salen del contorno. */
function withHoles(shape: Shape, holes: Shape[], skipped: { count: number }): Shape {
  const next = new Shape(shape.getPoints(CURVE_SEGMENTS));
  for (const hole of shape.holes) next.holes.push(new Path(hole.getPoints(CURVE_SEGMENTS)));
  const contour = next.getPoints(CURVE_SEGMENTS);
  for (const hole of holes) {
    const points = hole.getPoints(CURVE_SEGMENTS);
    if (points.every((p) => pointInRing(p, contour))) next.holes.push(new Path(points));
    else skipped.count += 1;
  }
  return next;
}

export function buildModel(layers: Layer[], settings: ModelSettings): BuiltModel {
  const group = new Group();
  const warnings: string[] = [];
  const visible = layers.filter((layer) => layer.mode !== 'hidden');
  const drawing = visible.map((layer) => ({ layer, shapes: transformShapes(layer.shapes, settings) }));
  const allShapes = drawing.flatMap((d) => d.shapes);
  if (!allShapes.length) {
    return { group, stats: { width: 0, depth: 0, height: 0, triangles: 0, volume: 0 }, warnings };
  }

  const bounds = boundsOfShapes(allShapes);
  const drawWidth = bounds.maxX - bounds.minX;
  const drawHeight = bounds.maxY - bounds.minY;
  const base = settings.base;
  const hasBase = base.mode !== 'none' && base.thickness > 0.05;

  // 1. Contorno de la placa base.
  let baseShapes: Shape[] = [];
  if (hasBase) {
    switch (base.mode) {
      case 'outline':
        baseShapes = outlineShapes(allShapes, { margin: base.margin, smoothing: base.smoothing });
        break;
      case 'silhouette':
        baseShapes = outlineShapes(allShapes, { margin: 0, smoothing: base.smoothing * 0.5 });
        break;
      case 'rect':
        baseShapes = [
          roundedRect(
            bounds.minX - base.margin,
            bounds.minY - base.margin,
            bounds.maxX + base.margin,
            bounds.maxY + base.margin,
            base.cornerRadius,
          ),
        ];
        break;
      case 'circle': {
        const cx = (bounds.minX + bounds.maxX) / 2;
        const cy = (bounds.minY + bounds.maxY) / 2;
        let radius = 0;
        for (const shape of allShapes) {
          for (const p of shape.getPoints(CURVE_SEGMENTS)) {
            radius = Math.max(radius, Math.hypot(p.x - cx, p.y - cy));
          }
        }
        baseShapes = [circleShape(cx, cy, radius + base.margin)];
        break;
      }
    }
  }
  if (hasBase && !baseShapes.length) {
    warnings.push('No se pudo generar la placa base; probá con otro modo de base.');
  }

  // 2. Pestaña de la anilla: fusionada con la placa, o suelta si no hay placa.
  const hasPlate = baseShapes.length > 0;
  const ring = settings.ring;
  const ringRadius = ring.holeDiameter / 2 + ring.wall;
  let tabShapes: Shape[] = [];
  let ringHole: Vector2 | null = null;
  if (ring.enabled && ringRadius > 0) {
    const angle = ((ring.angle - 90) * Math.PI) / 180;
    const dir = new Vector2(Math.cos(angle), -Math.sin(angle)).normalize();
    const attachTo = hasPlate ? baseShapes : allShapes;
    const fallbackRadius = Math.max(drawWidth, drawHeight) / 2 + base.margin;
    const edge = boundaryPoint(attachTo, dir, fallbackRadius);
    const center = new Vector2(
      edge.x + dir.x * ringRadius * ring.overhang,
      edge.y + dir.y * ringRadius * ring.overhang,
    );
    ringHole = center;
    const disc = circleShape(center.x, center.y, ringRadius);
    if (hasPlate) {
      // La unión se resuelve rasterizando. El acuerdo evita el ángulo entrante
      // donde la pestaña se encuentra con la placa: ahí es donde se parten los
      // llaveros, y además permite chaflanar el canto sin auto-intersecciones.
      const fillet = Math.max(base.bevel * 1.6, ringRadius * 0.3);
      baseShapes = outlineShapes([...baseShapes, disc], { margin: 0, smoothing: 0, fillet });
    } else {
      // Sin placa: disco más un puente que solapa el dibujo para quedar unido.
      const half = Math.max(ringRadius * 0.55, 0.8);
      const nx = -dir.y * half;
      const ny = dir.x * half;
      const inner = new Vector2(edge.x - dir.x * ringRadius * 1.5, edge.y - dir.y * ringRadius * 1.5);
      tabShapes = [
        disc,
        new Shape([
          new Vector2(inner.x + nx, inner.y + ny),
          new Vector2(center.x + nx, center.y + ny),
          new Vector2(center.x - nx, center.y - ny),
          new Vector2(inner.x - nx, inner.y - ny),
        ]),
      ];
    }
  }

  const plateThickness = base.thickness;
  const reliefBottom = hasPlate ? plateThickness : 0;
  const reliefHeights = drawing.filter((d) => d.layer.mode === 'relief').map((d) => d.layer.height);
  const tabThickness = hasPlate ? plateThickness : Math.max(1.2, ...reliefHeights);

  const skipped = { count: 0 };
  const report = { bevelDropped: 0 };
  const cutShapes = drawing.filter((d) => d.layer.mode === 'cut').flatMap((d) => d.shapes);

  /** Añade a la forma los calados, los grabados indicados y el agujero de la anilla. */
  const punch = (shape: Shape, extraHoles: Shape[], withRing: boolean): Shape => {
    const result = withHoles(shape, [...cutShapes, ...extraHoles], skipped);
    if (withRing && ringHole && pointInRing(ringHole, result.getPoints(CURVE_SEGMENTS))) {
      result.holes.push(circlePath(ringHole.x, ringHole.y, ring.holeDiameter / 2));
    }
    return result;
  };

  // 3. Placa base: se corta en losas para materializar los grabados.
  if (hasPlate) {
    const engraved = drawing.filter((d) => d.layer.mode === 'engrave');
    const depths = [...new Set(engraved.map((d) => Math.min(d.layer.height, plateThickness - 0.4)))]
      .filter((depth) => depth > 0.02)
      .sort((a, b) => a - b);

    if (!depths.length) {
      const geometry = extrude(baseShapes.map((shape) => punch(shape, [], true)), plateThickness, base.bevel, report);
      group.add(makeMesh(geometry, base.color, 0, 'base'));
    } else {
      const levels = [0, ...depths];
      for (let k = 0; k < levels.length - 1; k++) {
        const top = plateThickness - levels[k];
        const bottom = plateThickness - levels[k + 1];
        const holes = engraved
          .filter((d) => Math.min(d.layer.height, plateThickness - 0.4) >= levels[k + 1] - 1e-6)
          .flatMap((d) => d.shapes);
        const slab = baseShapes.map((shape) => punch(shape, holes, true));
        group.add(makeMesh(extrude(slab, top - bottom, 0), base.color, bottom, `base-nivel-${k}`));
      }
      const deepest = levels[levels.length - 1];
      const bottomThickness = plateThickness - deepest;
      if (bottomThickness > 0.02) {
        // La losa de abajo se solapa con la de arriba para que su chaflán
        // superior quede dentro del sólido y no dibuje un surco en el canto.
        const overlap = Math.min(base.bevel, deepest);
        const geometry = extrude(
          baseShapes.map((shape) => punch(shape, [], true)),
          bottomThickness + overlap,
          base.bevel,
          report,
        );
        group.add(makeMesh(geometry, base.color, 0, 'base-fondo'));
      }
    }
  } else if (tabShapes.length) {
    const geometry = extrude(tabShapes.map((shape) => punch(shape, [], true)), tabThickness, base.bevel, report);
    group.add(makeMesh(geometry, base.color, 0, 'anilla'));
  }

  // 4. Relieves sobre la base.
  drawing.forEach(({ layer, shapes }, index) => {
    if (layer.mode !== 'relief') return;
    const maxBevel = hasPlate ? Math.min(layer.height / 2.4, plateThickness / 2) : layer.height / 3;
    const bevel = Math.min(layer.bevel, maxBevel);
    // Con placa, el relieve se hunde lo justo para esconder el chaflán inferior.
    const sink = bevel > 0.001 && hasPlate ? bevel : 0;
    const geometry = extrude(shapes, layer.height + sink, bevel, report);
    group.add(makeMesh(geometry, layer.color, reliefBottom - sink, `capa-${layer.id}`, index + 1));
  });

  if (report.bevelDropped) {
    warnings.push(
      'El chaflán se omitió en alguna pieza: el contorno tiene recovecos más pequeños que el chaflán. Reducilo o subí el suavizado del contorno.',
    );
  }
  if (skipped.count) {
    warnings.push(
      `${skipped.count} forma(s) marcadas como grabado o calado se salen de la base y se ignoraron. Aumentá el margen o el tamaño de la base.`,
    );
  }
  if (!hasBase && drawing.some((d) => d.layer.mode === 'engrave')) {
    warnings.push('El grabado necesita una placa base: elegí un modo de base distinto de «Sin base».');
  }
  for (const { layer } of drawing) {
    if (layer.mode === 'engrave' && layer.height >= plateThickness) {
      warnings.push(`«${layer.name}» graba más hondo que el espesor de la base: se limitó automáticamente.`);
      break;
    }
  }

  let triangles = 0;
  let volume = 0;
  group.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry as BufferGeometry;
    triangles += geometry.getAttribute('position').count / 3;
    volume += geometryVolume(geometry);
  });

  group.updateMatrixWorld(true);
  const outerShapes = hasPlate ? baseShapes : [...allShapes, ...tabShapes];
  const modelBounds = boundsOfShapes(outerShapes);
  const maxZ = Math.max(hasPlate ? plateThickness : tabShapes.length ? tabThickness : 0, reliefBottom + Math.max(0, ...reliefHeights));

  return {
    group,
    stats: {
      width: modelBounds.maxX - modelBounds.minX,
      depth: modelBounds.maxY - modelBounds.minY,
      height: maxZ,
      triangles: Math.round(triangles),
      volume: volume / 1000,
    },
    warnings,
  };
}
