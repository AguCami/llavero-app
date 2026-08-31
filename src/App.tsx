import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Color } from 'three';
import type { BufferGeometry, Group, Material, Mesh, MeshStandardMaterial } from 'three';
import { DropZone } from './components/DropZone';
import { LayerList } from './components/LayerList';
import { Viewer, type ViewerHandle } from './components/Viewer';
import { ColorField, NumberField, Panel, Segmented, Toggle } from './components/ui';
import { exportStl, exportStlByColor } from './lib/exporters';
import { buildModel, type ModelStats } from './lib/model';
import { SAMPLE_NAME, SAMPLE_SVG } from './lib/sample';
import { parseSvg, type ParseMode } from './lib/svg';
import { DEFAULT_SETTINGS, type BaseMode, type Layer, type ModelSettings } from './lib/types';

const SETTINGS_KEY = 'llavero3d.settings.v1';
const BLACK = new Color('#000000');

type StyleKey = 'relief' | 'engrave' | 'color' | 'raw';

/** Luminancia relativa (0 negro, 1 blanco), para distinguir líneas de relleno. */
function luminance(hex: string): number {
  const color = new Color(hex);
  const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/**
 * Reparte las capas para el estilo «Grabado»: la tinta que más superficie
 * ocupa es el relleno y se queda como placa lisa; lo que más contrasta con
 * ella son las líneas del dibujo, y eso es lo que se graba.
 */
function engraveLines(layers: Layer[]): Layer[] {
  const art = layers.filter((layer) => layer.mode !== 'hidden');
  if (art.length < 2) return layers.map((l) => (l.mode === 'hidden' ? l : { ...l, mode: 'engrave', height: 0.6 }));

  const fill = art.reduce((best, layer) => (layer.area > best.area ? layer : best), art[0]);
  const base = luminance(fill.color);
  const contrast = (layer: Layer) => Math.abs(luminance(layer.color) - base);

  // Si ninguna tinta contrasta lo suficiente, se graba la que más se aleje:
  // dejar todo liso sería devolver una placa muda.
  const threshold = art.some((layer) => contrast(layer) > 0.2)
    ? 0.2
    : Math.max(...art.map(contrast)) - 1e-6;

  return layers.map((layer) => {
    if (layer.mode === 'hidden') return layer;
    return contrast(layer) > threshold && layer.id !== fill.id
      ? { ...layer, mode: 'engrave' as const, height: 0.6 }
      : { ...layer, mode: 'flat' as const };
  });
}

/**
 * Estilos: cada uno decide cómo se reparte el dibujo en capas y cómo entra
 * cada una. Son el punto de partida; después se puede tocar capa por capa.
 */
const STYLES: {
  value: StyleKey;
  label: string;
  title: string;
  parse: ParseMode;
  layer: Partial<Layer>;
}[] = [
  {
    value: 'relief',
    label: 'Relieve',
    title: 'Todo el dibujo en una sola pieza levantada sobre la base. Lo más simple: va bien con logos macizos.',
    parse: 'single',
    layer: { mode: 'relief', height: 1.2, bevel: 0 },
  },
  {
    value: 'engrave',
    label: 'Grabado',
    title:
      'La placa toma la silueta del dibujo y sus líneas quedan hundidas. Un solo color y se lee bien: es lo que mejor funciona con ilustraciones con detalle.',
    parse: 'color',
    layer: { mode: 'engrave', height: 0.6 },
  },
  {
    value: 'color',
    label: 'Multicolor',
    title: 'Una capa por color, apiladas como las pinta el SVG. Para imprimir en varios filamentos.',
    parse: 'color',
    layer: { mode: 'relief', height: 1.2 },
  },
  {
    value: 'raw',
    label: 'Trazo a trazo',
    title: 'Una capa por cada trazo del archivo, sin fundir nada. Control total, pero con muchas capas.',
    parse: 'raw',
    layer: { mode: 'relief', height: 1.2 },
  },
];

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
  const [source, setSource] = useState<{ text: string; name: string } | null>(null);
  // Multicolor de arranque: es el que reproduce el dibujo tal cual, y de ahí
  // se pasa a Relieve o Grabado si se busca algo más simple.
  const [style, setStyle] = useState<StyleKey>('color');
  const [aspect, setAspect] = useState(1);
  const [openLayer, setOpenLayer] = useState<string | null>(null);
  const [settings, setSettings] = useState<ModelSettings>(loadSettings);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [model, setModel] = useState<Group | null>(null);
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [buildWarnings, setBuildWarnings] = useState<string[]>([]);
  const [showBed, setShowBed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const viewerRef = useRef<ViewerHandle>(null);
  const displayedRef = useRef<Group | null>(null);
  const needsFramingRef = useRef(true);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  const runParse = useCallback((text: string, name: string, key: StyleKey, keepFraming: boolean) => {
    try {
      const preset = STYLES.find((option) => option.value === key) ?? STYLES[0];
      const parsed = parseSvg(text, preset.parse);
      if (!keepFraming) needsFramingRef.current = true;
      const styled = parsed.layers.map((layer) => (layer.mode === 'hidden' ? layer : { ...layer, ...preset.layer }));
      setLayers(key === 'engrave' ? engraveLines(styled) : styled);
      setAspect(parsed.aspect);
      setOpenLayer(null);
      setSource({ text, name });
      setFileName(name);
      setError(null);
      const info: string[] = [];
      if (parsed.groupedPaths) {
        const total = parsed.groupedPaths + parsed.layers.length + parsed.coveredLayers;
        info.push(
          `Se agruparon ${total} trazos en ${parsed.layers.length} capas por color, fundiendo lo que se superpone.`,
        );
      }
      if (parsed.coveredLayers) {
        info.push(`${parsed.coveredLayers} capa(s) quedaban tapadas del todo por las de encima y se descartaron.`);
      }
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
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSvg = useCallback((text: string, name: string, key: StyleKey, keepFraming = false) => {
    // Fundir las capas de un SVG pesado lleva segundos y bloquea la página:
    // primero se pinta el aviso y recién después se procesa.
    setLoading(true);
    setTimeout(() => runParse(text, name, key, keepFraming), 30);
  }, [runParse]);

  const handleFile = useCallback(
    (file: File) => {
      if (!/\.svg$/i.test(file.name) && file.type !== 'image/svg+xml') {
        setError('Sólo se admiten archivos vectoriales .svg. Un PNG o JPG hay que vectorizarlo antes.');
        return;
      }
      file
        .text()
        .then((text) => loadSvg(text, file.name.replace(/\.svg$/i, ''), style))
        .catch(() => setError('No se pudo leer el archivo.'));
    },
    [loadSvg, style],
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

  const changeStyle = useCallback(
    (key: StyleKey) => {
      setStyle(key);
      if (source) loadSvg(source.text, source.name, key, true);
    },
    [loadSvg, source],
  );

  const updateAllLayers = useCallback((patch: Partial<Layer>) => {
    setLayers((prev) => prev.map((layer) => ({ ...layer, ...patch })));
  }, []);

  // La capa abierta se resalta en el 3D para saber cuál se está tocando.
  useEffect(() => {
    if (!model) return;
    model.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as MeshStandardMaterial;
      if (!material.emissive) return;
      const selected = !!openLayer && mesh.name === `capa-${openLayer}`;
      // Brilla en su propio color: se distingue sin que parezca otro color.
      material.emissive.copy(selected ? material.color : BLACK);
      material.emissiveIntensity = selected ? 0.45 : 0;
    });
  }, [model, openLayer]);

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
          <DropZone fileName={fileName} onFile={handleFile} onSample={() => loadSvg(SAMPLE_SVG, SAMPLE_NAME, style)} />

          {error ? <p className="alert alert--error">{error}</p> : null}
          {notes.map((note) => (
            <p className="alert" key={note}>
              {note}
            </p>
          ))}

          {layers.length ? (
            <>
              <Panel title="Estilo">
                <Segmented value={style} options={STYLES} onChange={changeStyle} />
                <p className="hint">{STYLES.find((option) => option.value === style)?.title}</p>
              </Panel>

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
                <LayerList
                  layers={layers}
                  aspect={aspect}
                  openId={openLayer}
                  onOpen={setOpenLayer}
                  onChange={updateLayer}
                  onChangeAll={updateAllLayers}
                  onMove={moveLayer}
                />
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

          {loading || busy ? (
            <div className="stage__busy">{loading ? 'Leyendo el SVG…' : 'Generando modelo…'}</div>
          ) : null}

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
