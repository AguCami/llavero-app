/**
 * Empotra el build de `dist-single/` en un único archivo HTML autocontenido,
 * que funciona abriéndolo directamente en el navegador (sin servidor).
 *
 *   npm run build:single   ->   dist-single/llavero-3d.html
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'dist-single';
const js = join(dir, 'app.js');
const css = join(dir, 'app.css');
if (!existsSync(js)) {
  console.error(`Falta ${js}: ejecutá primero "vite build --config vite.config.single.ts".`);
  process.exit(1);
}

const html = readFileSync(join(dir, 'index.html'), 'utf8');
const script = readFileSync(js, 'utf8');
const styles = existsSync(css) ? readFileSync(css, 'utf8') : '';

// El bundle es un script clásico: hay que sacarlo de <head> y ejecutarlo al
// final de <body>, cuando el div #root ya existe.
const inlined = html
  .replace(/<link rel="stylesheet"[^>]*>/, styles ? `<style>${styles}</style>` : '')
  .replace(/\s*<script[^>]*src="[^"]*app\.js"[^>]*><\/script>/, '')
  .replace('</body>', () => `  <script>${script}</script>\n  </body>`);

if (inlined.includes('app.js')) {
  console.error('No se pudo empotrar el bundle: quedó una referencia a app.js.');
  process.exit(1);
}

const out = join(dir, 'llavero-3d.html');
writeFileSync(out, inlined);
console.log(`${out} — ${(Buffer.byteLength(inlined) / 1024 / 1024).toFixed(2)} MB`);
