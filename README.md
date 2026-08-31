# Llavero 3D

Web app para convertir una imagen vectorial (SVG) en un llavero listo para
imprimir en 3D. Subís el vector, lo editás en el navegador —volumen, relieve,
grabado, base y anilla— y te descargás el **STL** en milímetros.

Todo el procesamiento ocurre en el navegador: no se sube ningún archivo a
ningún servidor.

## Uso

```bash
npm install
npm run dev      # http://localhost:5173
```

Para publicarlo como sitio estático:

```bash
npm run build    # genera dist/
npm run preview  # sirve dist/ para revisarlo
```

## Versión en un solo archivo (sin instalar nada)

```bash
npm run build:single   # genera dist-single/llavero-3d.html
```

Empotra la app entera —JavaScript, estilos y el SVG de ejemplo— en un único
HTML de ~0,8 MB, sin ninguna dependencia externa. Se abre haciendo doble clic,
funciona sin servidor y sin conexión, y la descarga del STL sigue andando.
Es la forma de usar la app en una máquina donde no se puede instalar Node.

## Publicarla en GitHub Pages

El repo trae el flujo `.github/workflows/deploy.yml`, que compila y publica en
cada push. Sólo hay que habilitarlo una vez:

1. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Volvé a lanzar el flujo (**Actions → Publicar en GitHub Pages → Run workflow**)
   o hacé cualquier push.

Queda en `https://agucami.github.io/llavero-app/`. Las rutas del build son
relativas, así que también funciona en la raíz de un dominio propio.

## Cómo se usa la app

1. **Cargá tu SVG** (o tocá «Probar ejemplo»). Cada trazo del archivo se
   convierte en una capa editable.
2. **Elegí el tamaño**: ancho en milímetros, rotación y espejado.
3. **Elegí el estilo**, que es la decisión que más cambia el resultado:
   - *Relieve*: todo el dibujo en una sola pieza levantada sobre la base. Lo
     más simple; va bien con logos macizos.
   - *Grabado*: la placa toma la silueta del dibujo y sus líneas quedan
     hundidas. Un solo color y se lee bien: es lo que mejor funciona con
     ilustraciones con detalle.
   - *Multicolor*: una capa por color, apiladas como las pinta el SVG.
   - *Trazo a trazo*: una capa por cada trazo, sin fundir nada.

   El estilo sólo fija el punto de partida: después se toca capa por capa.

4. **Configurá la base**:
   - *Contorno*: sigue la silueta del dibujo con un margen uniforme, al estilo
     sticker. Es el modo recomendado.
   - *Silueta*: la placa es exactamente la silueta del dibujo.
   - *Rectángulo* / *Círculo*: placa geométrica con margen.
   - *Sin base*: sólo las formas, sin placa (tienen que solaparse entre sí para
     que salga una única pieza).
5. **Ajustá la anilla**: en modo *Pestaña* añade material fundido con la placa
   (con un radio de acuerdo en la unión, que es donde más se rompen los
   llaveros); en modo *Agujero* sólo perfora la pieza que ya hay. Se controlan
   el diámetro interior (por donde pasa la argolla), el exterior, la dirección
   y la distancia al borde: positiva la saca hacia afuera, negativa la mete
   dentro. Si un relieve queda encima del agujero, también se perfora.
6. **Editá cada capa**. Los trazos llegan agrupados por familia de color, así
   que una ilustración de 155 `path` entra como tres capas con nombre
   reconocible («Rojo», «Azul oscuro»…). Dentro de cada capa las formas se
   funden en un sólido, y cada capa se recorta con las que tiene encima, igual
   que las pinta el SVG: sin eso, decenas de formas superpuestas comparten
   caras, el modelo se ve rayado y el STL sale lleno de tabiques. El
   interruptor *Agrupar trazos por color* lo desactiva si necesitás tocar cada
   trazo por separado. Cada fila muestra una
   miniatura con la parte del dibujo que le toca, y al abrirla se resalta en el
   3D. Con *Todas* se cambia el modo de golpe.
   - *Relieve*: sobresale por encima de la base, con altura y bisel propios.
   - *Grabado*: se hunde en la base a la profundidad indicada.
   - *Calado*: atraviesa la placa de lado a lado.
   - *Sólo base*: no añade volumen; la forma sólo cuenta para el contorno de
     la base. Es lo que deja que el relleno de un dibujo sea la placa y sólo
     sus líneas queden grabadas.
   - *Oculta*: no se incluye en el modelo.

   En *Mover y ajustar* cada trazo se desplaza, se agranda y se gira por su
   cuenta, sin tocar el resto del dibujo.
7. **Descargá el STL**. «STL por color» exporta un archivo por color, para
   impresión multimaterial o para imprimir cada pieza en un filamento distinto.

## Preparar el SVG

- Tienen que ser **formas rellenas**. Un trazo sin relleno (sólo `stroke`) se
  rellena automáticamente y casi nunca es lo que querés: convertilo antes a
  curvas (Inkscape: *Trayecto → Contorno a trayecto*).
- Un PNG o JPG no sirve: hay que vectorizarlo primero (Inkscape: *Trayecto →
  Vectorizar mapa de bits*).
- Los degradados y patrones (`url(#...)`) se ignoran; sólo se usa el color
  plano como color de vista previa.
- Los trazos invisibles en el SVG (sin relleno, con opacidad 0 o dentro de un
  grupo `display:none`) se descartan al cargar. Muchos exportadores dejan un
  rectángulo de fondo así, y sin filtrarlo se convertiría en una capa sólida
  que tapa el dibujo entero.
- Un rectángulo de fondo *visible* (el típico `<rect>` blanco que ocupa todo el
  lienzo) se detecta y se carga oculto, avisando. Si era parte del diseño,
  cambiale el modo a Relieve.
- Cada `path` del archivo es una capa. Si querés controlar partes por separado,
  separalas en trazos distintos antes de exportar.

## Recomendaciones de impresión

- Base de 3 mm y anilla con al menos 2 mm de material alrededor del agujero
  (o sea, diámetro exterior ≥ interior + 4 mm).
- Agujero de 4 mm para argollas de llavero típicas.
- Relieves de 0,8–1,5 mm: suficientes para que se noten sin alargar la impresión.
- El modelo se exporta apoyado en Z = 0 y centrado, listo para laminar sin
  soportes.

## Cómo está hecho

- **React + TypeScript + Vite** para la interfaz, **three.js** para geometría y
  vista previa.
- `src/lib/svg.ts` convierte el SVG en capas normalizadas (eje Y hacia arriba,
  centradas, ancho 1).
- `src/lib/outline.ts` calcula el contorno con margen: rasteriza la silueta,
  aplica una transformada de distancia euclídea exacta y vuelve a vectorizarla
  con marching squares. También resuelve la unión de formas y el radio de
  acuerdo de los entrantes.
- `src/lib/model.ts` arma el sólido: placa base (en losas cuando hay grabados),
  pestaña de la anilla, calados y relieves. Cada pieza se valida como malla
  cerrada antes de darla por buena.
- `src/lib/exporters.ts` escribe el STL binario en milímetros.
