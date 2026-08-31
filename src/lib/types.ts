import type { Shape } from 'three';

/** Cómo se materializa cada trazo del SVG dentro del llavero. */
/**
 * `flat` no añade ni quita material: la forma sólo cuenta para calcular el
 * contorno de la base. Sirve para que el relleno de un dibujo sea la placa y
 * únicamente sus líneas queden grabadas.
 */
export type LayerMode = 'relief' | 'engrave' | 'cut' | 'flat' | 'hidden';

/** Un trazo (path) del SVG convertido en formas 2D normalizadas en milímetros. */
export interface Layer {
  id: string;
  name: string;
  /** Formas ya centradas y escaladas a mm, con sus huecos internos resueltos. */
  shapes: Shape[];
  /** Silueta de la capa como ruta SVG, para la miniatura de la lista. */
  preview: string;
  /** Superficie que ocupa la capa, en unidades normalizadas. */
  area: number;
  /** Color original del SVG, usado como color de vista previa. */
  color: string;
  mode: LayerMode;
  /** Altura del relieve o profundidad del grabado, en mm. */
  height: number;
  /** Bisel en el borde superior, en mm (0 = canto vivo). */
  bevel: number;
  /** Desplazamiento del trazo respecto de su sitio original, en mm. */
  offsetX: number;
  offsetY: number;
  /** Escala propia del trazo: 1 = tamaño original. */
  scale: number;
  /** Giro propio del trazo alrededor de su centro, en grados. */
  rotation: number;
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
  /**
   * Espesor macizo en la parte de abajo, en mm. Ningún grabado ni calado lo
   * atraviesa, así que la cara inferior queda siempre plana y cerrada.
   * 0 lo desactiva (los calados vuelven a ser agujeros pasantes).
   */
  floor: number;
  color: string;
}

/**
 * `tab` añade una pestaña de material fundida con la base; `hole` sólo
 * perfora la base, sin añadir nada.
 */
export type RingMode = 'tab' | 'hole';

export interface RingSettings {
  enabled: boolean;
  mode: RingMode;
  /** Diámetro interior: el agujero por donde pasa la argolla, en mm. */
  holeDiameter: number;
  /** Diámetro exterior de la pestaña, en mm. */
  outerDiameter: number;
  /** Dirección en grados: 0 = arriba, 90 = derecha. */
  angle: number;
  /**
   * Distancia desde el borde de la base, en mm. Positiva la aleja hacia
   * afuera; negativa la mete dentro de la pieza.
   */
  distance: number;
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
    floor: 0.8,
    color: '#2f3d52',
  },
  ring: {
    enabled: true,
    mode: 'tab',
    holeDiameter: 4,
    outerDiameter: 8.4,
    angle: 0,
    distance: 2.3,
  },
};

export const DEFAULT_LAYER_HEIGHT = 1.2;

/** Valores de arranque de los ajustes propios de cada trazo. */
export const DEFAULT_LAYER_TRANSFORM = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  rotation: 0,
} as const;
