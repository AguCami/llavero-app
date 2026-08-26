import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BufferGeometry, Group, Material, Mesh } from 'three';
import { DropZone } from './components/DropZone';
import { LayerList } from './components/LayerList';
import { Viewer, type ViewerHandle } from './components/Viewer';
import { ColorField, NumberField, Panel, Segmented, Toggle } from './components/ui';
import { exportStl, exportStlByColor } from './lib/exporters';
import { buildModel, type ModelStats } from './lib/model';
import { SAMPLE_NAME, SAMPLE_SVG } from './lib/sample';
import { parseSvg } from './lib/svg';
import { DEFAULT_SETTINGS, type BaseMode, type Layer, type ModelSettings } from './lib/types';

const SETTINGS_KEY = 'llavero3d.settings.v1';

const BASE_MODES: { value: BaseMode; label: string; title: string }[] = [
  { value: 'outline', label: 'Contorno', title: 'Sigue la silueta del dibujo con un margen uniforme' },
  { value: 'silhouette', label: 'Silueta', title: 'La base es exactamente la silueta del dibujo' },
  { value: 'rect', label: 'Rectángulo', title: 'Placa rectangular con esquinas redondeadas' },
  { value: 'circle', label: 'Círculo', title: 'Placa circular' },
  { value: 'none', label: 'Sin base', title: 'Sólo las formas, sin placa' },
];

function loadSettings(): ModelSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ModelSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      base: { ...DEFAULT_SETTINGS.base, ...parsed.base },
      ring: { ...DEFAULT_SETTINGS.ring, ...parsed.ring },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function disposeGroup(group: Group) {
  group.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    (mesh.geometry as BufferGeometry).dispose();
    const material = mesh.material as Material | Material[];
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material.dispose();
  });
}

export default function App() {
  const [layers, setLayers] = useState<Layer[]>([]);
  const [settings, setSettings] = useState<ModelSettings>(loadSettings);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [model, setModel] = useState<Group | null>(null);
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [buildWarnings, setBuildWarnings] = useState<string[]>([]);
  const [showBed, setShowBed] = useState(true);
  const [busy, setBusy] = useState(false);
  const viewerRef = useRef<ViewerHandle>(null);
  const displayedRef = useRef<Group | null>(null);
  const needsFramingRef = useRef(true);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  const loadSvg = useCallback((text: string, name: string) => {
    try {
      const parsed = parseSvg(text);
      needsFramingRef.current = true;
      setLayers(parsed.layers);
      setFileName(name);
      setError(null);
      const info: string[] = [];
      if (parsed.backgroundLayer) {
        info.push(
          `«${parsed.backgroundLayer}» parece el rectángulo de fondo del archivo y se ocultó. Si era parte del diseño, cambiale el modo a Relieve en Capas.`,
        );
      }
      if (parsed.invisiblePaths) {
        info.push(
          `${parsed.invisiblePaths} trazo(s) invisibles en el SVG (sin relleno, transparentes u ocultos) se descartaron.`,
        );
      }
      if (parsed.strokeOnlyPaths) {
        info.push(
          `${parsed.strokeOnlyPaths} trazo(s) sin relleno se rellenaron para poder extruirlos. Si el resultado no es el esperado, convertí el trazo a curvas (Inkscape: Trayecto → Contorno a trayecto).`,
        );
      }
      if (parsed.droppedPaths) info.push(`${parsed.droppedPaths} trazo(s) vacíos se descartaron.`);
      setNotes(info);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo leer el SVG.');
    }
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      if (!/\.svg$/i.test(file.name) && file.type !== 'image/svg+xml') {
        setError('Sólo se admiten archivos vectoriales .svg. Un PNG o JPG hay que vectorizarlo antes.');
        return;
      }
      file
        .text()
        .then((text) => loadSvg(text, file.name.replace(/\.svg$/i, '')))
        .catch(() => setError('No se pudo leer el archivo.'));
    },
    [loadSvg],
  );

  // El modelo se reconstruye con un pequeño retardo: rasterizar el contorno es caro.
  useEffect(() => {
    if (!layers.length) {
      setModel(null);
      setStats(null);
      return;
    }
    setBusy(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      try {
        const built = buildModel(layers, settings);
        const previous = displayedRef.current;
        displayedRef.current = built.group;
        setModel(built.group);
        setStats(built.stats);
        setBuildWarnings(built.warnings);
        setError(null);
        if (previous) disposeGroup(previous);
        if (needsFramingRef.current) {
          needsFramingRef.current = false;
          requestAnimationFrame(() => viewerRef.current?.resetView());
        }
      } catch (cause) {
        setBuildWarnings([]);
        setError(cause instanceof Error ? cause.message : 'No se pudo generar el modelo.');
      } finally {
        setBusy(false);
      }
    }, 140);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [layers, settings]);

  useEffect(
    () => () => {
      if (displayedRef.current) disposeGroup(displayedRef.current);
    },
    [],
  );

  const updateLayer = useCallback((id: string, patch: Partial<Layer>) => {
    setLayers((prev) => prev.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)));
  }, []);

  const moveLayer = useCallback((id: string, direction: -1 | 1) => {
    setLayers((prev) => {
      const index = prev.findIndex((layer) => layer.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const patchSettings = useCallback((patch: Partial<ModelSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);
  const patchBase = useCallback((patch: Partial<ModelSettings['base']>) => {
    setSettings((prev) => ({ ...prev, base: { ...prev.base, ...patch } }));
  }, []);
  const patchRing = useCallback((patch: Partial<ModelSettings['ring']>) => {
    setSettings((prev) => ({ ...prev, ring: { ...prev.ring, ...patch } }));
  }, []);

  const filament = useMemo(() => (stats ? stats.volume * 1.24 : 0), [stats]);
  const hasBase = settings.base.mode !== 'none';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark">🔑</span>
          <div>
            <h1>Llavero 3D</h1>
            <p>De imagen vectorial a STL listo para imprimir</p>
          </div>
        </div>
        <div className="topbar__actions">
          <button type="button" className="btn" onClick={() => viewerRef.current?.resetView()} disabled={!model}>
            Encuadrar
          </button>
          <button
            type="button"
            className="btn"
            disabled={!model}
            onClick={() => model && exportStlByColor(model, fileName ?? 'llavero')}
            title="Un archivo por color, para impresión multimaterial"
          >
            STL por color
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!model}
            onClick={() => model && exportStl(model, fileName ?? 'llavero')}
          >
            Descargar STL
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <DropZone fileName={fileName} onFile={handleFile} onSample={() => loadSvg(SAMPLE_SVG, SAMPLE_NAME)} />

          {error ? <p className="alert alert--error">{error}</p> : null}
          {notes.map((note) => (
            <p className="alert" key={note}>
              {note}
            </p>
          ))}

          {layers.length ? (
            <>
              <Panel title="Tamaño">
                <NumberField
                  label="Ancho"
                  value={settings.width}
                  min={15}
                  max={150}
                  step={1}
                  unit="mm"
                  onChange={(width) => patchSettings({ width })}
                />
                <NumberField
                  label="Rotación"
                  value={settings.rotation}
                  min={-180}
                  max={180}
                  step={1}
                  unit="°"
                  onChange={(rotation) => patchSettings({ rotation })}
                />
                <Toggle
                  label="Espejar (para sellos o relieves invertidos)"
                  checked={settings.mirror}
                  onChange={(mirror) => patchSettings({ mirror })}
                />
              </Panel>

              <Panel title="Base">
                <Segmented
                  value={settings.base.mode}
                  options={BASE_MODES}
                  onChange={(mode) => patchBase({ mode })}
                />
                <NumberField
                  label="Espesor"
                  value={settings.base.thickness}
                  min={0.6}
                  max={12}
                  step={0.2}
                  unit="mm"
                  disabled={!hasBase}
                  hint="3 mm aguanta bien el uso diario en un llavero"
                  onChange={(thickness) => patchBase({ thickness })}
                />
                <NumberField
                  label="Margen"
                  value={settings.base.margin}
                  min={0}
                  max={15}
                  step={0.5}
                  unit="mm"
                  disabled={!hasBase || settings.base.mode === 'silhouette'}
                  onChange={(margin) => patchBase({ margin })}
                />
                <NumberField
                  label="Suavizado del contorno"
                  value={settings.base.smoothing}
                  min={0}
                  max={1}
                  step={0.05}
                  disabled={settings.base.mode !== 'outline' && settings.base.mode !== 'silhouette'}
                  hint="Cierra recovecos estrechos y redondea los entrantes"
                  onChange={(smoothing) => patchBase({ smoothing })}
                />
                <NumberField
                  label="Radio de esquina"
                  value={settings.base.cornerRadius}
                  min={0}
                  max={25}
                  step={0.5}
                  unit="mm"
                  disabled={settings.base.mode !== 'rect'}
                  onChange={(cornerRadius) => patchBase({ cornerRadius })}
                />
                <NumberField
                  label="Fondo macizo"
                  value={settings.base.floor}
                  min={0}
                  max={4}
                  step={0.1}
                  unit="mm"
                  hint="Espesor cerrado abajo que ni grabados ni calados atraviesan. En 0, los calados vuelven a ser agujeros pasantes."
                  onChange={(floor) => patchBase({ floor })}
                />
                <NumberField
                  label="Chaflán del canto"
                  value={settings.base.bevel}
                  min={0}
                  max={2}
                  step={0.05}
                  unit="mm"
                  disabled={!hasBase}
                  onChange={(bevel) => patchBase({ bevel })}
                />
                <ColorField label="Color" value={settings.base.color} onChange={(color) => patchBase({ color })} />
              </Panel>

              <Panel title="Anilla">
                <Toggle
                  label="Anilla para la argolla"
                  checked={settings.ring.enabled}
                  onChange={(enabled) => patchRing({ enabled })}
                />
                <Segmented
                  value={settings.ring.mode}
                  options={[
                    { value: 'tab', label: 'Pestaña', title: 'Añade material que sobresale de la base' },
                    { value: 'hole', label: 'Agujero', title: 'Sólo perfora la base, sin añadir nada' },
                  ]}
                  onChange={(mode) =>
                    // Al pasar a agujero, se mete dentro de la pieza para que entre entero.
                    patchRing({
                      mode,
                      distance:
                        mode === 'hole' && settings.ring.distance > 0
                          ? -(settings.ring.outerDiameter / 2 + 1)
                          : settings.ring.distance,
                    })
                  }
                />
                <NumberField
                  label="Diámetro interior"
                  value={settings.ring.holeDiameter}
                  min={1.5}
                  max={20}
                  step={0.5}
                  unit="mm"
                  disabled={!settings.ring.enabled}
                  hint="El agujero por donde pasa la argolla"
                  onChange={(holeDiameter) =>
                    patchRing({
                      holeDiameter,
                      outerDiameter: Math.max(settings.ring.outerDiameter, holeDiameter + 1.2),
                    })
                  }
                />
                <NumberField
                  label="Diámetro exterior"
                  value={settings.ring.outerDiameter}
                  min={3}
                  max={40}
                  step={0.5}
                  unit="mm"
                  disabled={!settings.ring.enabled || settings.ring.mode === 'hole'}
                  hint="Dejá al menos 2 mm de material a cada lado para que no se rompa"
                  onChange={(outerDiameter) =>
                    patchRing({ outerDiameter: Math.max(outerDiameter, settings.ring.holeDiameter + 1.2) })
                  }
                />
                <NumberField
                  label="Dirección"
                  value={settings.ring.angle}
                  min={-180}
                  max={180}
                  step={5}
                  unit="°"
                  disabled={!settings.ring.enabled}
                  hint="0° = arriba, 90° = derecha"
                  onChange={(angle) => patchRing({ angle })}
                />
                <NumberField
                  label="Distancia al borde"
                  value={settings.ring.distance}
                  min={-40}
                  max={25}
                  step={0.5}
                  unit="mm"
                  disabled={!settings.ring.enabled}
                  hint="Positiva la saca hacia afuera; negativa la mete dentro de la pieza"
                  onChange={(distance) => patchRing({ distance })}
                />
              </Panel>

              <Panel title="Capas" aside={<span className="badge">{layers.length}</span>}>
                <LayerList layers={layers} onChange={updateLayer} onMove={moveLayer} />
              </Panel>
            </>
          ) : null}
        </aside>

        <main className="stage">
          <Viewer ref={viewerRef} model={model} showBed={showBed} />

          <div className="stage__overlay">
            {stats ? (
              <div className="stats">
                <span>
                  {stats.width.toFixed(1)} × {stats.depth.toFixed(1)} × {stats.height.toFixed(1)} mm
                </span>
                <span>{stats.triangles.toLocaleString('es')} triángulos</span>
                <span>≈ {filament.toFixed(1)} g de filamento</span>
              </div>
            ) : (
              <div className="stats">
                <span>Cargá un SVG para empezar</span>
              </div>
            )}
            <Toggle label="Cama de impresión" checked={showBed} onChange={setShowBed} />
          </div>

          {busy ? <div className="stage__busy">Generando modelo…</div> : null}

          {buildWarnings.length ? (
            <div className="stage__warnings">
              {buildWarnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
