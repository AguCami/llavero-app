import type { Layer, LayerMode } from '../lib/types';
import { DEFAULT_LAYER_TRANSFORM } from '../lib/types';
import { NumberField, Segmented } from './ui';

const MODES: { value: LayerMode; label: string; title: string }[] = [
  { value: 'relief', label: 'Relieve', title: 'Sobresale por encima de la base' },
  { value: 'engrave', label: 'Grabado', title: 'Se hunde en la base' },
  { value: 'cut', label: 'Calado', title: 'Atraviesa la base de lado a lado' },
  { value: 'hidden', label: 'Oculta', title: 'No se incluye en el modelo' },
];

const MODE_LABEL: Record<LayerMode, string> = {
  relief: 'Relieve',
  engrave: 'Grabado',
  cut: 'Calado',
  hidden: 'Oculta',
};

interface Props {
  layers: Layer[];
  /** Alto/ancho del dibujo, para encuadrar las miniaturas. */
  aspect: number;
  openId: string | null;
  onOpen(id: string | null): void;
  onChange(id: string, patch: Partial<Layer>): void;
  onChangeAll(patch: Partial<Layer>): void;
  onMove(id: string, direction: -1 | 1): void;
}

/** Miniatura de la capa dentro del encuadre completo del dibujo. */
function Thumbnail({ layer, aspect }: { layer: Layer; aspect: number }) {
  const height = Math.max(aspect, 0.05);
  return (
    <svg
      className="layer__thumb"
      viewBox={`-0.55 ${-height / 2 - 0.05} 1.1 ${height + 0.1}`}
      aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"
    >
      <path d={layer.preview} fill={layer.color} fillRule="evenodd" />
    </svg>
  );
}

export function LayerList({ layers, aspect, openId, onOpen, onChange, onChangeAll, onMove }: Props) {
  return (
    <div className="layers">
      <div className="layers__bulk">
        <span>Todas:</span>
        {MODES.filter((mode) => mode.value !== 'hidden').map((mode) => (
          <button key={mode.value} type="button" onClick={() => onChangeAll({ mode: mode.value })}>
            {mode.label}
          </button>
        ))}
      </div>

      {layers.map((layer, index) => {
        const open = openId === layer.id;
        return (
          <article key={layer.id} className={`layer${layer.mode === 'hidden' ? ' layer--off' : ''}${open ? ' is-open' : ''}`}>
            <button
              type="button"
              className="layer__row"
              aria-expanded={open}
              onClick={() => onOpen(open ? null : layer.id)}
            >
              <Thumbnail layer={layer} aspect={aspect} />
              <span className="layer__title">
                <span className="layer__name">{layer.name}</span>
                <span className="layer__meta">
                  {MODE_LABEL[layer.mode]}
                  {layer.mode === 'relief' || layer.mode === 'engrave' ? ` · ${layer.height} mm` : ''}
                </span>
              </span>
              <span className="layer__chip" style={{ background: layer.color }} />
              <span className="layer__caret">{open ? '▾' : '▸'}</span>
            </button>

            {open ? (
              <div className="layer__body">
                <Segmented value={layer.mode} options={MODES} onChange={(mode) => onChange(layer.id, { mode })} />

                {layer.mode === 'relief' || layer.mode === 'engrave' ? (
                  <NumberField
                    label={layer.mode === 'relief' ? 'Altura' : 'Profundidad'}
                    value={layer.height}
                    min={0.2}
                    max={10}
                    step={0.1}
                    unit="mm"
                    onChange={(height) => onChange(layer.id, { height })}
                  />
                ) : null}

                {layer.mode === 'relief' ? (
                  <NumberField
                    label="Bisel"
                    value={layer.bevel}
                    min={0}
                    max={2}
                    step={0.05}
                    unit="mm"
                    hint="Suaviza el canto superior del relieve"
                    onChange={(bevel) => onChange(layer.id, { bevel })}
                  />
                ) : null}

                {layer.mode !== 'hidden' ? (
                  <>
                    <NumberField
                      label="Mover horizontal"
                      value={layer.offsetX}
                      min={-60}
                      max={60}
                      step={0.5}
                      unit="mm"
                      onChange={(offsetX) => onChange(layer.id, { offsetX })}
                    />
                    <NumberField
                      label="Mover vertical"
                      value={layer.offsetY}
                      min={-60}
                      max={60}
                      step={0.5}
                      unit="mm"
                      onChange={(offsetY) => onChange(layer.id, { offsetY })}
                    />
                    <NumberField
                      label="Tamaño"
                      value={layer.scale}
                      min={0.1}
                      max={3}
                      step={0.05}
                      unit="×"
                      onChange={(scale) => onChange(layer.id, { scale })}
                    />
                    <NumberField
                      label="Girar"
                      value={layer.rotation}
                      min={-180}
                      max={180}
                      step={1}
                      unit="°"
                      onChange={(rotation) => onChange(layer.id, { rotation })}
                    />
                  </>
                ) : null}

                <div className="layer__tools">
                  <input
                    className="layer__color"
                    type="color"
                    value={layer.color}
                    title="Color de vista previa"
                    onChange={(event) => onChange(layer.id, { color: event.target.value })}
                  />
                  <input
                    className="layer__rename"
                    value={layer.name}
                    aria-label="Nombre de la capa"
                    onChange={(event) => onChange(layer.id, { name: event.target.value })}
                  />
                  <button type="button" disabled={index === 0} title="Subir" onClick={() => onMove(layer.id, -1)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === layers.length - 1}
                    title="Bajar"
                    onClick={() => onMove(layer.id, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    title="Devolver el trazo a su sitio y tamaño original"
                    onClick={() => onChange(layer.id, { ...DEFAULT_LAYER_TRANSFORM })}
                  >
                    ⟲
                  </button>
                </div>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
