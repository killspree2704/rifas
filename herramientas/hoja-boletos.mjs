#!/usr/bin/env node
/**
 * Arma la hoja imprimible de boletos: folio, código y QR de cada uno.
 *
 *   node herramientas/hoja-boletos.mjs lote.json "https://killspree2704.github.io/rifas/" hoja.html
 *
 * Cada QR queda incrustado como SVG dentro del HTML, así que la hoja se abre
 * e imprime sin conexión y sin depender de ningún servicio.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const aqui = dirname(fileURLToPath(import.meta.url));
const qrcode = require(resolve(aqui, '../vendor/qrcode.js'));

const [rutaLote, base, rutaSalida] = process.argv.slice(2);
if (!rutaLote || !base) {
  console.error('Uso: node hoja-boletos.mjs <lote.json> <url-base> [salida.html]');
  process.exit(1);
}

const lote = JSON.parse(readFileSync(resolve(rutaLote), 'utf8'));
const salida = resolve(rutaSalida || 'hoja-boletos.html');

/** QR en SVG, sin dependencias en tiempo de impresión. */
function qrSvg(texto) {
  const qr = qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  const n = qr.getModuleCount();
  const margen = 4;
  const lado = n + margen * 2;
  const rects = [];
  for (let f = 0; f < n; f++) {
    let inicio = -1;
    for (let c = 0; c <= n; c++) {
      const oscuro = c < n && qr.isDark(f, c);
      if (oscuro && inicio < 0) inicio = c;
      if (!oscuro && inicio >= 0) {
        rects.push(`<rect x="${inicio + margen}" y="${f + margen}" width="${c - inicio}" height="1"/>`);
        inicio = -1;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" shape-rendering="crispEdges" role="img" aria-label="QR del boleto"><rect width="${lado}" height="${lado}" fill="#fff"/><g fill="#000">${rects.join('')}</g></svg>`;
}

const separador = base.includes('?') ? '&' : '?';
const boletos = lote.boletos.map((b) => {
  const url = `${base}${separador}f=${b.folio}&c=${b.codigo}`;
  return `<article class="boleto">
    <div class="datos">
      <p class="marca">${lote.nombre || 'Rifa'}</p>
      <p class="rotulo">Folio</p>
      <p class="folio">${b.serie}-${b.folio}</p>
      <p class="codigo">Código ${b.codigo}</p>
    </div>
    <div class="qr">${qrSvg(url)}</div>
  </article>`;
}).join('\n');

writeFileSync(salida, `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8" />
<title>Boletos ${lote.serie || ''} — ${lote.boletos.length}</title>
<style>
  @page { size: letter; margin: 12mm; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #fff; color: #111; }
  h1 { font-size: 14pt; margin: 0 0 8mm; }
  .rejilla { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6mm; }
  .boleto {
    display: flex; align-items: center; justify-content: space-between; gap: 4mm;
    border: 1px dashed #999; border-radius: 3mm; padding: 4mm 5mm; break-inside: avoid;
  }
  .marca { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.12em; color: #666; margin: 0 0 2mm; }
  .rotulo { font-size: 7pt; text-transform: uppercase; letter-spacing: 0.16em; color: #888; margin: 0; }
  .folio { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 17pt; font-weight: 600; margin: 0; letter-spacing: 0.04em; }
  .codigo { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 9pt; color: #444; margin: 1mm 0 0; letter-spacing: 0.1em; }
  .qr { width: 26mm; flex: 0 0 auto; }
  .qr svg { width: 100%; height: auto; display: block; }
  @media print { h1 { display: none; } }
</style></head>
<body>
  <h1>${lote.boletos.length} boletos · serie ${lote.serie} · ${base}</h1>
  <div class="rejilla">
${boletos}
  </div>
</body></html>
`);

console.log(`Hoja con ${lote.boletos.length} boletos: ${salida}`);
console.log(`URL base: ${base}`);
