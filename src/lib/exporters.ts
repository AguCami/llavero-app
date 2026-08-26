import { Group, Mesh, type Object3D } from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';

function download(data: BlobPart, filename: string, type: string) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Se libera en el siguiente tick para no cancelar la descarga.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toStl(object: Object3D): ArrayBuffer {
  const view = new STLExporter().parse(object, { binary: true }) as unknown as DataView;
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

function safeName(name: string): string {
  const clean = name.trim().replace(/\.svg$/i, '').replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '');
  return clean || 'llavero';
}

/** Exporta el modelo completo como un único STL binario en milímetros. */
export function exportStl(group: Group, name: string) {
  const data = toStl(group);
  download(data, `${safeName(name)}.stl`, 'model/stl');
}

/**
 * Exporta un STL por color: útil para impresión multimaterial o para
 * imprimir cada pieza en un filamento distinto y pegarlas.
 */
export function exportStlByColor(group: Group, name: string): number {
  const byColor = new Map<string, Mesh[]>();
  group.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as { color?: { getHexString(): string } };
    const key = material.color?.getHexString() ?? 'ffffff';
    const list = byColor.get(key);
    if (list) list.push(mesh);
    else byColor.set(key, [mesh]);
  });

  let index = 0;
  for (const [color, meshes] of byColor) {
    const part = new Group();
    for (const mesh of meshes) {
      const clone = new Mesh(mesh.geometry, mesh.material);
      clone.position.copy(mesh.position);
      clone.rotation.copy(mesh.rotation);
      clone.scale.copy(mesh.scale);
      part.add(clone);
    }
    part.updateMatrixWorld(true);
    index += 1;
    download(toStl(part), `${safeName(name)}-${index}-${color}.stl`, 'model/stl');
  }
  return byColor.size;
}
