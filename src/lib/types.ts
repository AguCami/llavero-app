import type { Shape } from 'three';

/** Cómo se materializa cada trazo del SVG dentro del llavero. */
export type LayerMode = 'relief' | 'engrave' | 'cut' | 'hidden';

/** Un trazo (path) del SVG convertido en formas 2D normalizadas en milímetros. */
export interface Layer {
  id: string;
  name: string;
  /** Formas ya centradas y escaladas a mm, con sus huecos internos resueltos. */
  shapes: Shape[];
  /** Color original del SVG, usado como color de vista previa. */
  color: string;
  mode: LayerMode;
  /** Altura del relieve o profundidad del grabado, en mm. */
  height: number;
  /** Bisel en el borde superior, en mm (0 = canto vivo). */
  bevel: number;
}

export type BaseMode = 'outline' | 'silhouette' | 'rect' | 'circle' | 'none';

export interface BaseSettings {
  mode: BaseMode;
  /** Espesor de la placa base, en mm. */
  thickness: number;
  /** Margen alrededor del dibujo, en mm (modos outline/rect/circle). */
  margin: number;
  /** Radio de las esquinas del rectángulo, en mm. */
  cornerRadius: number;
  /** Suavizado del contorno generado (0 = fiel al dibujo, 1 = muy redondeado). */
  smoothing: number;
  /** Chaflán en los cantos de la placa, en mm. */
  bevel: number;
  color: string;
}

export interface RingSettings {
  enabled: boolean;
  /** Diámetro del agujero de la anilla, en mm. */
  holeDiameter: number;
  /** Grosor del material alrededor del agujero, en mm. */
  wall: number;
  /** Posición angular en grados: 0 = arriba, 90 = derecha. */
  angle: number;
  /** Cuánto sobresale la pestaña respecto del borde, 0..1. */
  overhang: number;
}

export interface ModelSettings {
  /** Ancho total objetivo del llavero, en mm. */
  width: number;
  rotation: number;
  mirror: boolean;
  base: BaseSettings;
  ring: RingSettings;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const DEFAULT_SETTINGS: ModelSettings = {
  width: 50,
  rotation: 0,
  mirror: false,
  base: {
    mode: 'outline',
    thickness: 3,
    margin: 2.5,
    cornerRadius: 4,
    smoothing: 0.35,
    bevel: 0.4,
    color: '#2f3d52',
  },
  ring: {
    enabled: true,
    holeDiameter: 4,
    wall: 2.2,
    angle: 0,
    overhang: 0.55,
  },
};

export const DEFAULT_LAYER_HEIGHT = 1.2;
