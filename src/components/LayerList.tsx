import type { Layer, LayerMode } from '../lib/types';
import { DEFAULT_LAYER_TRANSFORM } from '../lib/types';
import { NumberField, Segmented } from './ui';

const MODES: { value: LayerMode; label: string; title: string }[] = [
  { value: 'relief', label: 'Relieve', title: 'Sobresale por encima de la base' },
  { value: 'engrave', label: 'Grabado', title: 'Se hunde en la base' },
  { value: 'cut', label: 'Calado', title: 'Atraviesa la base de lado a lado' },
  { value: 'hidden', label: 'Oculta', title: 'No se incluye en el modelo' },
];

interface Props {
  layers: Layer[];
  onChange(id: string, patch: Partial<Layer>): void;
  onMove(id: string, direction: -1 | 1): void;
}

export function LayerList({ layers, onChange, onMove }: Props) {
  return (
    <div className="layers">
      {layers.map((layer, index) => (
        <article key={layer.id} className={`layer${layer.mode === 'hidden' ? ' layer--off' : ''}`}>
          <header className="layer__head">
            <input
              className="layer__color"
              type="color"
              value={layer.color}
              title="Color de vista previa"
              onChange={(event) => onChange(layer.id, { color: event.target.value })}
            />
            <input
              className="layer__name"
              value={layer.name}
              onChange={(event) => onChange(layer.id, { name: event.target.value })}
            />
            <div className="layer__order">
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
            </div>
          </header>

          <Segmented
            value={layer.mode}
            options={MODES}
            onChange={(mode) => onChange(layer.id, { mode })}
          />

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
            <details className="layer__more">
              <summary>Mover y ajustar</summary>
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
              <button
                type="button"
                className="btn layer__reset"
                onClick={() => onChange(layer.id, { ...DEFAULT_LAYER_TRANSFORM })}
              >
                Volver al original
              </button>
            </details>
          ) : null}
        </article>
      ))}
    </div>
  );
}
